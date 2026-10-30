import { parse } from 'dotenv';

export interface EnvEntry {
  key: string;
  value: string;
  label: string;
  comment: string;
}

interface EditableEntry extends EnvEntry {
  valueStart: number;
  valueEnd: number;
}

// Keep assignment/value offsets so saving a form never rewrites unrelated lines.
// Quote handling follows dotenv, including its support for multiline values.
const assignment = /^[\uFEFF\t ]*(?:export[\t ]+)?([\w.-]+)([\t ]*=[\t ]*|:[\t ]+)([\t ]*'(?:\\'|[^'])*'|[\t ]*"(?:\\"|[^"])*"|[\t ]*`(?:\\`|[^`])*`|[^#\r\n]+)?[\t ]*(?:#([^\r\n]*))?\r?$/dgm;

function precedingComments(source: string, lineStart: number): string[] {
  const comments: string[] = [];
  let cursor = lineStart;
  while (cursor > 0) {
    const end = cursor - 1;
    const start = source.lastIndexOf('\n', end - 1) + 1;
    const line = source.slice(start, end).replace(/\r$/, '');
    const comment = /^[\t ]*#(.*)$/.exec(line);
    if (!comment) break;
    comments.unshift(comment[1].trim());
    cursor = start;
  }
  return comments;
}

function editableEntries(source: string): EditableEntry[] {
  const values = parse(source);
  const entries = new Map<string, EditableEntry>();
  // A fresh RegExp avoids leaking lastIndex between calls.
  const matcher = new RegExp(assignment.source, assignment.flags);
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source))) {
    const key = match[1];
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    const indices = match.indices!;
    const lineStart = source.lastIndexOf('\n', indices[1]![0] - 1) + 1;
    const comments = precedingComments(source, lineStart);
    const titleComments = comments.filter((comment) => !/^(?:export[\t ]+)?[\w.-]+[\t ]*=/.test(comment));
    const inlineComment = (match[4] || '').trim();
    const rawValue = match[3] || '';
    const rawStart = indices[3]?.[0] ?? indices[2]![1];
    const valueStart = rawStart + rawValue.length - rawValue.trimStart().length;
    const valueEnd = rawStart + rawValue.trimEnd().length;
    // dotenv resolves duplicate assignments using their last occurrence.
    entries.delete(key);
    entries.set(key, {
      key,
      value: values[key],
      label: inlineComment || titleComments.at(-1) || key,
      comment: [...comments, ...(inlineComment ? [inlineComment] : [])].join('\n'),
      valueStart,
      valueEnd: Math.max(valueStart, valueEnd),
    });
  }
  return [...entries.values()];
}

export function parseEnvDocument(source: string): EnvEntry[] {
  return editableEntries(source).map(({ valueStart: _start, valueEnd: _end, ...entry }) => entry);
}

function serializeValue(key: string, value: string): string {
  if (value.includes('\0')) throw new Error(`配置项 ${key} 不能包含空字符`);
  const candidates: string[] = [];
  // An unmatched leading quote may appear harmless alone but consume a later line.
  if (!/[\r\n]/.test(value) && !/^['"`]/.test(value)) candidates.push(value);
  if (!value.includes("'")) candidates.push(`'${value}'`);
  if (!value.includes('"')) {
    candidates.push(`"${value.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`);
  }
  if (!value.includes('`')) candidates.push(`\`${value}\``);
  for (const candidate of candidates) {
    const parsed = parse(`ENV_EDITOR_VALUE=${candidate}\n`);
    if (Object.keys(parsed).length === 1 && parsed.ENV_EDITOR_VALUE === value) return candidate;
  }
  throw new Error(`配置项 ${key} 无法按原值写入，请避免同时使用三种引号`);
}

export function updateEnvDocument(source: string, updates: Record<string, string>): string {
  const entries = new Map(editableEntries(source).map((entry) => [entry.key, entry]));
  const expected = new Map(Object.entries(parse(source)));
  const replacements: { start: number; end: number; text: string }[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const entry = entries.get(key);
    if (!entry) throw new Error(`配置项 ${key} 不存在，请重新加载设置`);
    if (typeof value !== 'string') throw new Error(`配置项 ${key} 必须为文本`);
    expected.set(key, value);
    if (value === entry.value) continue;
    let text = serializeValue(key, value);
    if (source[entry.valueEnd] === '#') text += ' ';
    replacements.push({ start: entry.valueStart, end: entry.valueEnd, text });
  }
  let result = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  const actual = parse(result);
  if (
    Object.keys(actual).length !== expected.size ||
    [...expected].some(([key, value]) => actual[key] !== value)
  ) {
    throw new Error('配置内容无法安全保存，请检查引号或换行格式');
  }
  return result;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'dotenv';
import { parseEnvDocument, updateEnvDocument } from '../src/env-file';

test('environment fields use adjacent Chinese comments and inline comments as titles', () => {
  const source = [
    '# 服务配置',
    '# 运行模式',
    'APP_MODE=demo',
    'HOST=127.0.0.1 # 监听地址',
    '# 这是独立说明',
    '',
    'PORT=3001',
    '# DISABLED=no',
    'EMPTY=',
    '',
  ].join('\n');
  assert.deepEqual(parseEnvDocument(source), [
    { key: 'APP_MODE', value: 'demo', label: '运行模式', comment: '服务配置\n运行模式' },
    { key: 'HOST', value: '127.0.0.1', label: '监听地址', comment: '监听地址' },
    { key: 'PORT', value: '3001', label: 'PORT', comment: '' },
    { key: 'EMPTY', value: '', label: 'EMPTY', comment: 'DISABLED=no' },
  ]);
});

test('saving preserves CRLF, comments, exports, spacing, unknown text and unrelated multiline values', () => {
  const source = [
    '# 访问地址',
    'export  URL = "https://old.example/#part"  # 浏览器地址',
    '# 多行文本',
    "BANNER='first line",
    'SECOND=inside the value',
    "last line' # 不应产生其他设置项",
    '# 其他配置',
    'UNKNOWN=value',
    'not an assignment',
    'EMPTY=   # 可选值',
    '',
  ].join('\r\n');
  const result = updateEnvDocument(source, { URL: 'https://new.example/#anchor', EMPTY: 'new value' });
  assert.equal(result, source
    .replace('"https://old.example/#part"', "'https://new.example/#anchor'")
    .replace('EMPTY=   #', 'EMPTY=   new value #'));
  assert.deepEqual(parse(result), {
    URL: 'https://new.example/#anchor',
    BANNER: 'first line\nSECOND=inside the value\nlast line',
    UNKNOWN: 'value',
    EMPTY: 'new value',
  });
  assert.equal(parseEnvDocument(source).length, 4);
});

test('duplicate assignments expose the effective last occurrence and update only that occurrence', () => {
  const source = '# 第一个端口\nPORT=3000\nHOST=localhost\n# 服务端口\nPORT=3001 # 最终端口\n';
  const entries = parseEnvDocument(source);
  assert.deepEqual(entries.map((entry) => entry.key), ['HOST', 'PORT']);
  assert.equal(entries[1].value, '3001');
  assert.equal(entries[1].label, '最终端口');
  const result = updateEnvDocument(source, { PORT: '3101' });
  assert.equal(result, source.replace('PORT=3001', 'PORT=3101'));
  assert.equal(parse(result).PORT, '3101');
});

test('edited values roundtrip literally without creating environment assignments', () => {
  const values = [
    '', 'plain', '  padded  ', 'hash#inside', 'literal\\nvalue',
    'double"quote#inside', "single'quote#inside", '`backtick`#inside',
    '$HOME $(touch /tmp/not-run) `command`',
    'first\nINJECTED=not-a-setting\nlast', 'first\r\nlast',
    '中文标题与内容', "all'\"`quotes but no hash",
  ];
  for (const value of values) {
    const source = '# 自定义内容\nVALUE=old # 保留说明\nOTHER=safe\n';
    const result = updateEnvDocument(source, { VALUE: value });
    assert.deepEqual(parse(result), { VALUE: value, OTHER: 'safe' });
    assert.equal(parseEnvDocument(result).length, 2);
    assert.ok(result.endsWith(' # 保留说明\nOTHER=safe\n'));
  }
});

test('invalid edits fail without silently changing values or introducing unsupported keys', () => {
  const source = 'VALUE=old\n';
  assert.throws(() => updateEnvDocument(source, { UNKNOWN: 'new' }), /不存在/);
  assert.throws(() => updateEnvDocument(source, { VALUE: 'with\0null' }), /空字符/);
  assert.throws(() => updateEnvDocument(source, { VALUE: "all'\"`quotes#hash" }), /无法按原值写入/);
  assert.throws(() => updateEnvDocument(source, { VALUE: 5 as unknown as string }), /必须为文本/);
  assert.equal(updateEnvDocument(source, { VALUE: 'old' }), source);
});

test('leading unmatched quotes cannot consume later quoted settings', () => {
  const source = "# 自定义内容\nVALUE=old # 保留说明\nOTHER='safe'\nTHIRD=unchanged\n";
  for (const value of ["'unclosed", '"unclosed', '`unclosed']) {
    const result = updateEnvDocument(source, { VALUE: value });
    assert.deepEqual(parse(result), { VALUE: value, OTHER: 'safe', THIRD: 'unchanged' });
    assert.equal(parseEnvDocument(result).length, 3);
    assert.ok(result.endsWith("OTHER='safe'\nTHIRD=unchanged\n"));
  }
});

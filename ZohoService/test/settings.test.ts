import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { createApp } from '../src/bootstrap';
import { AppConfig } from '../src/config';
import { SettingsDocument, SettingsService } from '../src/settings.service';

const password = 'existing-settings-password';
const encryptionKey = 'ab'.repeat(32);

function fixture(mode: 'demo' | 'live' = 'demo') {
  const root = mkdtempSync(join(tmpdir(), 'zohome-settings-'));
  const file = join(root, 'test.env');
  const source = [
    '# 运行模式', `APP_MODE=${mode}`,
    '# 服务端口', 'PORT=3001',
    '# 网页地址', 'FRONTEND_URL=http://localhost:5173',
    '# 工作区密码', `APP_PASSWORD=${password}`,
    '# 令牌加密密钥', `TOKEN_ENCRYPTION_KEY=${encryptionKey}`,
    '# 请求间隔（毫秒）', 'ZOHO_MIN_REQUEST_INTERVAL_MS=2100',
    '# 自定义标题', 'CUSTOM_VALUE="old # literal" # 简短中文标题',
    '# 自定义凭据', 'CUSTOM_SECRET=private-custom-value',
    '# 未配置凭据', 'EMPTY_SECRET=',
    '# 历史注释保留', '# DISABLED=unchanged', '',
  ].join('\n');
  writeFileSync(file, source, { mode: 0o600 });
  process.env.APP_MODE = mode;
  process.env.DATA_DIR = join(root, 'data');
  process.env.APP_PASSWORD = password;
  process.env.TOKEN_ENCRYPTION_KEY = encryptionKey;
  process.env.FRONTEND_URL = 'http://localhost:5173';
  delete process.env.ZOHO_CLIENT_ID;
  delete process.env.ZOHO_CLIENT_SECRET;
  return { root, file, source };
}

test('settings API discovers comments, masks secrets and persists validated changes without applying them before restart', async () => {
  const { root, file, source } = fixture();
  const app = await createApp({ settingsFile: file, shutdownHooks: false });
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    const firstResponse = await request('/settings');
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as SettingsDocument;
    assert.equal(first.fileName, 'test.env');
    assert.equal(first.restartRequired, false);
    assert.equal(first.fields.find((field) => field.key === 'CUSTOM_VALUE')?.label, '简短中文标题');
    assert.equal(first.fields.find((field) => field.key === 'CUSTOM_VALUE')?.value, 'old # literal');
    assert.equal(first.fields.find((field) => field.key === 'CUSTOM_SECRET')?.value, null);
    assert.equal(first.fields.find((field) => field.key === 'CUSTOM_SECRET')?.configured, true);
    assert.equal(first.fields.find((field) => field.key === 'EMPTY_SECRET')?.configured, false);
    assert.equal(first.fields.some((field) => field.key === 'DISABLED'), false);
    assert.equal(first.fields.find((field) => field.key === 'TOKEN_ENCRYPTION_KEY')?.readOnly, true);
    for (const secret of [password, encryptionKey, 'private-custom-value'])
      assert.equal(JSON.stringify(first).includes(secret), false);
    for (const values of [
      { APP_MODE: 'invalid' }, { PORT: '0' }, { PORT: 'abc' },
      { FRONTEND_URL: 'javascript:alert(1)' }, { FRONTEND_URL: 'https://user:secret@example.com' },
      { APP_PASSWORD: 'short' }, { TOKEN_ENCRYPTION_KEY: 'cd'.repeat(32) },
      { ZOHO_MIN_REQUEST_INTERVAL_MS: '100' }, { UNKNOWN: 'value' },
      { CUSTOM_VALUE: 123 }, { CUSTOM_VALUE: 'bad\0value' },
    ]) {
      const rejected = await request('/settings', 'PATCH', { revision: first.revision, values });
      assert.equal(rejected.status, 400);
      assert.equal(readFileSync(file, 'utf8'), source);
    }
    const changedValue = '带引号 "中文" # 以及换行\n仍然是同一个值';
    const saved = await request('/settings', 'PATCH', {
      revision: first.revision,
      values: { APP_MODE: 'live', CUSTOM_VALUE: changedValue, APP_PASSWORD: '', CUSTOM_SECRET: 'replacement-private-secret' },
    });
    assert.equal(saved.status, 200);
    const result = await saved.json() as SettingsDocument;
    assert.equal(result.restartRequired, true);
    assert.notEqual(result.revision, first.revision);
    assert.equal(result.fields.find((field) => field.key === 'CUSTOM_VALUE')?.value, changedValue);
    assert.equal(JSON.stringify(result).includes('replacement-private-secret'), false);
    const persisted = readFileSync(file, 'utf8');
    const parsed = parse(persisted);
    assert.equal(parsed.CUSTOM_VALUE, changedValue);
    assert.equal(parsed.APP_PASSWORD, password);
    assert.equal(parsed.TOKEN_ENCRYPTION_KEY, encryptionKey);
    assert.equal(parsed.CUSTOM_SECRET, 'replacement-private-secret');
    assert.match(persisted, /# 历史注释保留\n# DISABLED=unchanged/);
    assert.equal(process.env.APP_MODE, 'demo');
    assert.equal(((await (await request('/status')).json()) as { mode: string }).mode, 'demo');
    assert.equal((await request('/settings', 'PATCH', { revision: first.revision, values: { CUSTOM_VALUE: 'stale overwrite' } })).status, 409);
    const same = await request('/settings', 'PATCH', { revision: result.revision, values: {} });
    assert.equal(same.status, 200);
    assert.equal(readFileSync(file, 'utf8'), persisted);
    writeFileSync(file, `${persisted}# 自动发现的新配置\nNEW_DYNAMIC_FIELD=added\n`);
    const reloaded = await (await request('/settings')).json() as SettingsDocument;
    assert.equal(reloaded.fields.find((field) => field.key === 'NEW_DYNAMIC_FIELD')?.label, '自动发现的新配置');
    assert.equal((await request('/settings', 'PATCH', { revision: result.revision, values: { CUSTOM_VALUE: 'external overwrite' } })).status, 409);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('settings API inherits session and origin protection and rejects invalid request shapes', async () => {
  const { root, file } = fixture('live');
  const app = await createApp({ settingsFile: file, shutdownHooks: false });
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  try {
    assert.equal((await fetch(`${base}/settings`)).status, 401);
    const login = await fetch(`${base}/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const read = await fetch(`${base}/settings`, { headers: { Cookie: cookie } });
    assert.equal(read.status, 200);
    const document = await read.json() as SettingsDocument;
    assert.equal((await fetch(`${base}/settings`, { headers: { Cookie: cookie, Origin: 'https://hostile.example' } })).status, 403);
    for (const body of [
      { revision: document.revision, values: null },
      { revision: document.revision, values: [] },
      { revision: document.revision, values: {}, extra: 'unallowed' },
      { revision: 'invalid', values: {} },
    ]) {
      const invalid = await fetch(`${base}/settings`, {
        method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(invalid.status, 400);
    }
    const hostile = await fetch(`${base}/settings`, {
      method: 'PATCH', headers: { Cookie: cookie, Origin: 'https://hostile.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: document.revision, values: { CUSTOM_VALUE: 'hostile' } }),
    });
    assert.equal(hostile.status, 403);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('settings handles read-only and missing files, environment overrides and desktop configuration rules', () => {
  const { root, file, source } = fixture();
  try {
    const config = Object.assign(new AppConfig(), { environmentOverrides: new Set(['CUSTOM_VALUE']) });
    const settings = new SettingsService(config);
    settings.setSource(file);
    const first = settings.read();
    assert.equal(first.fields.find((field) => field.key === 'CUSTOM_VALUE')?.readOnly, true);
    assert.throws(() => settings.update(first.revision, { CUSTOM_VALUE: 'ignored override' }), /启动环境/);
    chmodSync(file, 0o400);
    assert.throws(() => settings.update(first.revision, { PORT: '3101' }), /不可写/);
    assert.equal(readFileSync(file, 'utf8'), source);
    chmodSync(file, 0o600);
    settings.setSource(join(root, 'missing.env'));
    assert.throws(() => settings.read(), /未找到配置文件/);
    writeFileSync(join(root, 'missing.env'), source);
    assert.equal(settings.read().restartRequired, true);
    const desktopFile = join(root, 'zohome.env');
    writeFileSync(desktopFile, source.replace('FRONTEND_URL=http://localhost:5173', 'FRONTEND_URL=http://localhost:3001') + '# 监听地址\nHOST=127.0.0.1\n');
    settings.setSource(desktopFile, true);
    const desktop = settings.read();
    assert.equal(desktop.fileName, 'zohome.env');
    assert.equal(desktop.fields.find((field) => field.key === 'HOST')?.readOnly, true);
    assert.equal(desktop.fields.find((field) => field.key === 'CUSTOM_VALUE')?.readOnly, false);
    assert.throws(() => settings.update(desktop.revision, { PORT: '3101' }), /本机同端口/);
    assert.throws(() => settings.update(desktop.revision, { FRONTEND_URL: 'http://external.example:3001' }), /本机同端口/);
    const saved = settings.update(desktop.revision, { PORT: '3101', FRONTEND_URL: 'http://localhost:3101' });
    assert.equal(saved.restartRequired, true);
    const reverted = settings.update(saved.revision, { PORT: '3001', FRONTEND_URL: 'http://localhost:3001' });
    assert.equal(reverted.restartRequired, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('settings can update a writable mounted-style file when its parent directory is not writable', { skip: process.getuid?.() === 0 }, () => {
  const { root, file } = fixture();
  try {
    const settings = new SettingsService(new AppConfig());
    settings.setSource(file);
    const first = settings.read();
    chmodSync(root, 0o500);
    const saved = settings.update(first.revision, { CUSTOM_VALUE: '在原文件中写入 # 中文' });
    assert.equal(saved.restartRequired, true);
    assert.equal(parse(readFileSync(file)).CUSTOM_VALUE, '在原文件中写入 # 中文');
  } finally {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

test('settings validates externally supplied runtime values and rejects a document that would exceed the size limit', () => {
  const { root, file, source } = fixture();
  try {
    writeFileSync(file, source.replace('PORT=3001', 'PORT=ignored-invalid-value'));
    const config = Object.assign(new AppConfig(), {
      environmentOverrides: new Set(['PORT']),
      environmentValues: new Map([['PORT', '3001']]),
    });
    const settings = new SettingsService(config);
    settings.setSource(file);
    const saved = settings.update(settings.read().revision, { CUSTOM_VALUE: 'still valid' });
    assert.equal(saved.restartRequired, true);
    assert.equal(parse(readFileSync(file)).PORT, 'ignored-invalid-value');
    const maximum = 1024 * 1024;
    const padded = source + '#' + 'x'.repeat(maximum - Buffer.byteLength(source) - 2) + '\n';
    writeFileSync(file, padded);
    settings.setSource(file);
    assert.throws(() => settings.update(settings.read().revision, { CUSTOM_VALUE: 'x'.repeat(65536) }), /大小限制/);
    assert.equal(readFileSync(file, 'utf8'), padded);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

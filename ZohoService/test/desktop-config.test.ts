import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { desktopHome, loadDesktopConfiguration } from '../src/desktop-config';

test('desktop configuration creates stable private credentials without copying workspace environment', () => {
  const home = mkdtempSync(join(tmpdir(), 'zohome-desktop-config-'));
  try {
    writeFileSync(
      join(home, '.env'),
      'APP_PASSWORD=unrelated-developer-password\nTOKEN_ENCRYPTION_KEY=developer-key\n',
    );
    const first = loadDesktopConfiguration(home);
    const second = loadDesktopConfiguration(home);
    assert.equal(first.env.APP_MODE, 'demo');
    assert.ok(first.env.APP_PASSWORD.length >= 32);
    assert.match(first.env.TOKEN_ENCRYPTION_KEY, /^[a-f\d]{64}$/);
    assert.notEqual(first.env.APP_PASSWORD, 'unrelated-developer-password');
    assert.equal(first.env.APP_PASSWORD, second.env.APP_PASSWORD);
    assert.equal(
      first.env.TOKEN_ENCRYPTION_KEY,
      second.env.TOKEN_ENCRYPTION_KEY,
    );
    assert.equal(first.env.DATA_DIR, join(home, 'data'));
    assert.equal(first.env.FRONTEND_URL, 'http://localhost:3001');
    assert.equal(first.env.ZOHO_CLIENT_ID, '');
    assert.equal(first.env.ZOHO_CLIENT_SECRET, '');
    const saved = readFileSync(first.configPath, 'utf8');
    writeFileSync(
      first.configPath,
      saved
        .replace('APP_MODE=demo', 'APP_MODE=live')
        .replace('PORT=3001', 'PORT=3111'),
    );
    const changed = loadDesktopConfiguration(home);
    assert.equal(changed.env.APP_MODE, 'live');
    assert.equal(changed.env.PORT, '3111');
    assert.equal(changed.env.FRONTEND_URL, 'http://localhost:3111');
    assert.equal(
      changed.env.ZOHO_REDIRECT_URI,
      'http://localhost:3111/api/auth/zoho/callback',
    );
    assert.equal(
      changed.env.TOKEN_ENCRYPTION_KEY,
      first.env.TOKEN_ENCRYPTION_KEY,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an existing invalid desktop key fails without replacing the file or generating a new key', () => {
  const home = mkdtempSync(join(tmpdir(), 'zohome-desktop-invalid-'));
  const content =
    'APP_MODE=live\nAPP_PASSWORD=test-password-only\nTOKEN_ENCRYPTION_KEY=damaged-do-not-replace\n';
  try {
    const file = join(home, 'zohome.env');
    writeFileSync(file, content);
    assert.throws(() => loadDesktopConfiguration(home), /已有密钥不会自动重置/);
    assert.equal(readFileSync(file, 'utf8'), content);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('legacy desktop config appends only absent optional fields once and preserves CRLF source and secrets', () => {
  const home = mkdtempSync(join(tmpdir(), 'zohome-desktop-upgrade-'));
  const content = [
    '# Existing desktop settings; keep these comments and values.',
    'APP_MODE=live', 'PORT=3317', 'APP_PASSWORD=existing-desktop-password',
    `TOKEN_ENCRYPTION_KEY=${'ab'.repeat(32)}`, 'DATA_DIR=./saved-data',
    'ZOHO_CLIENT_ID=legacy-client-do-not-import', 'ZOHO_CLIENT_SECRET=legacy-secret-do-not-import',
    '# ADS_MANAGER_ACCOUNT=commented-placeholder',
    'CUSTOM_UNKNOWN="keep # this value"',
  ].join('\r\n');
  const inherited = {
    ADS_MANAGER_ACCOUNT: 'inherited-manager-do-not-copy',
    ADS_CREDENTIALS_FILE: '/inherited/private-credentials.json',
    ADS_API_VERSION: 'v1', OUTLOOK_TENANT: 'inherited-tenant',
    OUTLOOK_REDIRECT_URI: 'https://inherited.example/callback',
    ZOHO_CLIENT_ID: 'inherited-client', ZOHO_CLIENT_SECRET: 'inherited-secret',
  };
  const previous = new Map(Object.keys(inherited).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, inherited);
    const file = join(home, 'zohome.env');
    writeFileSync(file, content);
    const first = loadDesktopConfiguration(home);
    const upgraded = readFileSync(file, 'utf8');
    assert.equal(upgraded.startsWith(`${content}\r\n`), true);
    const suffix = upgraded.slice(content.length);
    assert.equal(suffix.replace(/\r\n/g, '').includes('\n'), false);
    assert.equal(suffix.replace(/\r\n/g, '').includes('\r'), false);
    for (const field of ['ADS_MANAGER_ACCOUNT', 'ADS_CREDENTIALS_FILE', 'ADS_API_VERSION', 'OUTLOOK_TENANT'])
      assert.equal((upgraded.match(new RegExp(`^${field}=`, 'gm')) || []).length, 1);
    assert.doesNotMatch(upgraded, /^OUTLOOK_REDIRECT_URI=/m);
    assert.doesNotMatch(upgraded, /inherited-/);
    assert.equal(first.env.APP_PASSWORD, 'existing-desktop-password');
    assert.equal(first.env.TOKEN_ENCRYPTION_KEY, 'ab'.repeat(32));
    assert.equal(first.env.ADS_MANAGER_ACCOUNT, '');
    assert.equal(first.env.ADS_CREDENTIALS_FILE, join(home, 'credentials.json'));
    assert.equal(first.env.ADS_API_VERSION, 'v26');
    assert.equal(first.env.OUTLOOK_TENANT, 'common');
    assert.equal(first.env.OUTLOOK_REDIRECT_URI, 'http://localhost:3317/api/auth/outlook/callback');
    assert.equal(first.env.ZOHO_CLIENT_ID, '');
    assert.equal(first.env.ZOHO_CLIENT_SECRET, '');
    assert.equal(first.env.DATA_DIR, join(home, 'saved-data'));
    assert.deepEqual(loadDesktopConfiguration(home).env, first.env);
    assert.equal(readFileSync(file, 'utf8'), upgraded);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test('existing optional desktop settings remain untouched and credential paths resolve against the workspace', () => {
  const home = mkdtempSync(join(tmpdir(), 'zohome-desktop-custom-'));
  const content = [
    'APP_MODE=demo', 'PORT=3341', 'APP_PASSWORD=existing-custom-password',
    `TOKEN_ENCRYPTION_KEY=${'cd'.repeat(32)}`,
    'ADS_MANAGER_ACCOUNT=123-456-7890', 'ADS_CREDENTIALS_FILE=../private/ads.json',
    'ADS_API_VERSION=v25', 'OUTLOOK_TENANT=consumers',
    'CUSTOM_UNKNOWN=preserved', '',
  ].join('\n');
  try {
    const file = join(home, 'zohome.env');
    writeFileSync(file, content);
    const configuration = loadDesktopConfiguration(home);
    assert.equal(readFileSync(file, 'utf8'), content);
    assert.equal(configuration.env.ADS_MANAGER_ACCOUNT, '123-456-7890');
    assert.equal(configuration.env.ADS_CREDENTIALS_FILE, resolve(home, '../private/ads.json'));
    assert.equal(configuration.env.ADS_API_VERSION, 'v25');
    assert.equal(configuration.env.OUTLOOK_TENANT, 'consumers');
    assert.equal(configuration.env.OUTLOOK_REDIRECT_URI, 'http://localhost:3341/api/auth/outlook/callback');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('invalid existing desktop port or callback is rejected before optional fields are appended', () => {
  const home = mkdtempSync(join(tmpdir(), 'zohome-desktop-invalid-upgrade-'));
  const valid = [
    'APP_MODE=live', 'APP_PASSWORD=existing-invalid-test-password',
    `TOKEN_ENCRYPTION_KEY=${'ef'.repeat(32)}`, 'PORT=3001', '',
  ].join('\n');
  try {
    const file = join(home, 'zohome.env');
    for (const content of [valid.replace('PORT=3001', 'PORT=0'),
      `${valid}OUTLOOK_REDIRECT_URI=http://localhost:3002/api/auth/outlook/callback\n`]) {
      writeFileSync(file, content);
      assert.throws(() => loadDesktopConfiguration(home));
      assert.equal(readFileSync(file, 'utf8'), content);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('desktop home uses an explicit override or Windows local application data', () => {
  assert.equal(
    desktopHome({ ZOHOME_HOME: './desktop-test' }, 'win32'),
    resolve('./desktop-test'),
  );
  assert.equal(
    desktopHome({ LOCALAPPDATA: '/temporary/local-app-data' }, 'win32'),
    join('/temporary/local-app-data', 'ZoHome'),
  );
});

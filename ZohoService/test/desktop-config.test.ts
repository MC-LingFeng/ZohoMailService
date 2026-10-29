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

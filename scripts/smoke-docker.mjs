import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { MailStore } = require('../ZohoService/dist/store');
const { encryptToken } = require('../ZohoService/dist/security');
await mkdir(join(root, '.runtime'), { recursive: true });
const work = await mkdtemp(join(root, '.runtime', 'docker-smoke-'));
const dataDir = join(work, 'data');
const configFile = join(work, '.env');
const project = `zohome-smoke-${randomUUID().slice(0, 8)}`;
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const password = randomBytes(24).toString('base64url');
const key = randomBytes(32).toString('hex');
const publicUrl = `http://localhost:${port}`;
const config = `APP_MODE=live\nAPP_PASSWORD=${password}\nTOKEN_ENCRYPTION_KEY=${key}\nFRONTEND_URL=${publicUrl}\nZOHO_REDIRECT_URI=${publicUrl}/api/auth/zoho/callback\n`;
await writeFile(configFile, config, { mode: 0o600 });
const storeConfig = {
  mode: 'live',
  live: true,
  dataDir,
  oauthConfigured: false,
};
const fixture = new MailStore(storeConfig);
fixture.saveAccount({
  id: 'docker-fixture',
  zohoAccountId: '1',
  email: 'docker-fixture@example.com',
  name: 'Existing mailbox',
  group: 'Docker fixture',
  color: '#174f46',
  status: 'connected',
  unread: 0,
  lastSyncedAt: null,
  clientId: 'docker-smoke-client',
  encryptedClientSecret: encryptToken('test-only-client-secret', key),
  encryptedRefreshToken: encryptToken('test-only-refresh-token', key),
});
fixture.onModuleDestroy();
const environment = {
  ...process.env,
  ZOHOME_ENV_FILE: configFile,
  ZOHOME_DATA_DIR: dataDir,
  ZOHOME_PORT: String(port),
  ZOHOME_BIND_HOST: '127.0.0.1',
  ZOHOME_UID: String(process.getuid?.() ?? 1000),
  ZOHOME_GID: String(process.getgid?.() ?? 1000),
};
function docker(args, allowFailure = false) {
  const result = spawnSync('docker', args, {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    timeout: 90_000,
  });
  if (!allowFailure && (result.error || result.status !== 0))
    throw new Error(
      `Docker ${args[0]} failed: ${result.error?.message || result.stderr}`,
    );
  return result.stdout.trim();
}
const compose = (args, optional = false) =>
  docker(['compose', '-p', project, ...args], optional);
const base = `http://127.0.0.1:${port}`;
async function ready() {
  for (let attempt = 0; attempt < 150; attempt++) {
    const status = await fetch(`${base}/api/status`, {
      signal: AbortSignal.timeout(500),
    }).catch(() => null);
    if (status?.ok) {
      assert.equal((await status.json()).mode, 'live');
      return;
    }
    await delay(200);
  }
  throw new Error(
    `Container startup timed out:\n${compose(['logs', '--no-color'])}`,
  );
}
async function login() {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: publicUrl },
    body: JSON.stringify({ password }),
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie').split(';')[0];
}
try {
  docker([
    'run',
    '--rm',
    '--entrypoint',
    'node',
    'zohome:local',
    '-e',
    "const fs=require('node:fs');if(fs.existsSync('/app/config/zohome.env')||fs.existsSync('/app/ZohoService/.env')||fs.readdirSync('/app/data').length)process.exit(1)",
  ]);
  compose(['up', '-d', '--no-build']);
  await ready();
  const container = compose(['ps', '-q', 'zohome']);
  const mounts = JSON.parse(
    docker(['inspect', '--format', '{{json .Mounts}}', container]),
  );
  assert.equal(
    mounts.find((mount) => mount.Destination === '/app/config/zohome.env').RW,
    false,
  );
  assert.equal(
    mounts.find((mount) => mount.Destination === '/app/data').RW,
    true,
  );
  for (const route of ['/', '/mail', '/accounts', '/guide']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /ZoHome/);
  }
  assert.equal((await fetch(`${base}/api/accounts`)).status, 401);
  const cookie = await login();
  const headers = {
    Cookie: cookie,
    Origin: publicUrl,
    'Content-Type': 'application/json',
  };
  const accounts = await (
    await fetch(`${base}/api/accounts`, { headers })
  ).json();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].email, 'docker-fixture@example.com');
  const reauth = await fetch(
    `${base}/api/accounts/docker-fixture/reauthorize`,
    { method: 'POST', headers, body: '{}' },
  );
  assert.equal(reauth.status, 201);
  assert.equal(
    new URL((await reauth.json()).url).searchParams.get('client_id'),
    'docker-smoke-client',
  );
  assert.equal(
    (
      await fetch(`${base}/api/accounts/docker-fixture`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: 'Persisted across recreation' }),
      })
    ).status,
    200,
  );
  compose(['down']);
  await assert.rejects(
    fetch(`${base}/api/status`, { signal: AbortSignal.timeout(1000) }),
  );
  assert.equal(await readFile(configFile, 'utf8'), config);
  const check = new MailStore(storeConfig);
  assert.equal(
    check.account('docker-fixture').name,
    'Persisted across recreation',
  );
  check.onModuleDestroy();
  compose(['up', '-d', '--no-build']);
  await ready();
  const secondCookie = await login();
  const second = await (
    await fetch(`${base}/api/accounts`, { headers: { Cookie: secondCookie } })
  ).json();
  assert.equal(second[0].name, 'Persisted across recreation');
  console.log(
    'Docker smoke passed: image excludes private files; local env, encrypted database, read-only config, SPA/API, stop, and container recreation verified.',
  );
} finally {
  compose(['down', '--remove-orphans'], true);
  await rm(work, { recursive: true, force: true });
}

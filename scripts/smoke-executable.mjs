import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (!process.argv[2])
  throw new Error(
    'Usage: node scripts/smoke-executable.mjs <native-executable>',
  );
const executable = resolve(process.argv[2]);
const home = await mkdtemp(join(tmpdir(), 'zohome-exe-smoke-'));
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const password = randomBytes(24).toString('base64url');
const key = randomBytes(32).toString('hex');
const initialConfig = `APP_MODE=demo\nPORT=${port}\nAPP_PASSWORD=${password}\nTOKEN_ENCRYPTION_KEY=${key}\n`;
await writeFile(
  join(home, 'zohome.env'),
  initialConfig,
  { mode: 0o600 },
);
const child = spawn(executable, [], {
  env: { ...process.env, ZOHOME_HOME: home, ZOHOME_NO_BROWSER: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
  output += String(chunk);
});
child.stderr.on('data', (chunk) => {
  output += String(chunk);
});
let startupError;
child.once('error', (error) => {
  startupError = error;
});
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (startupError) throw startupError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Executable exited during startup:\n${output}`);
    const response = await fetch(`${base}/api/status`, {
      signal: AbortSignal.timeout(500),
    }).catch(() => null);
    if (response?.ok) {
      assert.equal((await response.json()).mode, 'demo');
      ready = true;
      break;
    }
    await delay(100);
  }
  assert.equal(ready, true, `Executable startup timed out:\n${output}`);
  for (const route of ['/', '/mail', '/accounts', '/guide', '/rebates', '/settings']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /ZoHome/);
  }
  const theme = await fetch(`${base}/theme-init.js`);
  assert.equal(theme.status, 200);
  assert.match(await theme.text(), /zohome.theme/);
  const accounts = await (await fetch(`${base}/api/accounts`)).json();
  assert.equal(accounts.length, 6);
  const folderResponse = await fetch(`${base}/api/accounts/${accounts[0].id}/folders`);
  assert.equal(folderResponse.status, 200);
  const folders = await folderResponse.json();
  assert.deepEqual(folders.map((folder) => folder.type).sort(), ['inbox', 'sent', 'spam']);
  for (const folder of folders) {
    const response = await fetch(`${base}/api/accounts/${accounts[0].id}/messages?${new URLSearchParams({ folder: folder.type, folderId: folder.id })}`);
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.ok(Array.isArray(page.messages));
    assert.ok(page.messages.every((message) => message.folderId === folder.id));
  }
  const request = (path, body) => fetch(`${base}/api${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const created = await request('/rebates', {
    accountId: '', accountEmail: 'standalone@outlook.com', siteName: 'EXE smoke',
    domain: 'rewards.example.com', registeredAt: '2026-11-02', offerName: 'EXE smoke offer',
    totalRevenue: 20.5, totalCost: 7.25, settled: false, settlementCycle: '', banned: false, ip: '',
  });
  assert.equal(created.status, 201);
  const record = await created.json();
  assert.equal(record.accountUnknown, true);
  assert.equal(record.accountEmail, 'standalone@outlook.com');
  const rebates = await (await fetch(`${base}/api/rebates`)).json();
  assert.equal(rebates.total, 1);
  assert.equal(rebates.summary.totalRevenue, 20.5);
  assert.equal(rebates.summary.totalCost, 7.25);
  const options = await (await fetch(`${base}/api/rebates/options`)).json();
  assert.equal(options.accounts.find((account) => account.id === record.accountId)?.unknown, true);
  const afterAccounts = await (await fetch(`${base}/api/accounts`)).json();
  assert.deepEqual(afterAccounts, accounts);
  const settings = await (await fetch(`${base}/api/settings`)).json();
  for (const name of ['ADS_MANAGER_ACCOUNT', 'ADS_CREDENTIALS_FILE', 'ADS_API_VERSION', 'OUTLOOK_TENANT']) {
    assert.ok(settings.fields.some((field) => field.key === name), `Missing desktop setting: ${name}`);
  }
  assert.equal((await request('/auth/outlook/url', {
    email: 'standalone@outlook.com', clientId: 'smoke-client', clientSecret: 'smoke-secret',
  })).status, 400); // Demo mode must not begin a real Microsoft authorization.
  assert.equal((await request('/rebates/refresh-costs', {})).status, 400); // No manager configured; no external request.
  assert.equal((await fetch(`${base}/api/does-not-exist`)).status, 404);
  assert.equal(output.includes(password), false);
  assert.equal(output.includes(key), false);
  const configBefore = await readFile(join(home, 'zohome.env'), 'utf8');
  assert.ok(configBefore.startsWith(initialConfig));
  const exited = once(child, 'exit');
  child.kill('SIGINT');
  const [code] = await Promise.race([
    exited,
    delay(10_000).then(() => {
      throw new Error('Executable did not stop after SIGINT');
    }),
  ]);
  assert.equal(code, 0, output);
  await assert.rejects(
    fetch(`${base}/api/status`, { signal: AbortSignal.timeout(1_000) }),
  );
  assert.equal(await readFile(join(home, 'zohome.env'), 'utf8'), configBefore);
  console.log(
    'Executable smoke passed: embedded web + API + SQLite, folder discovery and selection, standalone rebate emails, upgraded desktop settings, Outlook/Ads routes, secret isolation, and stop/port release.',
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  await rm(home, { recursive: true, force: true });
}

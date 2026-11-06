import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (!process.argv[2])
  throw new Error(
    'Usage: node scripts/smoke-executable.mjs <native-executable> [window-export.xlsx]',
  );
const sourceExecutable = resolve(process.argv[2]);
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'zohome-exe-smoke-')));
const home = join(temporary, 'portable application');
const workingDirectory = join(temporary, 'unrelated working directory');
await mkdir(home);
await mkdir(workingDirectory);
const executable = join(home, basename(sourceExecutable));
await copyFile(sourceExecutable, executable);
await chmod(executable, (await stat(sourceExecutable)).mode & 0o777);
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const password = randomBytes(24).toString('base64url');
const key = randomBytes(32).toString('hex');
const initialConfig = `APP_MODE=demo\nPORT=${port}\nAPP_PASSWORD=${password}\nTOKEN_ENCRYPTION_KEY=${key}\nDATA_DIR=./data\nADS_CREDENTIALS_FILE=./credentials.json\n`;
await writeFile(
  join(home, 'zohome.env'),
  initialConfig,
  { mode: 0o600 },
);
const credentialsFile = join(home, 'credentials.json');
const initialCredentials = '{"smoke_test":"external file; never used for OAuth"}\n';
await writeFile(credentialsFile, initialCredentials, { mode: 0o600 });
const environment = { ...process.env, ZOHOME_NO_BROWSER: '1' };
delete environment.ZOHOME_HOME;
let child;
let output = '';
let startupError;
const base = `http://127.0.0.1:${port}`;

async function start(homeOverride) {
  output = '';
  startupError = undefined;
  child = spawn(executable, [], {
    cwd: workingDirectory,
    env: { ...environment, ...(homeOverride ? { ZOHOME_HOME: homeOverride } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  child.once('error', (error) => { startupError = error; });
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
}

async function stop() {
  const exited = once(child, 'exit');
  child.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGINT');
  const [code] = await Promise.race([
    exited,
    delay(10_000, undefined, { ref: false }).then(() => {
      throw new Error('Executable did not stop after termination');
    }),
  ]);
  if (process.platform !== 'win32') assert.equal(code, 0, output);
  await assert.rejects(
    fetch(`${base}/api/status`, { signal: AbortSignal.timeout(1_000) }),
  );
}

try {
  await start();
  assert.ok(output.includes(join(home, 'data')), 'Data directory must resolve beside the executable');
  assert.ok(output.includes(credentialsFile), 'Credentials must resolve beside the executable');
  assert.ok((await stat(join(home, 'data', 'demo.sqlite'))).isFile());
  for (const route of ['/', '/mail', '/accounts', '/guide', '/rebates', '/fingerprint-browsers', '/settings']) {
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
  const browserResponse = await request('/fingerprint-browsers', {
    serialNumber: '001', browserId: 'executable-smoke-browser', windowName: 'EXE smoke window',
    proxyInfo: '', accountIds: [record.accountId],
  });
  assert.equal(browserResponse.status, 201);
  const browser = await browserResponse.json();
  assert.equal(browser.accounts[0].rebates[0].id, record.id);
  if (process.argv[3]) {
    const payload = { fileName: 'window-export.xlsx', content: (await readFile(resolve(process.argv[3]))).toString('base64') };
    const previewResponse = await request('/fingerprint-browsers/import-preview', payload);
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.ok(preview.count > 0);
    assert.equal((await request('/fingerprint-browsers/import', { ...payload, confirmReplace: false })).status, 400);
    const browsers = await (await fetch(`${base}/api/fingerprint-browsers`)).json();
    assert.equal(browsers.total, 1);
    assert.equal(browsers.records[0].id, browser.id);
  }
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
  assert.equal(settings.fields.find((field) => field.key === 'DATA_DIR')?.value, './data');
  assert.equal(settings.fields.find((field) => field.key === 'ADS_CREDENTIALS_FILE')?.configured, true);
  assert.equal((await request('/auth/outlook/url', {
    email: 'standalone@outlook.com', clientId: 'smoke-client', clientSecret: 'smoke-secret',
  })).status, 400); // Demo mode must not begin a real Microsoft authorization.
  assert.equal((await request('/rebates/refresh-costs', {})).status, 400); // No manager configured; no external request.
  assert.equal((await fetch(`${base}/api/does-not-exist`)).status, 404);
  assert.equal(output.includes(password), false);
  assert.equal(output.includes(key), false);
  const configBefore = await readFile(join(home, 'zohome.env'), 'utf8');
  assert.ok(configBefore.startsWith(initialConfig));
  await stop();
  assert.equal(await readFile(join(home, 'zohome.env'), 'utf8'), configBefore);
  assert.equal(await readFile(credentialsFile, 'utf8'), initialCredentials);

  // Replace the entire stopped SQLite directory, then restore it. Neither action
  // should require repackaging the executable or regenerating the workspace key.
  const originalData = join(home, 'data-original');
  await rename(join(home, 'data'), originalData);
  await mkdir(join(home, 'data'));
  const replacementCredentials = '{"smoke_test":"replacement external file"}\n';
  await writeFile(credentialsFile, replacementCredentials, { mode: 0o600 });
  await start();
  assert.equal((await (await fetch(`${base}/api/rebates`)).json()).total, 0);
  assert.equal(await readFile(credentialsFile, 'utf8'), replacementCredentials);
  await stop();
  await rm(join(home, 'data'), { recursive: true });
  await rename(originalData, join(home, 'data'));
  await start();
  const restored = await (await fetch(`${base}/api/rebates`)).json();
  assert.equal(restored.total, 1);
  assert.equal(restored.records[0].id, record.id);
  await stop();
  assert.equal(await readFile(join(home, 'zohome.env'), 'utf8'), configBefore);

  // An explicit workspace remains supported, independently of the executable's
  // location and of the shell's current working directory.
  const overrideHome = join(temporary, 'explicit workspace');
  await mkdir(overrideHome);
  await writeFile(join(overrideHome, 'zohome.env'), configBefore, { mode: 0o600 });
  await start(overrideHome);
  assert.ok(output.includes(join(overrideHome, 'data')));
  assert.ok(output.includes(join(overrideHome, 'credentials.json')));
  assert.ok((await stat(join(overrideHome, 'data', 'demo.sqlite'))).isFile());
  assert.equal((await (await fetch(`${base}/api/rebates`)).json()).total, 0);
  await stop();
  assert.deepEqual(await readdir(workingDirectory), []);
  console.log(
    'Executable smoke passed: portable workspace independent of cwd, external database replacement/restoration and credentials preservation, explicit workspace override, embedded web + API, fingerprint browsers and optional Excel preview, folder selection, standalone rebate emails, settings, secret isolation, and stop/port release.',
  );
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  await rm(temporary, { recursive: true, force: true });
}

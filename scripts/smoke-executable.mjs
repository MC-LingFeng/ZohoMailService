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
await writeFile(
  join(home, 'zohome.env'),
  `APP_MODE=demo\nPORT=${port}\nAPP_PASSWORD=${password}\nTOKEN_ENCRYPTION_KEY=${key}\n`,
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
  for (const route of ['/', '/mail', '/accounts', '/guide']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /ZoHome/);
  }
  const theme = await fetch(`${base}/theme-init.js`);
  assert.equal(theme.status, 200);
  assert.match(await theme.text(), /zohome.theme/);
  const accounts = await (await fetch(`${base}/api/accounts`)).json();
  assert.equal(accounts.length, 6);
  assert.equal((await fetch(`${base}/api/does-not-exist`)).status, 404);
  assert.equal(output.includes(password), false);
  assert.equal(output.includes(key), false);
  const configBefore = await readFile(join(home, 'zohome.env'), 'utf8');
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
    'Executable smoke passed: embedded web + API + SQLite, SPA routes, secret isolation, and stop/port release.',
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  await rm(home, { recursive: true, force: true });
}

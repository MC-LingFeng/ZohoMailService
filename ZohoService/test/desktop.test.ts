import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/bootstrap';
import { loadDesktopConfiguration } from '../src/desktop-config';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zohome-desktop-'));
  const web = join(root, 'web');
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(
    join(web, 'index.html'),
    '<!doctype html><html><head><title>ZoHome</title></head><body>ZoHome desktop</body></html>',
  );
  writeFileSync(join(web, 'assets', 'app.js'), 'console.log("ZoHome");');
  writeFileSync(join(web, '.private'), 'must not be served');
  return { root, web };
}

test('desktop static hosting serves SPA routes and assets while unknown API routes remain JSON 404', async () => {
  const { root, web } = fixture();
  process.env.APP_MODE = 'demo';
  process.env.DATA_DIR = join(root, 'data');
  const app = await createApp({ webRoot: web, shutdownHooks: false });
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    for (const route of ['/', '/accounts', '/mail', '/guide']) {
      const page = await fetch(`${base}${route}`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type')!, /text\/html/);
      assert.match(await page.text(), /ZoHome desktop/);
    }
    const script = await fetch(`${base}/assets/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type')!, /javascript/);
    const status = await fetch(`${base}/api/status`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).name, 'ZoHome');
    const missingApi = await fetch(`${base}/api/does-not-exist`);
    assert.equal(missingApi.status, 404);
    assert.match(missingApi.headers.get('content-type')!, /application\/json/);
    assert.equal((await missingApi.json()).statusCode, 404);
    assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
    const dotfile = await fetch(`${base}/.private`);
    assert.notEqual(await dotfile.text(), 'must not be served');
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'desktop console process releases the shared web/API listener after termination',
  { timeout: 25_000 },
  async () => {
    const { root, web } = fixture();
    const home = join(root, 'home');
    const temporary = createServer();
    temporary.listen(0, '127.0.0.1');
    await once(temporary, 'listening');
    const port = (temporary.address() as { port: number }).port;
    await new Promise<void>((resolve) => temporary.close(() => resolve()));
    const configuration = loadDesktopConfiguration(home);
    writeFileSync(
      configuration.configPath,
      readFileSync(configuration.configPath, 'utf8').replace(
        'PORT=3001',
        `PORT=${port}`,
      ),
    );
    const entry = resolve(__dirname, '../src/desktop.ts');
    const code = `require(${JSON.stringify(entry)}).startDesktop({home:${JSON.stringify(home)},webRoot:${JSON.stringify(web)},openBrowser:false}).then(r=>console.log('ZOHOME_TEST_READY '+r.url)).catch(e=>{console.error(e.message);process.exitCode=1;})`;
    const child = spawn(
      process.execPath,
      ['--require', require.resolve('ts-node/register'), '-e', code],
      {
        cwd: resolve(__dirname, '..'),
        env: { ...process.env, ZOHOME_NO_BROWSER: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`desktop startup timed out: ${output}`));
        }, 15_000);
        const check = () => {
          if (output.includes('ZOHOME_TEST_READY ')) {
            cleanup();
            resolve();
          }
        };
        const exited = () => {
          cleanup();
          reject(new Error(`desktop exited before startup: ${output}`));
        };
        const cleanup = () => {
          clearTimeout(timer);
          child.stdout.off('data', check);
          child.off('exit', exited);
        };
        child.stdout.on('data', check);
        child.once('exit', exited);
        child.once('error', reject);
        check();
      });
      const base = `http://127.0.0.1:${port}`;
      assert.equal((await fetch(`${base}/`)).status, 200);
      assert.equal((await fetch(`${base}/api/status`)).status, 200);
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const [code] = await exited;
      // Node emulates kill(SIGTERM) as forced termination on Windows; the OS still releases its listeners.
      if (process.platform !== 'win32') assert.equal(code, 0);
      await assert.rejects(
        fetch(`${base}/api/status`, { signal: AbortSignal.timeout(2_000) }),
      );
      const parsed = loadDesktopConfiguration(home);
      assert.equal(output.includes(parsed.env.APP_PASSWORD), false);
      assert.equal(output.includes(parsed.env.TOKEN_ENCRYPTION_KEY), false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);

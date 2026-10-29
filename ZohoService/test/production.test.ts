import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AppConfig } from '../src/config';
import { encryptToken, decryptToken } from '../src/security';
import { MailStore } from '../src/store';

test(
  'production main reads an external env file and existing data, serves the web app, and closes on SIGTERM',
  { timeout: 25_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'zohome-production-'));
    const data = join(root, 'mounted-data');
    const web = join(root, 'web');
    mkdirSync(web);
    writeFileSync(
      join(web, 'index.html'),
      '<!doctype html><title>ZoHome mounted production</title>',
    );
    const key = 'ab'.repeat(32);
    const password = 'mounted-config-password';
    const previousMode = process.env.APP_MODE;
    process.env.APP_MODE = 'demo';
    const config = Object.assign(new AppConfig(), {
      mode: 'live',
      dataDir: data,
      encryptionKey: key,
      password,
    });
    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
    const store = new MailStore(config);
    store.saveAccount({
      id: 'us-local-fixture',
      zohoAccountId: 'local-fixture',
      email: 'saved@example.com',
      name: 'Preserved host mailbox',
      group: 'host-data',
      color: '#5164f4',
      status: 'connected',
      unread: 3,
      lastSyncedAt: null,
      clientId: 'saved-client',
      encryptedClientSecret: encryptToken('saved-secret', key),
      encryptedRefreshToken: encryptToken('saved-refresh', key),
    });
    const before = store.account('us-local-fixture')!;
    store.onModuleDestroy();
    const envFile = join(root, 'mounted.env');
    const envContent = [
      'APP_MODE=live',
      `APP_PASSWORD=${password}`,
      `TOKEN_ENCRYPTION_KEY=${key}`,
      'HOST=127.0.0.2',
      'PORT=1',
      'DATA_DIR=./wrong-data-do-not-use',
      '',
    ].join('\n');
    writeFileSync(envFile, envContent, { mode: 0o600 });
    const temporary = createServer();
    temporary.listen(0, '127.0.0.1');
    await once(temporary, 'listening');
    const port = (temporary.address() as { port: number }).port;
    await new Promise<void>((resolve) => temporary.close(() => resolve()));
    const env = { ...process.env };
    for (const variable of [
      'APP_MODE',
      'APP_PASSWORD',
      'TOKEN_ENCRYPTION_KEY',
      'ZOHO_CLIENT_ID',
      'ZOHO_CLIENT_SECRET',
      'FRONTEND_URL',
      'ZOHO_REDIRECT_URI',
      'DOTENV_CONFIG_OVERRIDE',
    ])
      delete env[variable];
    Object.assign(env, {
      DOTENV_CONFIG_PATH: envFile,
      HOST: '0.0.0.0',
      PORT: String(port),
      DATA_DIR: data,
      WEB_ROOT: web,
      TS_NODE_PROJECT: resolve(__dirname, '../tsconfig.json'),
    });
    const child = spawn(
      process.execPath,
      [
        '--require',
        require.resolve('ts-node/register'),
        resolve(__dirname, '../src/main.ts'),
      ],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
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
          reject(new Error(`production startup timed out: ${output}`));
        }, 15_000);
        const check = () => {
          if (output.includes('ZoHome Service (live):')) {
            cleanup();
            resolve();
          }
        };
        const exited = () => {
          cleanup();
          reject(new Error(`production exited before startup: ${output}`));
        };
        const errored = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          clearTimeout(timer);
          child.stdout.off('data', check);
          child.off('exit', exited);
          child.off('error', errored);
        };
        child.stdout.on('data', check);
        child.once('exit', exited);
        child.once('error', errored);
        check();
      });
      const base = `http://127.0.0.1:${port}`;
      const page = await fetch(`${base}/accounts`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /ZoHome mounted production/);
      const status = await (await fetch(`${base}/api/status`)).json();
      assert.equal(status.mode, 'live');
      assert.equal(status.authenticated, false);
      assert.equal((await fetch(`${base}/api/accounts`)).status, 401);
      const login = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://localhost:${port}`,
        },
        body: JSON.stringify({ password }),
      });
      assert.equal(login.status, 201);
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      const accounts = await (
        await fetch(`${base}/api/accounts`, { headers: { Cookie: cookie } })
      ).json();
      assert.equal(accounts.length, 1);
      assert.equal(accounts[0].email, before.email);
      assert.equal(accounts[0].name, before.name);
      const update = await fetch(`${base}/api/accounts/${before.id}`, {
        method: 'PATCH',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          Origin: `http://localhost:${port}`,
        },
        body: JSON.stringify({ name: 'Updated in mounted database' }),
      });
      assert.equal(update.status, 200);
      const missingApi = await fetch(`${base}/api/unknown`, {
        headers: { Cookie: cookie },
      });
      assert.equal(missingApi.status, 404);
      assert.match(
        missingApi.headers.get('content-type')!,
        /application\/json/,
      );
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
      await assert.rejects(
        fetch(`${base}/api/status`, { signal: AbortSignal.timeout(2_000) }),
      );
      assert.equal(readFileSync(envFile, 'utf8'), envContent);
      assert.equal(existsSync(join(root, 'wrong-data-do-not-use')), false);
      assert.equal(output.includes(password), false);
      assert.equal(output.includes(key), false);
      const reopened = new MailStore(config);
      try {
        const after = reopened.account(before.id)!;
        assert.equal(after.name, 'Updated in mounted database');
        assert.equal(after.encryptedRefreshToken, before.encryptedRefreshToken);
        assert.equal(after.encryptedClientSecret, before.encryptedClientSecret);
        assert.equal(
          decryptToken(after.encryptedRefreshToken!, key),
          'saved-refresh',
        );
      } finally {
        reopened.onModuleDestroy();
      }
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

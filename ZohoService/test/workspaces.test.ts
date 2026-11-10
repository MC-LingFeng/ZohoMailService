import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/bootstrap';
import { AppConfig } from '../src/config';
import { MailStore } from '../src/store';
import { encryptToken, decryptToken } from '../src/security';
import { PlatformStore } from '../src/platform-store';
import { WorkspaceRuntimeRegistry } from '../src/workspace-runtime';
import { ZohoClient } from '../src/zoho';

const password = 'synthetic-multi-workspace-password';
const key = 'ab'.repeat(32);
const rebate = (changes: Record<string, unknown> = {}) => ({
  accountId: '', accountEmail: 'workspace@example.com', siteName: 'Rewards', loginPassword: '  saved password !  ',
  domain: 'rewards.example.com', registeredAt: '2026-01-01', offerName: 'Saved Offer',
  totalRevenue: 10, totalCost: 2, settled: false, settlementCycle: '', banned: false, ip: '', ...changes,
});

test('migrated data, workspace APIs, authorization callbacks, secrets and sessions remain isolated and durable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zohome-workspaces-api-'));
  const configured = { APP_MODE: 'live', APP_PASSWORD: password, TOKEN_ENCRYPTION_KEY: key,
    DATA_DIR: directory, FRONTEND_URL: 'http://localhost:5173',
    ZOHO_REDIRECT_URI: 'http://localhost:5173/api/auth/zoho/callback', OUTLOOK_REDIRECT_URI: 'http://localhost:5173/api/auth/outlook/callback' };
  const previous = new Map(Object.keys(configured).map((name) => [name, process.env[name]]));
  Object.assign(process.env, configured);
  const legacy = new MailStore(new AppConfig());
  legacy.saveAccount({ id: 'us-retained', provider: 'zoho', zohoAccountId: 'retained',
    email: 'retained@example.com', name: 'Retained mailbox', group: 'Original', color: '#174f46',
    status: 'connected', unread: 1, lastSyncedAt: null, clientId: 'retained-client',
    encryptedClientSecret: encryptToken('retained client secret', key), encryptedRefreshToken: encryptToken('retained refresh token', key) });
  const originalBrowser = legacy.createFingerprintBrowser({ serialNumber: '001', browserId: 'retained-browser', windowName: 'Original window', proxyInfo: '', accountIds: ['us-retained'] });
  const savedRebate = legacy.createRebate(rebate({ fingerprintBrowserId: originalBrowser.id }) as never);
  legacy.onModuleDestroy();
  const originalBytes = readFileSync(join(directory, 'live.sqlite'));
  let app = await createApp({ shutdownHooks: false });
  try {
    await app.listen(0, '127.0.0.1');
    let base = `${await app.getUrl()}/api`;
    const login = async (username: string, loginPassword: string) => {
      const response = await fetch(`${base}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: loginPassword }) });
      assert.equal(response.status, 201, await response.clone().text());
      return response.headers.get('set-cookie')!.split(';')[0];
    };
    const request = (cookie: string, workspaceId: string | undefined, path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, {
      method, headers: { Cookie: cookie, ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const admin = await login('admin', password);
    const catalog = await (await request(admin, undefined, '/workspaces')).json();
    const a = catalog.defaultWorkspaceId as string;
    assert.equal(catalog.workspaces.length, 1);
    const accounts = await (await request(admin, a, '/accounts')).json();
    assert.equal(accounts[0].id, 'us-retained');
    assert.equal(JSON.stringify(accounts).includes('retained refresh token'), false);
    const overview = await (await request(admin, a, '/fingerprint-browsers/overview')).json();
    assert.equal(overview.rows[0].id, originalBrowser.id);
    assert.equal(overview.rows[0].sites[0].registrations[0].loginPassword, savedRebate.loginPassword);

    const created = await request(admin, undefined, '/workspaces', 'POST', { name: 'Separate workspace' });
    assert.equal(created.status, 201);
    const b = (await created.json()).id as string;
    assert.deepEqual(await (await request(admin, b, '/accounts')).json(), []);
    assert.deepEqual((await (await request(admin, b, '/fingerprint-browsers/overview')).json()).rows, []);
    assert.equal((await request(admin, b, `/accounts/us-retained`, 'PATCH', { name: 'Must not change A' })).status, 404);
    assert.equal((await request(admin, b, `/rebates/${savedRebate.id}`, 'DELETE')).status, 404);
    assert.equal((await request(admin, b, `/fingerprint-browsers/${originalBrowser.id}`, 'DELETE')).status, 404);
    assert.equal((await request(admin, b, '/fingerprint-browsers/import', 'POST', { fileName: 'not.xlsx', content: 'invalid', confirmReplace: true })).status, 400);
    assert.equal((await (await request(admin, a, '/fingerprint-browsers/overview')).json()).rows[0].id, originalBrowser.id);
    const sameEmail = await request(admin, b, '/rebates', 'POST', rebate({ loginPassword: 'B password', banned: true }));
    assert.equal(sameEmail.status, 201);
    const bRebate = await sameEmail.json();
    assert.notEqual(bRebate.id, savedRebate.id);
    const inA = await (await request(admin, a, '/rebates')).json();
    assert.equal(inA.records.length, 1);
    assert.equal(inA.records[0].loginPassword, savedRebate.loginPassword);

    const userResponse = await request(admin, undefined, '/users', 'POST', { username: 'alice', password: 'alice-workspace-password' });
    assert.equal(userResponse.status, 201);
    const aliceUser = await userResponse.json();
    assert.equal((await request(admin, undefined, `/workspaces/${a}/members`, 'POST', { username: 'alice', role: 'member' })).status, 201);
    const alice = await login('alice', 'alice-workspace-password');
    assert.equal((await request(alice, a, '/accounts')).status, 200);
    assert.equal((await request(alice, b, '/accounts')).status, 403);
    assert.equal((await request(alice, b, '/fingerprint-browsers/overview')).status, 403);
    assert.equal((await request(alice, b, '/rebates')).status, 403);
    assert.equal((await request(alice, b, '/workspace-settings')).status, 403);
    assert.equal((await request(alice, undefined, '/settings')).status, 403);
    assert.equal((await request(alice, undefined, '/users')).status, 403);
    assert.equal((await request(alice, undefined, `/workspaces/${a}`, 'PATCH', { name: 'Must not rename' })).status, 403);
    assert.equal((await (await request(alice, undefined, '/workspaces')).json()).workspaces.length, 1);
    const settings = await (await request(alice, a, '/workspace-settings')).json();
    assert.equal(settings.fields.every((field: { readOnly: boolean }) => field.readOnly), true);
    assert.equal((await request(alice, a, '/workspace-settings', 'PATCH', { revision: settings.revision, values: { ADS_MANAGER_ACCOUNT: '1234567890' } })).status, 403);
    const own = await request(alice, undefined, '/workspaces', 'POST', { name: 'Alice workspace' });
    assert.equal(own.status, 201);
    const c = (await own.json()).id;
    const cSettings = await (await request(alice, c, '/workspace-settings')).json();
    assert.equal((await request(alice, c, '/workspace-settings', 'PATCH', { revision: cSettings.revision, values: { ADS_CREDENTIALS_FILE: '/etc/passwd' } })).status, 400);
    assert.equal((await request(alice, c, '/workspace-settings', 'PATCH', { revision: cSettings.revision, values: { ZOHO_CLIENT_SECRET: 'Alice private client secret', ADS_MANAGER_ACCOUNT: '1234567890' } })).status, 200);
    const cRead = await (await request(alice, c, '/workspace-settings')).json();
    assert.equal(JSON.stringify(cRead).includes('Alice private client secret'), false);
    assert.equal(cRead.fields.find((field: { key: string }) => field.key === 'ZOHO_CLIENT_SECRET').configured, true);
    assert.equal((await (await request(admin, b, '/workspace-settings')).json()).fields.find((field: { key: string }) => field.key === 'ZOHO_CLIENT_SECRET').configured, false);

    // Callback is initiated in A, then invoked while the browser header points
    // at B. Its frozen state must resolve the runtime for A before exchange.
    const authResponse = await request(admin, a, '/auth/zoho/url', 'POST', { email: 'retained@example.com', clientId: 'callback-client', clientSecret: 'callback-secret' });
    assert.equal(authResponse.status, 201);
    const state = new URL((await authResponse.json()).url).searchParams.get('state')!;
    let calledA = 0;
    let calledB = 0;
    app.get(ZohoClient).exchangeCode = async () => { calledA++; throw new Error('Synthetic callback A'); };
    app.get(WorkspaceRuntimeRegistry).forWorkspace(b).zoho.exchangeCode = async () => { calledB++; throw new Error('Must not invoke B'); };
    const callback = await fetch(`${base}/auth/zoho/callback?state=${encodeURIComponent(state)}&code=synthetic`, { headers: { Cookie: admin, 'X-Workspace-Id': b }, redirect: 'manual' });
    assert.equal(callback.status, 302);
    assert.equal(calledA, 1);
    assert.equal(calledB, 0);
    assert.equal(new URL(callback.headers.get('location')!).searchParams.get('workspaceId'), a);

    assert.equal((await request(admin, undefined, `/workspaces/${a}/members/${aliceUser.id}`, 'DELETE')).status, 200);
    assert.equal((await request(alice, a, '/accounts')).status, 403);
    assert.equal((await request(alice, c, '/accounts')).status, 200);
    const platform = app.get(PlatformStore);
    const stored = app.get(WorkspaceRuntimeRegistry).forWorkspace(a).store.account('us-retained')!;
    assert.equal(decryptToken(stored.encryptedRefreshToken!, platform.workspaceConfig(a).encryptionKey), 'retained refresh token');
    assert.notEqual(platform.workspaceConfig(a).encryptionKey, platform.workspaceConfig(b).encryptionKey);
    assert.deepEqual(readFileSync(join(directory, 'live.sqlite')), originalBytes);
    await app.close();

    app = await createApp({ shutdownHooks: false });
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api`;
    assert.equal((await request(admin, a, '/accounts')).status, 200);
    assert.equal((await request(alice, c, '/accounts')).status, 200);
    assert.equal((await (await request(admin, b, '/rebates')).json()).records[0].loginPassword, 'B password');
    assert.equal(app.get(PlatformStore).defaultWorkspaceId, a);
    assert.equal((await request(alice, undefined, '/me/password', 'PATCH', { currentPassword: 'alice-workspace-password', password: 'new-alice-workspace-password' })).status, 200);
    assert.equal((await request(alice, c, '/accounts')).status, 401);
    const newAlice = await login('alice', 'new-alice-workspace-password');
    assert.equal((await request(newAlice, c, '/accounts')).status, 200);
    const onDisk = new DatabaseSync(join(directory, 'platform-live.sqlite'), { readOnly: true });
    try {
      const data = JSON.stringify(onDisk.prepare('SELECT * FROM users').all());
      assert.equal(data.includes('new-alice-workspace-password'), false);
      const configs = JSON.stringify(onDisk.prepare('SELECT * FROM workspaces').all());
      assert.equal(configs.includes('Alice private client secret'), false);
    } finally { onDisk.close(); }
  } finally {
    await app.close();
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(directory, { recursive: true, force: true });
  }
});

import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppConfig } from '../src/config';
import { createApp } from '../src/bootstrap';
import { FingerprintBrowserInput, FingerprintBrowserOverview } from '../src/fingerprint-browsers.types';
import { RebateInput, RebateQuery, RebateRecord } from '../src/rebates.types';
import { MailStore } from '../src/store';

const key = 'ab'.repeat(32);
const all: RebateQuery = { search: '', accountId: '', settled: 'all', banned: 'all', page: 1, pageSize: 100 };
const input = (changes: Partial<RebateInput> = {}): RebateInput => ({
  accountId: '', accountEmail: 'saved@example.com', siteName: 'Rewards A', domain: 'rewards.example.com',
  registeredAt: '2026-11-06', offerName: 'Offer A', totalRevenue: 25, totalCost: 5,
  settled: false, settlementCycle: '', banned: false, ip: '', ...changes,
});
const browserInput = (index: number, accountIds: string[] = []): FingerprintBrowserInput => ({
  serialNumber: String(index).padStart(3, '0'), browserId: `browser-${index}`,
  windowName: `Window ${index}`, proxyInfo: '', accountIds,
});
const open = (directory: string, encryptionKey = key, mode = 'live') => new MailStore({
  dataDir: directory, mode, live: mode === 'live', encryptionKey,
} as AppConfig);
function storedPassword(directory: string, mode: string, id: string) {
  const db = new DatabaseSync(join(directory, `${mode}.sqlite`));
  try { return String(db.prepare('SELECT login_password FROM rebate_registrations WHERE id=?').get(id)!.login_password); }
  finally { db.close(); }
}

test('rebate passwords preserve exact text, encrypt at rest, survive restart, and support omission versus explicit clearing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zohome-rebate-password-'));
  let store = open(directory);
  const password = '  Synthetic Pass!@# 中文  ';
  try {
    const saved = store.createRebate(input({ loginPassword: password }));
    assert.equal(saved.loginPassword, password);
    assert.match(storedPassword(directory, 'live', saved.id), /^aesgcm:/);
    assert.equal(storedPassword(directory, 'live', saved.id).includes(password), false);
    const summary = store.rebates(all).summary;
    const updated = store.updateRebate(saved.id, input({ offerName: 'Updated offer' }));
    assert.equal(updated.loginPassword, password);
    assert.equal(updated.createdAt, saved.createdAt);
    assert.deepEqual(store.rebates(all).summary, summary);
    assert.equal(store.rebates({ ...all, search: password }).total, 0);
    assert.equal(JSON.stringify(store.rebateOptions()).includes(password), false);
    assert.equal(JSON.stringify(store.rebates(all).comparison).includes(password), false);
    const browser = store.createFingerprintBrowser(browserInput(1, [saved.accountId]));
    assert.equal(JSON.stringify(store.fingerprintBrowsers()).includes(password), false);
    assert.equal(JSON.stringify(store.fingerprintBrowserOptions()).includes(password), false);
    assert.equal(store.fingerprintBrowserOverview().rows.find((row) => row.id === browser.id)!.sites[0].registrations[0].loginPassword, password);
    for (const invalid of [null, 12, ['unexpected'], 'x'.repeat(1001)]) {
      assert.throws(() => store.updateRebate(saved.id, input({ loginPassword: invalid as unknown as string })), /登录密码须为/);
      assert.equal(store.rebates(all).records[0].loginPassword, password);
    }
    store.onModuleDestroy();
    store = open(directory);
    assert.equal(store.rebates(all).records[0].loginPassword, password);
    store.onModuleDestroy();
    store = open(directory, 'cd'.repeat(32));
    assert.throws(() => store.rebates(all), /密码无法解密/);
    assert.throws(() => store.fingerprintBrowserOverview(), /密码无法解密/);
    store.onModuleDestroy();
    store = open(directory);
    assert.equal(store.rebates(all).records[0].loginPassword, password);
    assert.equal(store.updateRebate(saved.id, input({ loginPassword: '' })).loginPassword, '');
    assert.equal(storedPassword(directory, 'live', saved.id), '');
  } finally { store.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

test('a zero-configuration demo password remains usable and is encrypted on a later write after configuring a key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zohome-demo-rebate-password-'));
  let store = open(directory, '', 'demo');
  const password = '  demo synthetic password  ';
  try {
    const saved = store.createRebate(input({ loginPassword: password }));
    assert.equal(storedPassword(directory, 'demo', saved.id), `plain:${password}`);
    store.onModuleDestroy();
    store = open(directory, key, 'demo');
    assert.equal(store.rebates(all).records[0].loginPassword, password);
    assert.equal(store.updateRebate(saved.id, input()).loginPassword, password);
    assert.match(storedPassword(directory, 'demo', saved.id), /^aesgcm:/);
    assert.equal(storedPassword(directory, 'demo', saved.id).includes(password), false);
  } finally { store.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

test('an existing rebate database upgrades the password column once without changing saved records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zohome-rebate-password-upgrade-'));
  const legacy = new DatabaseSync(join(directory, 'live.sqlite'));
  legacy.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE rebate_registrations (
      id TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,standalone_email TEXT NOT NULL DEFAULT '',
      site_name TEXT NOT NULL,domain TEXT NOT NULL,registered_at TEXT NOT NULL,offer_name TEXT NOT NULL DEFAULT '',
      revenue_cents INTEGER NOT NULL DEFAULT 0,cost_cents INTEGER NOT NULL DEFAULT 0,settled INTEGER NOT NULL DEFAULT 0,
      settlement_cycle TEXT NOT NULL DEFAULT '',banned INTEGER NOT NULL DEFAULT 0,ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    INSERT INTO rebate_registrations(id,standalone_email,site_name,domain,registered_at,revenue_cents,cost_cents,created_at,updated_at)
      VALUES('legacy','old@example.com','Old site','old.example.com','2026-01-01',1025,250,'created','updated');`);
  legacy.close();
  let store = open(directory);
  try {
    const saved = store.rebates(all).records[0];
    assert.equal(saved.id, 'legacy');
    assert.equal(saved.loginPassword, '');
    assert.equal(saved.totalRevenue, 10.25);
    assert.equal(saved.createdAt, 'created');
    store.onModuleDestroy();
    store = open(directory);
    assert.deepEqual(store.rebates(all).records[0], saved);
  } finally { store.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

test('browser overview includes all rows, sites and mixed ban statuses and gives explicit browser links precedence over manually associated mailboxes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zohome-browser-overview-'));
  const store = open(directory);
  try {
    const manual = store.createRebate(input({ loginPassword: 'manual password' }));
    const direct = store.createFingerprintBrowser(browserInput(1));
    const byEmail = store.createFingerprintBrowser(browserInput(2, [manual.accountId]));
    for (let index = 3; index <= 25; index++) store.createFingerprintBrowser(browserInput(index));
    const directed = store.createRebate(input({ fingerprintBrowserId: direct.id, loginPassword: 'direct password', offerName: 'Direct offer' }));
    const secondManual = store.createRebate(input({ loginPassword: 'second password', offerName: 'Second offer', banned: true }));
    store.createRebate(input({ siteName: 'Unassociated site', accountEmail: 'unassigned@example.com' }));
    store.createRebate(input({ siteName: 'Rewards B', accountEmail: 'browser-25@example.com', fingerprintBrowserId: store.fingerprintBrowserOptions().browsers.find((browser) => browser.browserId === 'browser-25')!.id }));
    const overview = store.fingerprintBrowserOverview();
    assert.equal(store.fingerprintBrowsers().records.length, 20);
    assert.equal(overview.rows.length, 25);
    assert.deepEqual([...overview.siteNames].sort(), ['Rewards A', 'Rewards B', 'Unassociated site']);
    const directRows = overview.rows.find((row) => row.id === direct.id)!.sites.flatMap((site) => site.registrations);
    assert.deepEqual(directRows.map((record) => record.id), [directed.id]);
    assert.equal(directRows[0].loginPassword, 'direct password');
    assert.equal(directRows[0].banned, false);
    const manualRows = overview.rows.find((row) => row.id === byEmail.id)!.sites.flatMap((site) => site.registrations);
    assert.deepEqual(manualRows.map((record) => record.id).sort(), [manual.id, secondManual.id].sort());
    assert.equal(manualRows.find((record) => record.id === manual.id)!.banned, false);
    assert.equal(manualRows.find((record) => record.id === secondManual.id)!.banned, true);
    assert.equal(manualRows.some((record) => record.id === directed.id), false);
    assert.equal(overview.rows.find((row) => row.browserId === 'browser-25')!.sites[0].siteName, 'Rewards B');
    assert.equal(overview.rows.find((row) => row.browserId === 'browser-3')!.sites.length, 0);
    assert.equal(overview.rows.some((row) => row.sites.some((site) => site.siteName === 'Unassociated site')), false);
  } finally { store.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

test('password and overview APIs preserve exact values, reject invalid input, and inherit session and origin protection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zohome-rebate-password-api-'));
  const configured = {
    APP_MODE: 'live', DATA_DIR: directory, APP_PASSWORD: 'rebate-password-api-password',
    TOKEN_ENCRYPTION_KEY: key, FRONTEND_URL: 'http://localhost:5173',
    ZOHO_REDIRECT_URI: 'http://localhost:5173/api/auth/zoho/callback',
    OUTLOOK_REDIRECT_URI: 'http://localhost:5173/api/auth/outlook/callback',
  };
  const previous = new Map(Object.keys(configured).map((name) => [name, process.env[name]]));
  Object.assign(process.env, configured);
  const app = await createApp({ shutdownHooks: false });
  try {
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api`;
    assert.equal((await fetch(`${base}/fingerprint-browsers/overview`)).status, 401);
    const login = await fetch(`${base}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: configured.APP_PASSWORD }) });
    assert.equal(login.status, 201);
    const Cookie = login.headers.get('set-cookie')!.split(';')[0];
    const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
      method, headers: { Cookie, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal((await request('/fingerprint-browsers/overview', 'GET', undefined, { Origin: 'https://untrusted.example' })).status, 403);
    const password = '  synthetic API password !  ';
    const response = await request('/rebates', 'POST', input({ loginPassword: password }));
    assert.equal(response.status, 201);
    const created = await response.json() as RebateRecord;
    assert.equal(created.loginPassword, password);
    for (const invalid of [null, 123, {}, 'x'.repeat(1001)]) {
      const rejected = await request(`/rebates/${created.id}`, 'PATCH', input({ loginPassword: invalid as unknown as string }));
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.text()).includes(password), false);
    }
    const omitted = await request(`/rebates/${created.id}`, 'PATCH', input());
    assert.equal(omitted.status, 200);
    assert.equal(((await omitted.json()) as RebateRecord).loginPassword, password);
    const browser = app.get(MailStore).createFingerprintBrowser(browserInput(1, [created.accountId]));
    const bannedResponse = await request('/rebates', 'POST', input({
      banned: true, offerName: 'Banned offer', fingerprintBrowserId: browser.id,
    }));
    assert.equal(bannedResponse.status, 201);
    const banned = await bannedResponse.json() as RebateRecord;
    const overviewResponse = await request('/fingerprint-browsers/overview');
    assert.equal(overviewResponse.status, 200);
    const overview = await overviewResponse.json() as FingerprintBrowserOverview;
    const registrations = overview.rows.find((row) => row.id === browser.id)!.sites[0].registrations;
    assert.equal(registrations.find((record) => record.id === created.id)!.loginPassword, password);
    assert.equal(registrations.find((record) => record.id === created.id)!.banned, false);
    assert.equal(registrations.find((record) => record.id === banned.id)!.banned, true);
    const unbanned = await request(`/rebates/${banned.id}`, 'PATCH', input({
      banned: false, offerName: 'Banned offer', fingerprintBrowserId: browser.id,
    }));
    assert.equal(unbanned.status, 200);
    const refreshedOverview = await (await request('/fingerprint-browsers/overview')).json() as FingerprintBrowserOverview;
    assert.equal(refreshedOverview.rows.find((row) => row.id === browser.id)!.sites[0].registrations.find((record) => record.id === banned.id)!.banned, false);
    const cleared = await request(`/rebates/${created.id}`, 'PATCH', input({ loginPassword: '' }));
    assert.equal(cleared.status, 200);
    assert.equal(((await cleared.json()) as RebateRecord).loginPassword, '');
  } finally {
    await app.close();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

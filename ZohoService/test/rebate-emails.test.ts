import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/bootstrap';
import { GoogleAdsClient } from '../src/google-ads';
import { RebateInput, RebateList, RebateOptions, RebateRecord } from '../src/rebates.types';
import { MailStore } from '../src/store';
import { StoredAccount } from '../src/types';

function registration(overrides: Partial<RebateInput> = {}): RebateInput {
  return {
    accountId: '', siteName: 'Rewards', domain: 'rewards.example.com',
    registeredAt: '2026-11-02', offerName: 'Shared offer', totalRevenue: 100,
    totalCost: 25, settled: false, settlementCycle: '', banned: false, ip: '', ...overrides,
  };
}

function mailbox(): StoredAccount {
  return {
    id: 'known-mailbox', provider: 'zoho', zohoAccountId: 'known-mailbox',
    email: 'known@example.com', name: 'Known mailbox', group: 'Connected',
    color: '#5164f4', status: 'connected', unread: 0, lastSyncedAt: null,
    encryptedRefreshToken: null,
  };
}

async function open(dir: string) {
  Object.assign(process.env, {
    APP_MODE: 'live', DATA_DIR: dir, APP_PASSWORD: 'rebate-email-test-password',
    TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32), FRONTEND_URL: 'http://localhost:5173',
  });
  const app = await createApp({ shutdownHooks: false });
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const login = await fetch(`${base}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'rebate-email-test-password' }),
  });
  assert.equal(login.status, 201);
  const Cookie = login.headers.get('set-cookie')!.split(';')[0];
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { Cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const create = async (input: RebateInput) => {
    const response = await request('/rebates', 'POST', input);
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    return await response.json() as RebateRecord;
  };
  return { app, store: app.get(MailStore), request, create };
}

test('unconnected rebate emails stay isolated, normalize identity and remain selectable across filters and pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebate-emails-'));
  const h = await open(dir);
  try {
    const overview = await (await h.request('/overview')).json();
    const activity = await (await h.request('/activity')).json();
    assert.deepEqual(await (await h.request('/accounts')).json(), []);
    const first = await h.create(registration({ accountEmail: '  Person@Outlook.com  ' }));
    const second = await h.create(registration({ accountEmail: 'person@outlook.com', totalRevenue: 50 }));
    const third = await h.create(registration({ accountEmail: 'other@example.com', totalRevenue: 20 }));
    assert.equal(first.accountUnknown, true);
    assert.equal(first.accountEmail, 'person@outlook.com');
    assert.equal(first.accountName, 'person@outlook.com');
    assert.equal(first.accountGroup, '未知');
    assert.match(first.accountId, /^rebate-email:/);
    assert.equal(first.accountId, second.accountId);
    assert.notEqual(first.accountId, third.accountId);
    const list = await (await h.request('/rebates?pageSize=1')).json() as RebateList;
    assert.equal(list.records.length, 1);
    assert.equal(list.total, 3);
    assert.equal(list.summary.accountCount, 2);
    assert.equal(list.summary.totalRevenue, 170);
    assert.equal(list.comparison.find((row) => row.accountId === first.accountId)?.accountUnknown, true);
    const filtered = await (await h.request(`/rebates?accountId=${encodeURIComponent(first.accountId)}`)).json() as RebateList;
    assert.equal(filtered.total, 2);
    assert.equal(filtered.summary.totalRevenue, 150);
    assert.equal((await (await h.request('/rebates?search=PERSON%40OUTLOOK.COM')).json()).total, 2);
    assert.equal((await (await h.request(`/rebates?search=${encodeURIComponent('未知')}`)).json()).total, 3);
    const options = await (await h.request('/rebates/options')).json() as RebateOptions;
    assert.equal(options.accounts.length, 2);
    assert.equal(options.accounts.filter((item) => item.id === first.accountId).length, 1);
    assert.equal(options.accounts.find((item) => item.id === first.accountId)?.unknown, true);
    assert.doesNotMatch(JSON.stringify(options), /encryptedRefreshToken|encryptedClientSecret/);
    assert.deepEqual(await (await h.request('/accounts')).json(), []);
    assert.deepEqual(await (await h.request('/overview')).json(), overview);
    assert.deepEqual(await (await h.request('/activity')).json(), activity);
    assert.equal((await h.request(`/accounts/${first.accountId}/messages`)).status, 404);
    assert.equal((await h.request(`/accounts/${first.accountId}/sync`, 'POST')).status, 404);
  } finally { await h.app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('rebate email validation and updates preserve record identity while resolving connected mailboxes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebate-email-edit-'));
  const h = await open(dir);
  try {
    h.store.saveAccount(mailbox());
    for (const input of [
      registration(), registration({ accountEmail: 'not-an-email' }),
      registration({ accountId: 'known-mailbox', accountEmail: 'different@example.com' }),
    ]) assert.equal((await h.request('/rebates', 'POST', input)).status, 400);
    assert.ok([400, 404].includes((await h.request('/rebates', 'POST', registration({ accountId: 'rebate-email:missing' }))).status));
    assert.ok([400, 404].includes((await h.request('/rebates', 'POST', registration({ accountId: 'missing' }))).status));
    const resolved = await h.create(registration({ accountEmail: ' KNOWN@EXAMPLE.COM ' }));
    assert.equal(resolved.accountId, 'known-mailbox');
    assert.equal(resolved.accountUnknown, false);
    const unknown = await h.create(registration({ accountEmail: 'free@example.com' }));
    const boundResponse = await h.request(`/rebates/${unknown.id}`, 'PATCH', registration({ accountId: 'known-mailbox' }));
    assert.equal(boundResponse.status, 200);
    const bound = await boundResponse.json() as RebateRecord;
    assert.equal(bound.id, unknown.id);
    assert.equal(bound.createdAt, unknown.createdAt);
    assert.equal(bound.accountUnknown, false);
    assert.equal(bound.accountName, 'Known mailbox');
    const freeResponse = await h.request(`/rebates/${bound.id}`, 'PATCH', registration({ accountEmail: 'again@example.com' }));
    assert.equal(freeResponse.status, 200);
    const free = await freeResponse.json() as RebateRecord;
    assert.equal(free.id, unknown.id);
    assert.equal(free.createdAt, unknown.createdAt);
    assert.equal(free.accountUnknown, true);
    assert.equal(free.accountEmail, 'again@example.com');
    const options = await (await h.request('/rebates/options')).json() as RebateOptions;
    assert.equal(options.accounts.some((item) => item.email === 'free@example.com'), false);
    assert.equal(options.accounts.some((item) => item.email === 'again@example.com' && item.unknown), true);
    assert.equal(h.store.accounts().length, 1);
  } finally { await h.app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Ads costs split equally between a connected mailbox and an isolated email without duplicating its multiple rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebate-email-cost-'));
  const h = await open(dir);
  try {
    h.store.saveAccount(mailbox());
    const bound = await h.create(registration({ accountId: 'known-mailbox' }));
    const a = await h.create(registration({ accountEmail: 'free@example.com' }));
    const b = await h.create(registration({ accountEmail: 'FREE@example.com' }));
    h.app.get(GoogleAdsClient).campaignCosts = async () => [{
      customerId: '1234567890', campaignId: '1', campaignName: 'Shared offer', currencyCode: 'USD', costMicros: '10010000',
    }];
    const response = await h.request('/rebates/refresh-costs', 'POST');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).updatedRecords, 3);
    const costs = Object.fromEntries(h.store.rebateCostTargets().map((row) => [row.id, row.costCents]));
    const freeCents = costs[a.id] + costs[b.id];
    assert.equal(costs[bound.id] + freeCents, 1001);
    assert.ok(Math.abs(costs[bound.id] - freeCents) <= 1);
    assert.ok(Math.abs(costs[a.id] - costs[b.id]) <= 1);
    assert.equal((await h.request('/rebates/refresh-costs', 'POST')).status, 200);
    assert.deepEqual(Object.fromEntries(h.store.rebateCostTargets().map((row) => [row.id, row.costCents])), costs);
    assert.equal(h.store.accounts().length, 1);
    // Binding an email later preserves its old standalone rows and still gives that address one cost share.
    h.store.saveAccount({ ...mailbox(), id: 'bound-free', email: 'free@example.com' });
    const connectedFree = await h.create(registration({ accountId: 'bound-free' }));
    h.app.get(GoogleAdsClient).campaignCosts = async () => [{
      customerId: '1234567890', campaignId: '1', campaignName: 'Shared offer', currencyCode: 'USD', costMicros: '12000000',
    }];
    assert.equal((await h.request('/rebates/refresh-costs', 'POST')).status, 200);
    const afterBinding = Object.fromEntries(h.store.rebateCostTargets().map((row) => [row.id, row.costCents]));
    assert.equal(afterBinding[bound.id], 600);
    assert.equal(afterBinding[a.id] + afterBinding[b.id] + afterBinding[connectedFree.id], 600);
  } finally { await h.app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('legacy rebate schema migrates without losing records and standalone emails survive restart and connected-account deletion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebate-email-migration-'));
  const legacy = new DatabaseSync(join(dir, 'live.sqlite'));
  legacy.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE accounts (id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE rebate_registrations (
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      site_name TEXT NOT NULL,domain TEXT NOT NULL,registered_at TEXT NOT NULL,
      offer_name TEXT NOT NULL DEFAULT '',revenue_cents INTEGER NOT NULL DEFAULT 0 CHECK(revenue_cents>=0),
      cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(cost_cents>=0),settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0,1)),
      settlement_cycle TEXT NOT NULL DEFAULT '',banned INTEGER NOT NULL DEFAULT 0 CHECK(banned IN (0,1)),
      ip TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  legacy.prepare('INSERT INTO accounts(id,payload) VALUES(?,?)').run('known-mailbox', JSON.stringify(mailbox()));
  legacy.prepare(`INSERT INTO rebate_registrations(id,account_id,site_name,domain,registered_at,revenue_cents,cost_cents,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run('legacy-record', 'known-mailbox', 'Legacy', 'legacy.example.com', '2026-01-01', 12345, 678, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  legacy.close();
  let h = await open(dir);
  try {
    const existing = await (await h.request('/rebates')).json() as RebateList;
    assert.equal(existing.total, 1);
    assert.equal(existing.records[0].id, 'legacy-record');
    assert.equal(existing.records[0].accountUnknown, false);
    assert.equal(existing.records[0].totalRevenue, 123.45);
    assert.equal(existing.records[0].totalCost, 6.78);
    assert.equal(existing.records[0].createdAt, '2026-01-01T00:00:00.000Z');
    const free = await h.create(registration({ accountEmail: 'durable@outlook.com' }));
    await h.app.close();
    h = await open(dir);
    const reopened = await (await h.request('/rebates')).json() as RebateList;
    assert.equal(reopened.total, 2);
    assert.equal(reopened.records.find((row) => row.id === free.id)?.accountId, free.accountId);
    h.store.saveAccount({ ...mailbox(), id: 'later-bound', email: 'durable@outlook.com' });
    const afterBinding = await (await h.request(`/rebates?accountId=${encodeURIComponent(free.accountId)}`)).json() as RebateList;
    assert.equal(afterBinding.records[0].accountUnknown, true);
    assert.equal((await h.request('/accounts/later-bound', 'DELETE')).status, 200);
    assert.equal((await h.request('/accounts/known-mailbox', 'DELETE')).status, 200);
    const final = await (await h.request('/rebates')).json() as RebateList;
    assert.equal(final.total, 1);
    assert.equal(final.records[0].id, free.id);
    assert.equal(final.records[0].accountUnknown, true);
    assert.equal((await h.request(`/rebates/${free.id}`, 'DELETE')).status, 200);
    assert.equal((await (await h.request('/rebates/options')).json()).accounts.length, 0);
    assert.deepEqual(await (await h.request('/accounts')).json(), []);
  } finally { await h.app.close(); rmSync(dir, { recursive: true, force: true }); }
});

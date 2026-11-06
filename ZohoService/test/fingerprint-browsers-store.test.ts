import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppConfig } from '../src/config';
import { FingerprintBrowserInput } from '../src/fingerprint-browsers.types';
import { RebateInput, RebateQuery } from '../src/rebates.types';
import { MailStore } from '../src/store';

const all: RebateQuery = { search: '', accountId: '', settled: 'all', banned: 'all', page: 1, pageSize: 100 };
const browser = (changes: Partial<FingerprintBrowserInput> = {}): FingerprintBrowserInput => ({
  serialNumber: '001', browserId: '17000000000000000001', windowName: '工作窗口',
  proxyInfo: 'socks5://proxy.example:1080', accountIds: [], ...changes,
});
const registration = (changes: Partial<RebateInput> = {}): RebateInput => ({
  accountId: '', accountEmail: 'unknown@example.com', siteName: '返利网站', domain: 'rebate.example.com',
  registeredAt: '2026-11-06', offerName: 'Offer A', totalRevenue: 10.25, totalCost: 2.5,
  settled: false, settlementCycle: '', banned: false, ip: '', ...changes,
});
const open = (directory: string) => new MailStore({ dataDir: directory, mode: 'live', live: true } as AppConfig);

test('fingerprint browsers validate identifiers and expose selected and rebate-derived emails with all offers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zohome-fingerprint-store-'));
  const store = open(directory);
  try {
    const firstRebate = store.createRebate(registration());
    const manualRebate = store.createRebate(registration({ accountEmail: 'manual@example.com' }));
    const first = store.createFingerprintBrowser(browser({ accountIds: [manualRebate.accountId] }));
    assert.equal(first.serialNumber, '001');
    assert.equal(first.browserId, '17000000000000000001');
    assert.equal(first.accounts[0].email, 'manual@example.com');
    assert.throws(() => store.createFingerprintBrowser(browser({ serialNumber: '002' })), /ID 已存在/);
    assert.throws(() => store.createFingerprintBrowser(browser({ browserId: 'different' })), /序号已存在/);
    assert.throws(() => store.createFingerprintBrowser(browser({ browserId: 'different', serialNumber: '002', accountIds: ['arbitrary-email'] })), /关联邮箱无效/);
    assert.throws(() => store.createRebate(registration({ fingerprintBrowserId: 'made-up-id' })), /指纹浏览器不存在/);
    const linked = store.updateRebate(firstRebate.id, registration({ fingerprintBrowserId: first.id }));
    assert.equal(linked.fingerprintBrowserId, first.id);
    assert.equal(linked.fingerprintBrowserExternalId, first.browserId);
    assert.equal(linked.fingerprintBrowserSerialNumber, '001');
    for (let i = 0; i < 25; i++) store.createRebate(registration({ offerName: `Offer ${i}` }));
    const browserList = store.fingerprintBrowsers({ search: 'UNKNOWN@EXAMPLE.COM', page: 1, pageSize: 1 });
    assert.equal(browserList.total, 1);
    const email = browserList.records[0].accounts.find((account) => account.email === 'unknown@example.com')!;
    assert.equal(email.unknown, true);
    assert.equal(email.rebates.length, 26);
    assert.equal(email.rebates.find((rebate) => rebate.id === linked.id)?.siteName, '返利网站');
    assert.deepEqual(browserList.records[0].accountIds, [manualRebate.accountId]);
    assert.equal(store.fingerprintBrowserOptions().accounts.find((account) => account.id === email.id)?.rebates.length, 26);
    assert.equal(store.fingerprintBrowsers({ search: 'Offer 24', page: 1, pageSize: 20 }).total, 1);
    store.updateFingerprintBrowser(first.id, browser({ browserId: 'updated-external-id', serialNumber: '009', accountIds: [manualRebate.accountId] }));
    const updated = store.rebates(all).records.find((record) => record.id === linked.id)!;
    assert.equal(updated.fingerprintBrowserExternalId, 'updated-external-id');
    assert.equal(updated.fingerprintBrowserSerialNumber, '009');
    const cleared = store.updateRebate(linked.id, registration({ fingerprintBrowserId: '' }));
    assert.equal(cleared.fingerprintBrowserId, '');
    assert.equal(store.fingerprintBrowsers().records[0].accounts.some((account) => account.id === email.id), false);
  } finally { store.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

test('replacement is validated before changes and retains browser identity and associations while safely unlinking removed rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zohome-fingerprint-replace-'));
  const store = open(directory);
  try {
    const email = store.createRebate(registration());
    const a = store.createFingerprintBrowser(browser({ accountIds: [email.accountId] }));
    const b = store.createFingerprintBrowser(browser({ browserId: 'browser-b', serialNumber: '002' }));
    const c = store.createFingerprintBrowser(browser({ browserId: 'browser-c', serialNumber: '003' }));
    const aRebate = store.createRebate(registration({ fingerprintBrowserId: a.id }));
    const cRebate = store.createRebate(registration({ fingerprintBrowserId: c.id }));
    const before = store.fingerprintBrowsers();
    assert.throws(() => store.replaceFingerprintBrowsers([]), /有效指纹浏览器记录/);
    assert.throws(() => store.replaceFingerprintBrowsers([
      browser({ serialNumber: '004' }), browser({ serialNumber: '005' }),
    ]), /重复 ID/);
    assert.throws(() => store.replaceFingerprintBrowsers([
      browser(), browser({ browserId: 'new-browser' }),
    ]), /重复序号/);
    assert.throws(() => store.replaceFingerprintBrowsers([
      browser({ accountIds: ['missing-mailbox'] }),
    ]), /关联邮箱无效/);
    assert.deepEqual(store.fingerprintBrowsers(), before);
    const { accountIds: _ids, ...aImport } = browser({ serialNumber: b.serialNumber, windowName: '导入后的窗口' });
    const { accountIds: _other, ...bImport } = browser({ browserId: b.browserId, serialNumber: a.serialNumber });
    const result = store.replaceFingerprintBrowsers([aImport, bImport]);
    assert.deepEqual(result, { imported: 2, removed: 1, unlinkedRebates: 1 });
    const retained = store.fingerprintBrowsers().records.find((record) => record.browserId === a.browserId)!;
    assert.equal(retained.id, a.id);
    assert.equal(retained.createdAt, a.createdAt);
    assert.equal(retained.windowName, '导入后的窗口');
    assert.equal(retained.serialNumber, '002');
    assert.deepEqual(retained.accountIds, [email.accountId]);
    const rebates = store.rebates(all);
    assert.equal(rebates.total, 3);
    assert.equal(rebates.records.find((record) => record.id === aRebate.id)?.fingerprintBrowserId, a.id);
    assert.equal(rebates.records.find((record) => record.id === cRebate.id)?.fingerprintBrowserId, '');
    store.removeFingerprintBrowser(a.id);
    const removed = store.rebates(all).records.find((record) => record.id === aRebate.id)!;
    assert.equal(removed.fingerprintBrowserId, '');
    assert.equal(removed.fingerprintBrowserExternalId, '');
    assert.equal(store.rebates(all).summary.totalRevenue, 30.75);
  } finally { store.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

test('upgrading an existing standalone-email database preserves data and browser associations across repeated startup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zohome-fingerprint-upgrade-'));
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
    const original = store.rebates(all).records[0];
    assert.equal(original.id, 'legacy');
    assert.equal(original.totalRevenue, 10.25);
    assert.equal(original.createdAt, 'created');
    assert.equal(original.fingerprintBrowserId, '');
    const created = store.createFingerprintBrowser(browser({ accountIds: [original.accountId] }));
    store.updateRebate(original.id, registration({ accountEmail: 'old@example.com', fingerprintBrowserId: created.id }));
    store.onModuleDestroy();
    store = open(directory);
    assert.equal(store.rebates(all).records[0].fingerprintBrowserId, created.id);
    assert.equal(store.fingerprintBrowsers().records[0].id, created.id);
    assert.equal(store.fingerprintBrowsers().records[0].accounts[0].email, 'old@example.com');
    store.onModuleDestroy();
    store = open(directory);
    assert.equal(store.fingerprintBrowsers().total, 1);
    assert.equal(store.rebates(all).total, 1);
  } finally { store.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

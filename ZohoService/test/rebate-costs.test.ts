import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AppConfig } from '../src/config';
import { createApp } from '../src/bootstrap';
import { CampaignCost, GoogleAdsClient } from '../src/google-ads';
import { RebateCostsService } from '../src/rebate-costs.service';
import { RebateInput } from '../src/rebates.types';
import { MailStore } from '../src/store';

function input(offerName: string, overrides: Partial<RebateInput> = {}): RebateInput {
  return {
    accountId: 'demo-1', siteName: 'Rewards', domain: 'rewards.example.com',
    registeredAt: '2026-01-01', offerName, totalRevenue: 123, totalCost: 77,
    settled: false, settlementCycle: '', banned: false, ip: '', ...overrides,
  };
}

let nextCampaignId = 1;
function campaign(name: string, micros: string, currencyCode = 'USD'): CampaignCost {
  return { customerId: '1234567890', campaignId: String(nextCampaignId++), campaignName: name, currencyCode, costMicros: micros };
}

function fixture(read: () => Promise<CampaignCost[]>) {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-ads-costs-'));
  process.env.APP_MODE = 'demo';
  process.env.DATA_DIR = dir;
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.APP_PASSWORD = 'ads-cost-test-password';
  process.env.TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);
  const config = new AppConfig();
  const store = new MailStore(config);
  return {
    config, store,
    close() { this.store.onModuleDestroy(); rmSync(dir, { recursive: true, force: true }); },
    service(storeForService = store) {
      return new RebateCostsService(storeForService, { campaignCosts: read } as GoogleAdsClient);
    },
  };
}

function costs(store: MailStore) {
  return Object.fromEntries(store.rebateCostTargets().map((row) => [row.id, row.costCents]));
}

test('aggregates micros once, splits by mailbox then rows, replaces idempotently and persists', async () => {
  const f = fixture(async () => [campaign(' Offer ', '5025000'), campaign('Offer', '5025000')]);
  try {
    const a = f.store.createRebate(input('Offer', { banned: true }));
    const b = f.store.createRebate(input('Offer'));
    const c = f.store.createRebate(input('Offer', { accountId: 'demo-2' }));
    const service = f.service();
    const result = await service.refresh();
    assert.deepEqual({ ...result, refreshedAt: '' }, {
      currency: 'USD', refreshedAt: '', totalOffers: 1, updatedOffers: 1, updatedRecords: 3, issues: [],
    });
    const [first, second] = [a.id, b.id].sort();
    const expected = { [first]: 252, [second]: 251, [c.id]: 502 };
    assert.deepEqual(costs(f.store), expected);
    await service.refresh();
    assert.deepEqual(costs(f.store), expected);
    f.store.onModuleDestroy();
    f.store = new MailStore(f.config);
    assert.deepEqual(costs(f.store), expected);
    assert.equal(Object.values(costs(f.store)).reduce((a, b) => a + b, 0), 1005);
  } finally { f.close(); }
});

test('preserves missing, blank, case mismatched, non-USD and invalid costs; zero is saved', async () => {
  const f = fixture(async () => [
    campaign('Mixed', '1000000'), campaign('Mixed', '1000000', 'EUR'),
    campaign('Case', '1000000'), campaign('Bad', '-1'),
    campaign('Huge', '1000000000000010000'), campaign('Zero', '0'),
  ]);
  try {
    const names = ['Missing', ' ', 'case', 'Mixed', 'Bad', 'Huge', 'Zero'];
    const records = names.map((name) => f.store.createRebate(input(name)));
    const result = await f.service().refresh();
    assert.equal(result.totalOffers, 6);
    assert.equal(result.updatedRecords, 1);
    assert.equal(result.updatedOffers, 1);
    assert.deepEqual(result.issues.map((issue) => issue.reason).sort(),
      ['empty_offer', 'not_found', 'not_found', 'non_usd', 'invalid_cost', 'invalid_cost'].sort());
    const saved = costs(f.store);
    for (const record of records.slice(0, -1)) assert.equal(saved[record.id], 7700);
    assert.equal(saved[records.at(-1)!.id], 0);
  } finally { f.close(); }
});

test('read failure writes nothing and releases refresh lock; overlapping refresh returns 409', async () => {
  let resolveRead!: (rows: CampaignCost[]) => void;
  let rejectRead!: (error: Error) => void;
  let pending = new Promise<CampaignCost[]>((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
  const f = fixture(() => pending);
  try {
    f.store.createRebate(input('Offer'));
    const before = f.store.rebateCostTargets();
    const service = f.service();
    const first = service.refresh();
    await assert.rejects(service.refresh(), (error: unknown) =>
      error instanceof ConflictException && error.getStatus() === 409);
    rejectRead(new Error('network unavailable'));
    await assert.rejects(first, /network unavailable/);
    assert.deepEqual(f.store.rebateCostTargets(), before);
    pending = new Promise((resolve) => { resolveRead = resolve; });
    const retry = service.refresh();
    resolveRead([campaign('Offer', '1000000')]);
    assert.equal((await retry).updatedRecords, 1);
  } finally { f.close(); }
});

test('concurrent edits, additions and deletions skip each affected Offer group wholly', async () => {
  for (const mutation of ['edit', 'add', 'delete'] as const) {
    let resolveRead!: (rows: CampaignCost[]) => void;
    const f = fixture(() => new Promise((resolve) => { resolveRead = resolve; }));
    try {
      const a = f.store.createRebate(input('Offer'));
      const b = f.store.createRebate(input('Offer', { accountId: 'demo-2' }));
      const stable = f.store.createRebate(input('Stable'));
      const refresh = f.service().refresh();
      if (mutation === 'edit') f.store.updateRebate(a.id, input('Offer', { totalCost: 99 }));
      if (mutation === 'add') f.store.createRebate(input('Offer'));
      if (mutation === 'delete') f.store.removeRebate(a.id);
      const afterMutation = costs(f.store);
      resolveRead([campaign('Offer', '1000000'), campaign('Stable', '2000000')]);
      const result = await refresh;
      assert.deepEqual(result.issues.map(({ offerName, reason }) => ({ offerName, reason })),
        [{ offerName: 'Offer', reason: 'record_changed' }]);
      assert.equal(result.updatedOffers, 1);
      assert.equal(result.updatedRecords, 1);
      assert.equal(costs(f.store)[b.id], afterMutation[b.id]);
      if (mutation !== 'delete') assert.equal(costs(f.store)[a.id], afterMutation[a.id]);
      if (mutation === 'add') for (const [id, cents] of Object.entries(afterMutation))
        if (id !== stable.id) assert.equal(costs(f.store)[id], cents);
      assert.equal(costs(f.store)[stable.id], 200);
    } finally { f.close(); }
  }
});

test('invalid batch amount rolls back earlier writes in the same transaction', () => {
  const f = fixture(async () => []);
  try {
    f.store.createRebate(input('First'));
    f.store.createRebate(input('Second'));
    const before = f.store.rebateCostTargets();
    assert.throws(() => f.store.saveRebateCosts(before.map((target, index) => ({
      target, costCents: index === 0 ? 100 : -1,
    })), new Date().toISOString()), BadRequestException);
    assert.deepEqual(f.store.rebateCostTargets(), before);
    assert.equal(f.store.saveRebateCosts(before.map((target) => ({ target, costCents: 100 })),
      new Date().toISOString()).updatedRecords, 2);
  } finally { f.close(); }
});

test('refresh endpoint requires login and trusted origin, then persists through the real controller', async () => {
  const f = fixture(async () => []);
  const app = await createApp({ shutdownHooks: false });
  try {
    const config = app.get(AppConfig);
    const store = app.get(MailStore);
    store.createRebate(input('Offer'));
    Object.assign(config, { mode: 'live' });
    let reads = 0;
    app.get(GoogleAdsClient).campaignCosts = async () => { reads++; return [campaign('Offer', '1230000')]; };
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api`;
    const refresh = (headers: Record<string, string> = {}) => fetch(`${base}/rebates/refresh-costs`, { method: 'POST', headers });
    assert.equal((await refresh()).status, 401);
    const login = await fetch(`${base}/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.frontendUrl },
      body: JSON.stringify({ password: config.password }),
    });
    assert.equal(login.status, 201);
    const Cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await refresh({ Cookie, Origin: 'https://untrusted.example' })).status, 403);
    assert.equal(reads, 0);
    const response = await refresh({ Cookie, Origin: config.frontendUrl });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).updatedRecords, 1);
    assert.deepEqual(Object.values(costs(store)), [123]);
  } finally { await app.close(); f.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/bootstrap';
import {
  RebateInput,
  RebateList,
  RebateOptions,
  RebateRecord,
} from '../src/rebates.types';
import { MailStore } from '../src/store';

function configure(dir: string, mode: 'live' | 'demo' = 'demo') {
  process.env.APP_MODE = mode;
  process.env.DATA_DIR = dir;
  process.env.APP_PASSWORD = 'rebate-test-password';
  process.env.TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);
  process.env.FRONTEND_URL = 'http://localhost:5173';
}

function registration(overrides: Partial<RebateInput> = {}): RebateInput {
  return {
    accountId: 'demo-1',
    siteName: '测试返利网',
    domain: 'https://Rewards.Example.com/offers',
    registeredAt: '2026-10-29',
    offerName: '新人 offer',
    totalRevenue: 100,
    totalCost: 25,
    settled: false,
    settlementCycle: 'Net 30',
    banned: false,
    ip: '192.0.2.10',
    ...overrides,
  };
}

test('rebates persist by mailbox, aggregate all filtered records and cascade on mailbox deletion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebates-'));
  configure(dir);
  let app = await createApp();
  await app.listen(0, '127.0.0.1');
  let base = `${await app.getUrl()}/api`;
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const empty = (await (await request('/rebates')).json()) as RebateList;
    assert.equal(empty.total, 0);
    assert.equal(empty.summary.conversionRate, 0);
    assert.deepEqual(empty.comparison, []);
    const created = await request('/rebates', 'POST', registration());
    assert.equal(created.status, 201);
    const first = (await created.json()) as RebateRecord;
    assert.equal(first.accountEmail, 'alex.chen@zohomail.com');
    assert.equal(first.domain, 'rewards.example.com');
    assert.equal(first.conversionRate, 25);
    await request(
      '/rebates',
      'POST',
      registration({
        siteName: '第二个网站',
        totalRevenue: 50,
        totalCost: 10,
        settled: true,
      }),
    );
    const zero = (await (
      await request(
        '/rebates',
        'POST',
        registration({
          accountId: 'demo-2',
          totalRevenue: 0,
          totalCost: 5,
          banned: true,
        }),
      )
    ).json()) as RebateRecord;
    assert.equal(zero.conversionRate, 0);
    const list = (await (
      await request('/rebates?pageSize=1')
    ).json()) as RebateList;
    assert.equal(list.records.length, 1);
    assert.equal(list.total, 3);
    assert.deepEqual(list.summary, {
      totalRevenue: 150,
      settledRevenue: 50,
      unsettledRevenue: 100,
      totalCost: 40,
      conversionRate: 26.67,
      recordCount: 3,
      accountCount: 2,
    });
    assert.equal(list.comparison.length, 3);
    assert.equal(list.comparison[0].accountId, 'demo-1');
    assert.equal(list.comparison[0].siteName, '测试返利网');
    assert.equal(list.comparison[0].domain, 'rewards.example.com');
    assert.equal(list.comparison[0].offerName, '新人 offer');
    assert.equal(list.comparison[0].recordCount, 1);
    assert.equal(list.comparison[0].totalRevenue, 100);
    assert.equal(list.comparison[0].conversionRate, 25);
    assert.equal(list.comparison[1].siteName, '第二个网站');
    assert.equal(list.comparison[1].totalRevenue, 50);
    assert.equal(list.comparison[2].conversionRate, 0);
    const lastPage = (await (
      await request('/rebates?pageSize=1&page=999')
    ).json()) as RebateList;
    assert.equal(lastPage.page, 3);
    assert.equal(lastPage.records.length, 1);
    assert.equal(lastPage.summary.recordCount, 3);
    const filtered = (await (
      await request('/rebates?accountId=demo-1&settled=yes&banned=no')
    ).json()) as RebateList;
    assert.equal(filtered.total, 1);
    assert.equal(filtered.summary.totalRevenue, 50);
    const searched = (await (
      await request('/rebates?search=DESIGN.STUDIO')
    ).json()) as RebateList;
    assert.equal(searched.total, 1);
    const groupSearch = (await (
      await request(`/rebates?search=${encodeURIComponent('工作邮箱')}`)
    ).json()) as RebateList;
    assert.equal(groupSearch.total, 2);
    assert.equal(
      (await (await request('/rebates?search=%25')).json()).total,
      0,
    );
    const edited = await request(
      `/rebates/${first.id}`,
      'PATCH',
      registration({
        accountId: 'demo-2',
        siteName: '已更新',
        totalRevenue: 200.12,
        totalCost: 99.99,
        settled: true,
        ip: '2001:db8::1',
      }),
    );
    assert.equal(edited.status, 200);
    const updated = (await edited.json()) as RebateRecord;
    assert.equal(updated.createdAt, first.createdAt);
    assert.equal(updated.accountEmail, 'design.studio@zohomail.com');
    assert.equal(updated.totalRevenue, 200.12);
    assert.equal(updated.totalCost, 99.99);
    await request('/accounts/demo-2', 'PATCH', { name: '新邮箱名称' });
    assert.equal(
      (await (await request('/rebates?accountId=demo-2')).json()).records[0]
        .accountName,
      '新邮箱名称',
    );
    await app.close();
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api`;
    const reopened = (await (await request('/rebates')).json()) as RebateList;
    assert.equal(reopened.total, 3);
    assert.equal(
      reopened.records.find((r) => r.id === first.id)?.siteName,
      '已更新',
    );
    assert.equal(reopened.summary.totalRevenue, 250.12);
    assert.deepEqual(
      await (await request(`/rebates/${first.id}`, 'DELETE')).json(),
      { success: true },
    );
    assert.equal((await request(`/rebates/${first.id}`, 'DELETE')).status, 404);
    assert.equal((await request('/accounts/demo-2', 'DELETE')).status, 200);
    const final = (await (await request('/rebates')).json()) as RebateList;
    assert.equal(final.total, 1);
    assert.equal(final.records[0].accountId, 'demo-1');
    assert.equal(final.summary.totalRevenue, 50);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rebate comparison separates offers, sites, domains and mailboxes while aggregating the same offer across all pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebates-offers-'));
  configure(dir);
  const app = await createApp();
  try {
    const store = app.get(MailStore);
    const input = registration({
      siteName: 'Alpha',
      domain: 'rewards.example.com',
      offerName: 'Offer A',
      totalRevenue: 100,
      totalCost: 10,
      settled: true,
    });
    const first = store.createRebate(input);
    store.createRebate({
      ...input,
      totalRevenue: 50,
      totalCost: 20,
      settled: false,
    });
    store.createRebate({
      ...input,
      totalRevenue: 900,
      totalCost: 5,
      banned: true,
    });
    store.createRebate({
      ...input,
      offerName: 'Offer B',
      totalRevenue: 200,
      totalCost: 40,
    });
    store.createRebate({
      ...input,
      siteName: 'Beta',
      totalRevenue: 300,
      totalCost: 60,
    });
    store.createRebate({
      ...input,
      domain: 'other.example.com',
      totalRevenue: 400,
      totalCost: 80,
    });
    store.createRebate({
      ...input,
      accountId: 'demo-2',
      totalRevenue: 500,
      totalCost: 100,
    });
    store.createRebate({
      ...input,
      offerName: '',
      totalRevenue: 0,
      totalCost: 8,
    });
    const query = {
      search: '',
      accountId: '',
      settled: 'all' as const,
      banned: 'all' as const,
      page: 1,
      pageSize: 1,
    };
    const list = store.rebates(query);
    assert.equal(list.records.length, 1);
    assert.equal(list.total, 8);
    assert.equal(list.comparison.length, 6);
    assert.deepEqual(list.comparison.at(0), {
      accountId: 'demo-2',
      accountEmail: 'design.studio@zohomail.com',
      accountName: '设计团队',
      siteName: 'Alpha',
      domain: 'rewards.example.com',
      offerName: 'Offer A',
      totalRevenue: 500,
      settledRevenue: 500,
      unsettledRevenue: 0,
      totalCost: 100,
      conversionRate: 20,
      recordCount: 1,
    });
    const combined = list.comparison.find(
      (row) =>
        row.accountId === input.accountId &&
        row.siteName === input.siteName &&
        row.domain === input.domain &&
        row.offerName === input.offerName,
    );
    assert.deepEqual(combined, {
      accountId: 'demo-1',
      accountEmail: 'alex.chen@zohomail.com',
      accountName: 'Alex Chen',
      siteName: 'Alpha',
      domain: 'rewards.example.com',
      offerName: 'Offer A',
      totalRevenue: 150,
      settledRevenue: 100,
      unsettledRevenue: 50,
      totalCost: 35,
      conversionRate: 23.33,
      recordCount: 3,
    });
    assert.equal(list.summary.totalRevenue, 1550);
    assert.equal(list.summary.totalCost, 323);
    assert.equal(list.summary.accountCount, 2);
    assert.equal(
      list.comparison.reduce((sum, row) => sum + row.totalRevenue, 0),
      list.summary.totalRevenue,
    );
    assert.equal(
      list.comparison.reduce((sum, row) => sum + row.totalCost, 0),
      list.summary.totalCost,
    );
    assert.deepEqual(store.rebates({ ...query, page: 8 }).comparison, list.comparison);
    const filtered = store.rebates({
      ...query,
      accountId: 'demo-1',
      search: 'Offer A',
      banned: 'no',
    });
    assert.equal(filtered.comparison.length, 3);
    assert.equal(filtered.summary.totalRevenue, 850);
    assert.equal(filtered.summary.totalCost, 170);
    store.updateRebate(first.id, { ...input, offerName: 'Offer C' });
    const changed = store.rebates(query);
    assert.equal(changed.comparison.length, 7);
    assert.equal(
      changed.comparison.find((row) => row.offerName === 'Offer C')?.totalRevenue,
      100,
    );
    assert.equal(changed.summary.totalRevenue, list.summary.totalRevenue);
    assert.equal(changed.summary.totalCost, list.summary.totalCost);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rebate DTO validates date, domain, IP, money, flags and query bounds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebates-validation-'));
  configure(dir);
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const post = (body: unknown, path = '/rebates', method = 'POST') =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    for (const changes of [
      { siteName: '  ' },
      { domain: 'invalid domain' },
      { domain: 'javascript:alert(1)' },
      { domain: 'https://user:pass@example.com' },
      { domain: 'ftp://example.com' },
      { registeredAt: '2026-02-30' },
      { registeredAt: '2026-01-01T00:00:00Z' },
      { totalRevenue: -1 },
      { totalRevenue: 1.001 },
      { totalCost: '20' },
      { totalCost: null },
      { totalCost: 1_000_000_000_001 },
      { settled: 'false' },
      { banned: 1 },
      { ip: '999.0.0.1' },
      { conversionRate: 99 },
    ]) {
      assert.equal(
        (await post({ ...registration(), ...changes })).status,
        400,
        JSON.stringify(changes),
      );
    }
    assert.equal(
      (await post(registration({ accountId: 'missing' }))).status,
      404,
    );
    assert.equal(
      (await post(registration(), '/rebates/missing', 'PATCH')).status,
      404,
    );
    for (const query of [
      'page=0',
      'pageSize=101',
      'settled=invalid',
      'banned=invalid',
      'page=1.2',
    ]) {
      assert.equal(
        (await fetch(`${base}/rebates?${query}`)).status,
        400,
        query,
      );
    }
    const defaults = await post({
      accountId: 'demo-1',
      siteName: '零默认值',
      domain: 'example.com',
      registeredAt: '2024-02-29',
    });
    assert.equal(defaults.status, 201);
    const zero = (await defaults.json()) as RebateRecord;
    assert.equal(zero.totalRevenue, 0);
    assert.equal(zero.totalCost, 0);
    assert.equal(zero.conversionRate, 0);
    assert.equal(zero.settled, false);
    assert.equal(zero.banned, false);
    assert.equal(zero.ip, '');
    await post(registration({ totalRevenue: 0.1, totalCost: 0.01 }));
    await post(registration({ totalRevenue: 0.2, totalCost: 0.02 }));
    await post(
      registration({ siteName: "Àlice_'%", totalRevenue: 0, totalCost: 0 }),
    );
    const literal = (await (
      await fetch(`${base}/rebates?search=${encodeURIComponent("àLICE_'%")}`)
    ).json()) as RebateList;
    assert.equal(literal.total, 1);
    const list = (await (await fetch(`${base}/rebates`)).json()) as RebateList;
    assert.equal(list.summary.totalRevenue, 0.3);
    assert.equal(list.summary.totalCost, 0.03);
    assert.equal(list.summary.conversionRate, 10);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live rebate API requires session and rejects hostile origins on reads and writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebates-auth-'));
  configure(dir, 'live');
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  try {
    app.get(MailStore).saveAccount({
      id: 'live-test',
      email: 'local-test@example.com',
      name: 'Local test',
      group: 'test',
      color: '#000000',
      status: 'connected',
      unread: 0,
      lastSyncedAt: null,
      zohoAccountId: 'live-test',
      encryptedRefreshToken: 'must-not-leak',
    });
    assert.equal((await fetch(`${base}/rebates`)).status, 401);
    assert.equal((await fetch(`${base}/rebates/options`)).status, 401);
    assert.equal(
      (await fetch(`${base}/rebates`, { method: 'POST' })).status,
      401,
    );
    const login = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'rebate-test-password' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const created = await fetch(`${base}/rebates`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(registration({ accountId: 'live-test' })),
    });
    assert.equal(created.status, 201);
    const id = ((await created.json()) as RebateRecord).id;
    const read = await fetch(`${base}/rebates`, {
      headers: { Cookie: cookie },
    });
    const response = await read.text();
    assert.equal(read.status, 200);
    assert.equal(response.includes('must-not-leak'), false);
    assert.equal(response.includes('encryptedRefreshToken'), false);
    const options = await fetch(`${base}/rebates/options`, {
      headers: { Cookie: cookie },
    });
    assert.equal(options.status, 200);
    assert.deepEqual((await options.json()).siteNames, ['测试返利网']);
    assert.equal(
      (
        await fetch(`${base}/rebates/options`, {
          headers: { Cookie: cookie, Origin: 'https://hostile.example' },
        })
      ).status,
      403,
    );
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const path = ['PATCH', 'DELETE'].includes(method)
        ? `/rebates/${id}`
        : '/rebates';
      assert.equal(
        (
          await fetch(`${base}${path}`, {
            method,
            headers: { Cookie: cookie, Origin: 'https://hostile.example' },
          })
        ).status,
        403,
      );
    }
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rebate options deduplicate normalized saved values across all mailboxes and survive restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebates-options-'));
  configure(dir);
  let app = await createApp();
  await app.listen(0, '127.0.0.1');
  let base = `${await app.getUrl()}/api`;
  const post = async (input: RebateInput) => {
    const response = await fetch(`${base}/rebates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 201);
    return (await response.json()) as RebateRecord;
  };
  const readOptions = async () => {
    const response = await fetch(`${base}/rebates/options`);
    assert.equal(response.status, 200);
    return (await response.json()) as RebateOptions;
  };
  try {
    assert.deepEqual(await readOptions(), {
      siteNames: [],
      domains: [],
      offerNames: [],
    });
    await post(
      registration({ siteName: '  Alpha  ', offerName: '  Offer A  ' }),
    );
    await post(
      registration({
        siteName: 'Alpha',
        domain: 'rewards.example.com',
        offerName: 'Offer A',
      }),
    );
    await post(
      registration({
        accountId: 'demo-2',
        siteName: 'Beta',
        domain: 'https://OTHER.example.com/path',
        offerName: '',
      }),
    );
    const page = (await (
      await fetch(`${base}/rebates?accountId=demo-1&pageSize=1`)
    ).json()) as RebateList;
    assert.equal(page.records.length, 1);
    assert.equal(page.total, 2);
    assert.deepEqual(await readOptions(), {
      siteNames: ['Alpha', 'Beta'],
      domains: ['other.example.com', 'rewards.example.com'],
      offerNames: ['Offer A'],
    });
    await post(
      registration({
        accountId: 'demo-3',
        siteName: 'Gamma',
        domain: 'new.example.com',
        offerName: 'Offer B',
      }),
    );
    const latest = await readOptions();
    assert.deepEqual(latest, {
      siteNames: ['Alpha', 'Beta', 'Gamma'],
      domains: ['new.example.com', 'other.example.com', 'rewards.example.com'],
      offerNames: ['Offer A', 'Offer B'],
    });
    await app.close();
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api`;
    assert.deepEqual(await readOptions(), latest);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rebate summary rejects unsafe aggregate cents and still permits exact filtered totals', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebates-range-'));
  configure(dir);
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  try {
    const store = app.get(MailStore);
    for (let index = 0; index < 91; index++) {
      store.createRebate(
        registration({
          accountId: index === 90 ? 'demo-2' : 'demo-1',
          siteName: `大额记录 ${index}`,
          totalRevenue: 1_000_000_000_000,
          totalCost: 1_000_000_000_000,
        }),
      );
    }
    const overflow = await fetch(`${base}/rebates`);
    assert.equal(overflow.status, 400);
    assert.match((await overflow.json()).message, /缩小筛选范围/);
    const filtered = await fetch(`${base}/rebates?accountId=demo-2`);
    assert.equal(filtered.status, 200);
    const list = (await filtered.json()) as RebateList;
    assert.equal(list.total, 1);
    assert.equal(list.summary.totalRevenue, 1_000_000_000_000);
    assert.equal(list.summary.totalCost, 1_000_000_000_000);
    assert.equal(list.summary.conversionRate, 100);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rebate overview excludes banned revenue, retains all costs and separates settlement across all matching pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-rebates-settlement-'));
  configure(dir);
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const read = async (query = '') => {
    const response = await fetch(`${base}/rebates${query}`);
    assert.equal(response.status, 200);
    return (await response.json()) as RebateList;
  };
  const save = async (input: RebateInput, id?: string) => {
    const response = await fetch(`${base}/rebates${id ? `/${id}` : ''}`, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, id ? 200 : 201);
    return (await response.json()) as RebateRecord;
  };
  try {
    const paid = registration({
      siteName: '正常已结款',
      totalRevenue: 100,
      totalCost: 10,
      settled: true,
    });
    const unpaid = registration({
      siteName: '正常未结款',
      totalRevenue: 300,
      totalCost: 30,
      settled: false,
    });
    const bannedPaid = registration({
      siteName: '封户已结款',
      totalRevenue: 900,
      totalCost: 90,
      settled: true,
      banned: true,
    });
    const bannedUnpaid = registration({
      siteName: '封户未结款',
      totalRevenue: 700,
      totalCost: 70,
      settled: false,
      banned: true,
    });
    const paidRow = await save(paid);
    const unpaidRow = await save(unpaid);
    const bannedPaidRow = await save(bannedPaid);
    const bannedUnpaidRow = await save(bannedUnpaid);
    const list = await read('?pageSize=1');
    assert.equal(list.records.length, 1);
    assert.deepEqual(list.summary, {
      totalRevenue: 400,
      settledRevenue: 100,
      unsettledRevenue: 300,
      totalCost: 200,
      conversionRate: 50,
      recordCount: 4,
      accountCount: 1,
    });
    assert.equal(list.comparison.length, 4);
    for (const input of [paid, unpaid, bannedPaid, bannedUnpaid]) {
      const comparison = list.comparison.find(
        (row) => row.siteName === input.siteName,
      );
      assert.deepEqual(comparison, {
        accountId: 'demo-1',
        accountEmail: 'alex.chen@zohomail.com',
        accountName: 'Alex Chen',
        siteName: input.siteName,
        domain: 'rewards.example.com',
        offerName: input.offerName,
        totalRevenue: input.banned ? 0 : input.totalRevenue,
        settledRevenue: !input.banned && input.settled ? input.totalRevenue : 0,
        unsettledRevenue: !input.banned && !input.settled ? input.totalRevenue : 0,
        totalCost: input.totalCost,
        conversionRate: input.banned ? 0 : 10,
        recordCount: 1,
      });
    }
    assert.deepEqual((await read('?pageSize=1&page=2')).summary, list.summary);
    const banned = await read('?banned=yes');
    assert.equal(banned.summary.totalRevenue, 0);
    assert.equal(banned.summary.settledRevenue, 0);
    assert.equal(banned.summary.unsettledRevenue, 0);
    assert.equal(banned.summary.totalCost, 160);
    assert.equal(banned.summary.conversionRate, 0);
    assert.equal(
      banned.comparison.reduce((total, row) => total + row.totalCost, 0),
      160,
    );
    assert.equal(
      banned.records.find((record) => record.id === bannedPaidRow.id)
        ?.totalRevenue,
      900,
    );
    assert.equal(
      banned.records.find((record) => record.id === bannedPaidRow.id)
        ?.conversionRate,
      10,
    );
    assert.equal(
      banned.records.find((record) => record.id === bannedUnpaidRow.id)
        ?.totalRevenue,
      700,
    );
    const settled = await read('?settled=yes');
    assert.equal(settled.summary.totalRevenue, 100);
    assert.equal(settled.summary.settledRevenue, 100);
    assert.equal(settled.summary.unsettledRevenue, 0);
    assert.equal(settled.summary.totalCost, 100);
    const unsettled = await read('?settled=no');
    assert.equal(unsettled.summary.totalRevenue, 300);
    assert.equal(unsettled.summary.unsettledRevenue, 300);
    assert.equal(unsettled.summary.settledRevenue, 0);
    assert.equal(unsettled.summary.totalCost, 100);
    const newlyBanned = await save({ ...paid, banned: true }, paidRow.id);
    assert.equal(newlyBanned.totalRevenue, 100);
    assert.equal(newlyBanned.conversionRate, 10);
    let changed = await read();
    assert.equal(changed.summary.totalRevenue, 300);
    assert.equal(changed.summary.settledRevenue, 0);
    assert.equal(changed.summary.totalCost, 200);
    await save(
      { ...bannedPaid, banned: false, settled: false },
      bannedPaidRow.id,
    );
    await save({ ...unpaid, settled: true }, unpaidRow.id);
    changed = await read();
    assert.equal(changed.summary.totalRevenue, 1200);
    assert.equal(changed.summary.settledRevenue, 300);
    assert.equal(changed.summary.unsettledRevenue, 900);
    assert.equal(changed.summary.totalCost, 200);
    assert.equal(changed.comparison[0].siteName, bannedPaid.siteName);
    assert.equal(changed.comparison[0].unsettledRevenue, 900);
    assert.equal(
      changed.comparison.find((row) => row.siteName === unpaid.siteName)
        ?.settledRevenue,
      300,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { createApp } from '../src/bootstrap';
import { FingerprintBrowserInput, FingerprintBrowserList, FingerprintBrowserOptions, FingerprintBrowserRecord } from '../src/fingerprint-browsers.types';
import { RebateInput, RebateList, RebateRecord } from '../src/rebates.types';

type Cell = string | number | null | { numeric: string };
interface Sheet { name: string; rows: Cell[][]; merge?: string }
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const headers = ['窗口名称', '代理信息', '序号', 'ID', '密码', 'Cookie'];

// Minimal, synthetic OOXML fixtures: no real exports, proxy secrets or accounts.
function workbook(sheets: Sheet[], padding = 0) {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`),
  };
  for (const [index, sheet] of sheets.entries()) {
    const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => {
      if (cell === null) return '';
      const ref = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
      return typeof cell === 'number' || typeof cell === 'object'
        ? `<c r="${ref}"><v>${typeof cell === 'number' ? cell : cell.numeric}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData>${sheet.merge ? `<mergeCells count="1"><mergeCell ref="${sheet.merge}"/></mergeCells>` : ''}</worksheet>`);
  }
  if (padding) files['xl/media/synthetic-padding.bin'] = randomBytes(padding);
  return { fileName: 'synthetic-windows.xlsx', content: Buffer.from(zipSync(files)).toString('base64') };
}

const browser = (overrides: Partial<FingerprintBrowserInput> = {}): FingerprintBrowserInput => ({
  serialNumber: '001', browserId: 'external-browser-one', windowName: 'Synthetic window',
  proxyInfo: 'http://192.0.2.10:8080', accountIds: [], ...overrides,
});
const rebate = (overrides: Partial<RebateInput> = {}): RebateInput => ({
  accountId: '', accountEmail: 'synthetic@example.com', siteName: 'Synthetic rewards',
  domain: 'rewards.example.com', registeredAt: '2026-11-06', offerName: 'Synthetic offer',
  totalRevenue: 10, totalCost: 2, settled: false, settlementCycle: '', banned: false, ip: '', ...overrides,
});

async function json<T>(response: Response, status: number): Promise<T> {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value as T;
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-fingerprint-api-'));
  const configuration = {
    APP_MODE: 'live', DATA_DIR: dir, APP_PASSWORD: 'fingerprint-api-test-password',
    TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32), FRONTEND_URL: 'http://localhost:5173',
    ZOHO_REDIRECT_URI: 'http://localhost:5173/api/auth/zoho/callback',
    OUTLOOK_REDIRECT_URI: 'http://localhost:5173/api/auth/outlook/callback',
  };
  const previous = new Map(Object.keys(configuration).map((key) => [key, process.env[key]]));
  Object.assign(process.env, configuration);
  const app = await createApp({ shutdownHooks: false });
  const restore = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  };
  let base: string;
  let cookie: string;
  try {
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api`;
    const login = await fetch(`${base}/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: configuration.APP_PASSWORD }),
    });
    assert.equal(login.status, 201);
    cookie = login.headers.get('set-cookie')!.split(';')[0];
  } catch (error) { await app.close(); restore(); throw error; }
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, authenticated = true) => fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    request,
    list: async () => json<FingerprintBrowserList>(await request('/fingerprint-browsers'), 200),
    rebates: async () => json<RebateList>(await request('/rebates'), 200),
    createBrowser: async (input: FingerprintBrowserInput) => json<FingerprintBrowserRecord>(await request('/fingerprint-browsers', 'POST', input), 201),
    createRebate: async (input: RebateInput) => json<RebateRecord>(await request('/rebates', 'POST', input), 201),
    close: async () => { try { await app.close(); } finally { restore(); } },
  };
}

test('fingerprint browser API validates references, updates linked rebate columns and deletes without deleting rebates', async () => {
  const h = await fixture();
  try {
    const first = await h.createRebate(rebate());
    const window = await h.createBrowser(browser({ accountIds: [first.accountId] }));
    assert.notEqual(window.id, window.browserId);
    assert.equal(window.serialNumber, '001');
    assert.deepEqual(window.accountIds, [first.accountId]);
    assert.equal(window.accounts[0].rebates[0].offerName, 'Synthetic offer');
    const second = await h.createRebate(rebate({ offerName: 'Another offer', fingerprintBrowserId: window.id }));
    assert.equal(second.fingerprintBrowserExternalId, window.browserId);
    assert.equal(second.fingerprintBrowserSerialNumber, '001');
    const list = await h.list();
    assert.equal(list.records[0].accounts.length, 1);
    assert.deepEqual(list.records[0].accounts[0].rebates.map((row) => row.offerName).sort(), ['Another offer', 'Synthetic offer']);
    const options = await json<FingerprintBrowserOptions>(await h.request('/fingerprint-browsers/options'), 200);
    assert.equal(options.browsers[0].id, window.id);
    assert.equal(options.accounts[0].id, first.accountId);
    assert.equal(options.accounts[0].unknown, true);
    const invalid = await h.request('/rebates', 'POST', rebate({ fingerprintBrowserId: 'arbitrary-window' }));
    assert.equal(invalid.status, 400);
    assert.equal((await h.request(`/rebates/${second.id}`, 'PATCH', rebate({ fingerprintBrowserId: window.browserId }))).status, 400);
    assert.equal((await h.rebates()).records.find((row) => row.id === second.id)?.fingerprintBrowserId, window.id);
    const updated = await json<FingerprintBrowserRecord>(await h.request(`/fingerprint-browsers/${window.id}`, 'PATCH', browser({ browserId: 'renamed-external-id', serialNumber: '009', accountIds: [first.accountId] })), 200);
    assert.equal(updated.createdAt, window.createdAt);
    const linked = (await h.rebates()).records.find((row) => row.id === second.id)!;
    assert.equal(linked.fingerprintBrowserExternalId, 'renamed-external-id');
    assert.equal(linked.fingerprintBrowserSerialNumber, '009');
    assert.equal((await h.request(`/rebates/${second.id}`, 'PATCH', rebate({ fingerprintBrowserId: '' }))).status, 200);
    assert.equal((await h.rebates()).records.find((row) => row.id === second.id)?.fingerprintBrowserId, '');
    await h.createRebate(rebate({ fingerprintBrowserId: window.id, offerName: 'Retain after delete' }));
    assert.equal((await h.request(`/fingerprint-browsers/${window.id}`, 'DELETE')).status, 200);
    assert.equal((await h.list()).total, 0);
    assert.equal((await h.rebates()).total, 3);
    assert.ok((await h.rebates()).records.every((row) => !row.fingerprintBrowserId && !row.fingerprintBrowserExternalId && !row.fingerprintBrowserSerialNumber));
    assert.equal((await h.request(`/fingerprint-browsers/${window.id}`, 'DELETE')).status, 404);
  } finally { await h.close(); }
});

test('fingerprint endpoints require a session and allowed origin, and reject invalid browser fields and duplicate identifiers', async () => {
  const h = await fixture();
  try {
    for (const [path, method, body] of [
      ['/fingerprint-browsers', 'GET', undefined], ['/fingerprint-browsers/options', 'GET', undefined],
      ['/fingerprint-browsers', 'POST', browser()], ['/fingerprint-browsers/missing', 'PATCH', browser()],
      ['/fingerprint-browsers/missing', 'DELETE', undefined],
      ['/fingerprint-browsers/import-preview', 'POST', {}], ['/fingerprint-browsers/import', 'POST', {}],
    ] as const) assert.equal((await h.request(path, method, body, {}, false)).status, 401);
    assert.equal((await h.request('/fingerprint-browsers', 'GET', undefined, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await h.request('/fingerprint-browsers', 'POST', browser(), { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await h.request('/fingerprint-browsers/options', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    const saved = await h.createBrowser(browser());
    for (const input of [
      browser({ serialNumber: '' }), browser({ browserId: '' }), browser({ windowName: '' }),
      browser({ accountIds: ['made-up-mailbox'] }), browser({ browserId: 'different-id' }),
      browser({ serialNumber: 'different-serial' }), { ...browser({ serialNumber: '3', browserId: '3' }), unexpected: true },
    ]) assert.equal((await h.request('/fingerprint-browsers', 'POST', input)).status, 400);
    assert.deepEqual((await h.list()).records, [saved]);
    assert.equal((await h.request('/fingerprint-browsers?page=0')).status, 400);
    assert.equal((await h.request('/fingerprint-browsers?pageSize=101')).status, 400);
  } finally { await h.close(); }
});

test('window Excel preview ignores instruction and country sheets, preserves identifier text, and does not write data', async () => {
  const h = await fixture();
  try {
    const saved = await h.createBrowser(browser());
    const file = workbook([
      { name: '国家代码表', rows: [['国家名', '国家代码'], ['Synthetic country', 'XX']] },
      { name: '导出窗口', merge: 'A2:F2', rows: [headers, ['说明：此行仅用于合成导入说明'],
        ['Synthetic & <window>', 'http://192.0.2.2:8080', '0007', '001234567890123456789', 'unused-password-marker', 'unused-cookie-marker'],
        ['Numeric identifier', '', { numeric: '42' }, { numeric: '900719925474099312345' }],
        ['Integral decimal serial', '', { numeric: '60.0' }, '001'],
        [],
      ] },
    ]);
    const preview = await json<{ count: number; records: Array<Record<string, unknown>> }>(await h.request('/fingerprint-browsers/import-preview', 'POST', file), 200);
    assert.equal(preview.count, 3);
    assert.equal(preview.records[0].serialNumber, '0007');
    assert.equal(preview.records[0].browserId, '001234567890123456789');
    assert.equal(preview.records[0].windowName, 'Synthetic & <window>');
    assert.equal(preview.records[1].serialNumber, '42');
    assert.equal(preview.records[1].browserId, '900719925474099312345');
    assert.equal(preview.records[2].serialNumber, '60');
    assert.equal(preview.records[2].browserId, '001');
    assert.doesNotMatch(JSON.stringify(preview), /unused-password-marker|unused-cookie-marker|Synthetic country/);
    assert.deepEqual((await h.list()).records, [saved]);
    for (const confirmReplace of [undefined, false, 'true']) {
      const response = await h.request('/fingerprint-browsers/import', 'POST', { ...file, ...(confirmReplace === undefined ? {} : { confirmReplace }) });
      assert.equal(response.status, 400);
      assert.deepEqual((await h.list()).records, [saved]);
    }
  } finally { await h.close(); }
});

test('confirmed full replacement retains same browser ID associations and only unlinks removed browser rebates', async () => {
  const h = await fixture();
  try {
    const email = await h.createRebate(rebate());
    const keep = await h.createBrowser(browser({ serialNumber: '1', browserId: 'keep-id', accountIds: [email.accountId] }));
    const remove = await h.createBrowser(browser({ serialNumber: '2', browserId: 'remove-id' }));
    const retainedRebate = await h.createRebate(rebate({ fingerprintBrowserId: keep.id }));
    const removedRebate = await h.createRebate(rebate({ accountEmail: 'other@example.com', fingerprintBrowserId: remove.id }));
    const file = workbook([{ name: '导出窗口', rows: [headers,
      ['Updated retained window', '', '2', 'keep-id'], ['New window', '', '1', 'new-id'],
    ] }]);
    const result = await json<{ imported: number; removed: number; unlinkedRebates: number }>(await h.request('/fingerprint-browsers/import', 'POST', { ...file, confirmReplace: true }), 200);
    assert.deepEqual(result, { imported: 2, removed: 1, unlinkedRebates: 1 });
    const list = await h.list();
    assert.equal(list.total, 2);
    const kept = list.records.find((row) => row.browserId === 'keep-id')!;
    assert.equal(kept.id, keep.id);
    assert.equal(kept.createdAt, keep.createdAt);
    assert.equal(kept.serialNumber, '2');
    assert.deepEqual(kept.accountIds, [email.accountId]);
    assert.equal(list.records.some((row) => row.id === remove.id), false);
    const rebates = await h.rebates();
    assert.equal(rebates.total, 3);
    assert.equal(rebates.records.find((row) => row.id === retainedRebate.id)?.fingerprintBrowserSerialNumber, '2');
    assert.equal(rebates.records.find((row) => row.id === removedRebate.id)?.fingerprintBrowserId, '');
  } finally { await h.close(); }
});

test('invalid Excel batches are rejected before replacing existing browsers or changing rebate associations', async () => {
  const h = await fixture();
  try {
    const saved = await h.createBrowser(browser());
    await h.createRebate(rebate({ fingerprintBrowserId: saved.id }));
    const beforeBrowsers = await h.list();
    const beforeRebates = await h.rebates();
    const badRows: Cell[][][] = [
      [headers, ['A', '', '1', 'duplicate'], ['B', '', '2', 'duplicate']],
      [headers, ['A', '', 'duplicate', 'one'], ['B', '', 'duplicate', 'two']],
      [headers, ['Valid first row', '', '1', 'first'], ['Invalid later row', '', '2', '']],
      [['窗口名称', 'ID'], ['Missing serial header', 'id']],
      [headers],
      [headers, ['说明：只有说明行，不含数据']],
    ];
    const invalidFiles = badRows.map((rows) => workbook([{ name: '导出窗口', rows }]));
    invalidFiles.push({ fileName: 'broken.xlsx', content: Buffer.from('This is not an XLSX file').toString('base64') });
    invalidFiles.push({ fileName: 'wrong.xls', content: workbook([{ name: '导出窗口', rows: [headers, ['A', '', '1', 'id']] }]).content });
    invalidFiles.push({ fileName: 'bad-base64.xlsx', content: '%%%invalid%%%' });
    for (const file of invalidFiles) {
      assert.equal((await h.request('/fingerprint-browsers/import-preview', 'POST', file)).status, 400, file.fileName);
      assert.equal((await h.request('/fingerprint-browsers/import', 'POST', { ...file, confirmReplace: true })).status, 400, file.fileName);
      assert.deepEqual(await h.list(), beforeBrowsers);
      assert.deepEqual(await h.rebates(), beforeRebates);
    }
  } finally { await h.close(); }
});

test('Excel preview accepts a valid base64 JSON upload larger than the normal 100 KB body limit', async () => {
  const h = await fixture();
  try {
    const file = workbook([{ name: '导出窗口', rows: [headers, ['Large synthetic workbook', '', '001', 'large-file-id']] }], 100_000);
    assert.ok(Buffer.byteLength(JSON.stringify(file)) > 100 * 1024);
    const preview = await json<{ count: number }>(await h.request('/fingerprint-browsers/import-preview', 'POST', file), 200);
    assert.equal(preview.count, 1);
    assert.equal((await h.list()).total, 0);
  } finally { await h.close(); }
});

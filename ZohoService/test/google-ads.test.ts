import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfig } from '../src/config';
import { GoogleAdsClient } from '../src/google-ads';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const manager = '1111111111';
const nested = '2222222222';
const first = '3333333333';
const second = '4444444444';
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const child = (id: string, manager = false, level = 1) => ({
  customerClient: { clientCustomer: `customers/${id}`, manager, level },
});
const campaign = (id: string, name: string, costMicros?: string, currencyCode = 'USD') => ({
  customer: { currencyCode }, campaign: { id, name },
  metrics: costMicros === undefined ? {} : { costMicros },
});

function fixture(overrides: Partial<AppConfig> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-google-ads-'));
  const file = join(dir, 'credentials.json');
  writeFileSync(file, JSON.stringify({
    type: 'service_account', client_email: 'ads-test@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    // These fields must never control the outbound token destination.
    token_uri: 'https://untrusted.example/token',
  }));
  const config = Object.assign(new AppConfig(), {
    adsManagerAccount: '111-111-1111',
    adsCredentialsFile: file, adsApiVersion: 'v26', ...overrides,
  });
  return { config, client: new GoogleAdsClient(config), close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('Ads traverses nested manager accounts, pages complete lifetime spend, deduplicates IDs and caches signed OAuth tokens', async () => {
  const original = globalThis.fetch;
  const f = fixture();
  let authorizations = 0;
  const calls: { id: string; body: { query: string; pageToken?: string } }[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    assert.ok(init?.signal);
    if (url === 'https://oauth2.googleapis.com/token') {
      authorizations++;
      const params = new URLSearchParams(String(init?.body));
      assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const assertion = params.get('assertion')!;
      const [header, payload, signature] = assertion.split('.');
      assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      assert.equal(claims.aud, url);
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/adwords');
      assert.equal(claims.iss, 'ads-test@example.iam.gserviceaccount.com');
      assert.equal(claims.exp - claims.iat, 3600);
      assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')));
      return response({ access_token: 'test-access', expires_in: 3600 });
    }
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-access');
    assert.equal(headers.get('login-customer-id'), manager);
    assert.equal(headers.has('developer-token'), false);
    assert.match(url, /^https:\/\/googleads\.googleapis\.com\/v26\/customers\/\d+\/googleAds:search$/);
    const id = /customers\/(\d+)/.exec(url)![1];
    const body = JSON.parse(String(init?.body));
    calls.push({ id, body });
    if (id === manager) {
      if (body.pageToken) {
        assert.equal(body.pageToken, 'hierarchy-next');
        return response({ results: [child(first)] });
      }
      return response({ results: [child(manager, true, 0), child(nested, true)], nextPageToken: 'hierarchy-next' });
    }
    if (id === nested) return response({ results: [child(nested, true, 0), child(first), child(second)] });
    assert.match(body.query, /metrics\.cost_micros/);
    assert.doesNotMatch(body.query, /segments\.date|campaign\.status|WHERE|LIMIT/i);
    if (id === first) {
      if (body.pageToken) return response({ results: [campaign('101', 'Offer A', '1234567'), campaign('102', 'Paused zero offer')] });
      return response({ results: [campaign('101', 'Offer A', '1234567')], nextPageToken: 'campaign-next' });
    }
    if (id === second) return response({ results: [campaign('201', 'Removed offer', '9999999', 'EUR')] });
    throw new Error('unexpected request');
  }) as typeof fetch;
  try {
    const expected = [
      { customerId: first, campaignId: '101', campaignName: 'Offer A', currencyCode: 'USD', costMicros: '1234567' },
      { customerId: first, campaignId: '102', campaignName: 'Paused zero offer', currencyCode: 'USD', costMicros: '0' },
      { customerId: second, campaignId: '201', campaignName: 'Removed offer', currencyCode: 'EUR', costMicros: '9999999' },
    ];
    assert.deepEqual(await f.client.campaignCosts(), expected);
    assert.deepEqual(await f.client.campaignCosts(), expected);
    assert.equal(authorizations, 1);
    assert.equal(calls.filter(c => c.id === nested).length, 2);
    assert.equal(calls.filter(c => c.id === first && !c.body.pageToken).length, 2);
  } finally { globalThis.fetch = original; f.close(); }
});

test('Ads aborts the complete result on a later account failure and redacts upstream error messages', async () => {
  const original = globalThis.fetch;
  const f = fixture();
  let firstRead = false;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('oauth2.')) return response({ access_token: 'secret-access', expires_in: 3600 });
    if (url.includes(`customers/${manager}/`)) return response({ results: [child(first), child(second)] });
    if (url.includes(`customers/${first}/`)) {
      firstRead = true;
      return response({ results: [campaign('1', 'Offer', '123456789012345678')] });
    }
    return response({ error: {
      message: 'secret-access PRIVATE KEY developer-secret',
      details: [{ errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' } }] }],
    } }, 403);
  }) as typeof fetch;
  try {
    await assert.rejects(f.client.campaignCosts(), (error: Error) => {
      assert.ok(firstRead);
      assert.match(error.message, /Cloud Console/);
      assert.match(error.message, /4444444444/);
      assert.doesNotMatch(error.message, /secret-access|PRIVATE KEY|developer-secret/);
      return true;
    });
  } finally { globalThis.fetch = original; f.close(); }
});

test('Ads rejects invalid local configuration before contacting Google and keeps credential errors private', async () => {
  const original = globalThis.fetch;
  const f = fixture({ adsManagerAccount: 'bad-manager' });
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('must not call'); }) as typeof fetch;
  try {
    await assert.rejects(f.client.campaignCosts(), /ADS_MANAGER_ACCOUNT/);
    Object.assign(f.config, { adsManagerAccount: manager, adsApiVersion: 'v26/evil' });
    await assert.rejects(f.client.campaignCosts(), /ADS_API_VERSION/);
    Object.assign(f.config, { adsApiVersion: 'v26' });
    writeFileSync(f.config.adsCredentialsFile, 'PRIVATE KEY malformed content');
    await assert.rejects(f.client.campaignCosts(), (error: Error) => {
      assert.match(error.message, /工作空间设置|ADS_CREDENTIALS_FILE/);
      assert.doesNotMatch(error.message, /PRIVATE KEY malformed content/);
      return true;
    });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; f.close(); }
});

test('Ads refuses malformed responses and repeated pagination instead of returning incomplete data', async () => {
  const original = globalThis.fetch;
  const f = fixture();
  let mode: 'null' | 'campaign' | 'pagination' = 'null';
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('oauth2.')) return response({ access_token: 'test-access', expires_in: 3600 });
    if (mode === 'null') return response(null);
    if (mode === 'pagination') return response({ results: [], nextPageToken: 'repeat' });
    if (url.includes(`customers/${manager}/`)) return response({ results: [child(first)] });
    return response({ results: [{ ...campaign('1', 'Offer'), metrics: { costMicros: 100 } }] });
  }) as typeof fetch;
  try {
    await assert.rejects(f.client.campaignCosts(), /格式无效/);
    mode = 'campaign';
    await assert.rejects(f.client.campaignCosts(), /格式无效/);
    mode = 'pagination';
    await assert.rejects(f.client.campaignCosts(), /重复的分页/);
  } finally { globalThis.fetch = original; f.close(); }
});

test('Ads renews short-lived tokens and never forwards token endpoint secrets on failures', async () => {
  const original = globalThis.fetch;
  const f = fixture();
  let authorizations = 0;
  globalThis.fetch = (async (input) => {
    if (String(input).includes('oauth2.')) {
      authorizations++;
      if (authorizations > 2) return response({ error_description: 'PRIVATE_KEY_SECRET' }, 400);
      return response({ access_token: 'test-access', expires_in: 1 });
    }
    return response({ results: [] });
  }) as typeof fetch;
  try {
    assert.deepEqual(await f.client.campaignCosts(), []);
    assert.deepEqual(await f.client.campaignCosts(), []);
    assert.equal(authorizations, 2);
    await assert.rejects(f.client.campaignCosts(), (error: Error) => {
      assert.match(error.message, /授权失败/);
      assert.doesNotMatch(error.message, /PRIVATE_KEY_SECRET/);
      return true;
    });
  } finally { globalThis.fetch = original; f.close(); }
});

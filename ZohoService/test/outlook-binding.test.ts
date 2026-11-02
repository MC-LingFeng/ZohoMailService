import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/bootstrap';
import { OutlookClient } from '../src/outlook';
import { MailStore } from '../src/store';
import { decryptToken, encryptToken } from '../src/security';
import { ZohoClient } from '../src/zoho';
import { Account, MailDetail, MailMessage, StoredAccount } from '../src/types';

const encryptionKey = 'ab'.repeat(32);
const binding = { email: 'person@outlook.com', clientId: 'microsoft-app', clientSecret: 'fixture-app-secret' };

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-outlook-binding-'));
  Object.assign(process.env, {
    APP_MODE: 'live', DATA_DIR: dir, APP_PASSWORD: 'outlook-fixture-password',
    TOKEN_ENCRYPTION_KEY: encryptionKey, FRONTEND_URL: 'http://localhost:5173',
    OUTLOOK_TENANT: 'common', OUTLOOK_REDIRECT_URI: 'http://localhost:5173/api/auth/outlook/callback',
  });
  const app = await createApp({ shutdownHooks: false });
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const login = await fetch(`${base}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'outlook-fixture-password' }),
  });
  assert.equal(login.status, 201);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method, redirect: 'manual',
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const outlook = app.get(OutlookClient);
  outlook.exchangeCode = async () => ({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600 });
  outlook.profile = async () => ({ id: 'microsoft-user', email: binding.email, displayName: 'Outlook Person' });
  const begin = async () => {
    const response = await request('/auth/outlook/url', 'POST', binding);
    assert.equal(response.status, 201);
    return new URL((await response.json()).url);
  };
  const callback = (url: URL, provider = 'outlook', headers?: Record<string, string>) =>
    request(`/auth/${provider}/callback?code=fixture-code&state=${url.searchParams.get('state')}`, 'GET', undefined, headers);
  return {
    app, dir, base, outlook, request, begin, callback,
    store: app.get(MailStore),
    close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

function savedAccount(id = 'outlook-microsoft-user', overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id, provider: 'outlook', outlookUserId: id.replace(/^outlook-/, ''), zohoAccountId: '',
    email: binding.email, name: 'Outlook Person', group: 'Test', color: '#5164f4',
    status: 'connected', unread: 0, lastSyncedAt: null,
    clientId: binding.clientId, encryptedClientSecret: encryptToken(binding.clientSecret, encryptionKey),
    encryptedRefreshToken: encryptToken('fixture-refresh', encryptionKey), ...overrides,
  };
}

test('Outlook binding uses PKCE, encrypts application credentials, exposes provider and reuses saved application', async () => {
  const h = await harness();
  try {
    const url = await h.begin();
    assert.equal(url.origin, 'https://login.microsoftonline.com');
    assert.equal(url.pathname, '/common/oauth2/v2.0/authorize');
    assert.equal(url.searchParams.get('client_id'), binding.clientId);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:5173/api/auth/outlook/callback');
    assert.ok(url.searchParams.get('scope')!.includes('offline_access'));
    assert.equal(url.toString().includes(binding.clientSecret), false);
    const inspection = new DatabaseSync(join(h.dir, 'live.sqlite'), { readOnly: true });
    let verifier: string;
    try {
      const raw = String(inspection.prepare('SELECT payload FROM pending_bindings').get()!.payload);
      const pending = JSON.parse(raw);
      assert.equal(pending.provider, 'outlook');
      assert.equal(raw.includes(binding.clientSecret), false);
      assert.equal(decryptToken(pending.encryptedClientSecret, encryptionKey), binding.clientSecret);
      verifier = decryptToken(pending.encryptedCodeVerifier, encryptionKey);
      assert.equal(createHash('sha256').update(verifier).digest('base64url'), url.searchParams.get('code_challenge'));
      assert.equal(raw.includes(verifier), false);
    } finally { inspection.close(); }
    let exchanges = 0;
    h.outlook.exchangeCode = async (code, credentials, redirectUri, actualVerifier) => {
      exchanges++;
      assert.equal(code, 'fixture-code');
      assert.deepEqual(credentials, { clientId: binding.clientId, clientSecret: binding.clientSecret });
      assert.equal(actualVerifier, verifier);
      assert.equal(redirectUri, url.searchParams.get('redirect_uri'));
      return { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600 };
    };
    const callback = await h.callback(url);
    assert.equal(callback.status, 302);
    assert.equal(new URL(callback.headers.get('location')!).searchParams.get('connected'), '1');
    const accounts = (await (await h.request('/accounts')).json()) as Account[];
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].provider, 'outlook');
    const serialized = JSON.stringify(accounts);
    assert.doesNotMatch(serialized, /fixture-refresh|fixture-app-secret|encryptedRefreshToken|encryptedClientSecret/);
    const saved = h.store.account(accounts[0].id)!;
    assert.equal(decryptToken(saved.encryptedRefreshToken!, encryptionKey), 'fixture-refresh');
    assert.equal(decryptToken(saved.encryptedClientSecret!, encryptionKey), binding.clientSecret);
    const replay = await h.callback(url);
    assert.ok(new URL(replay.headers.get('location')!).searchParams.get('error'));
    assert.equal(exchanges, 1);
    const reauthorization = await h.request(`/accounts/${saved.id}/reauthorize`, 'POST');
    const reconnect = new URL((await reauthorization.json()).url);
    assert.equal(reconnect.origin, 'https://login.microsoftonline.com');
    assert.equal(reconnect.searchParams.get('client_id'), binding.clientId);
  } finally { await h.close(); }
});

test('Outlook authorization rejects unauthenticated, hostile, wrong-session, wrong-provider and wrong-mailbox binding', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/auth/outlook/url', 'POST', binding, { Cookie: '' })).status, 401);
    assert.equal((await h.request('/auth/outlook/url', 'POST', binding, { Origin: 'https://hostile.example' })).status, 403);
    const wrongSession = await h.callback(await h.begin(), 'outlook', { Cookie: 'zohome_session=unknown' });
    assert.ok(new URL(wrongSession.headers.get('location')!).searchParams.get('error'));
    let zohoCalls = 0;
    h.app.get(ZohoClient).exchangeCode = async () => { zohoCalls++; throw new Error('must not reach Zoho'); };
    const wrongProvider = await h.callback(await h.begin(), 'zoho');
    assert.ok(new URL(wrongProvider.headers.get('location')!).searchParams.get('error'));
    assert.equal(zohoCalls, 0);
    h.outlook.profile = async () => ({ id: 'other-user', email: 'different@outlook.com' });
    const mismatch = await h.callback(await h.begin());
    const location = new URL(mismatch.headers.get('location')!);
    assert.equal(location.searchParams.get('provider'), 'outlook');
    assert.ok(location.searchParams.get('error'));
    assert.equal(h.store.accounts().length, 0);
  } finally { await h.close(); }
});

test('Outlook routes map folders, preserve opaque pagination, isolate details and send through Graph once', async () => {
  const h = await harness();
  try {
    const account = savedAccount();
    h.store.saveAccount(account);
    h.store.saveAccount(savedAccount('outlook-other-user', { email: 'other@outlook.com' }));
    const calls: { path: string; method?: string; body?: unknown; query?: Record<string, string | number> }[] = [];
    const nextLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=opaque%2Bcursor&$top=1';
    h.outlook.request = async (_account, path, options = {}) => {
      calls.push({ path, ...options });
      if (options.method === 'POST') return null;
      if (path.includes('/messages/') && !path.includes('?'))
        return { id: 'message-one', body: { contentType: 'html', content: '<p>Outlook body</p>' } };
      if (path === nextLink) return { value: [] };
      if (path.endsWith('/messages')) return {
        value: [{
          id: 'message-one', parentFolderId: 'inbox-folder', subject: 'Graph subject',
          from: { emailAddress: { address: 'sender@example.com', name: 'Sender' } },
          toRecipients: [{ emailAddress: { address: binding.email } }],
          receivedDateTime: '2026-11-01T00:00:00Z', bodyPreview: 'Preview', isRead: false, hasAttachments: false,
          sentDateTime: '2026-11-01T01:00:00Z',
        }],
        ...(path.includes('/inbox/') ? { '@odata.nextLink': nextLink } : {}),
      };
      return { id: 'inbox-folder', unreadItemCount: 4 };
    };
    const first = await h.request(`/accounts/${account.id}/messages?folder=inbox&limit=1`);
    assert.equal(first.status, 200);
    const page = await first.json() as { messages: MailMessage[]; hasMore: boolean };
    assert.equal(page.hasMore, true);
    assert.equal(page.messages[0].subject, 'Graph subject');
    const second = await h.request(`/accounts/${account.id}/messages?folder=inbox&limit=1&start=2`);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).hasMore, false);
    assert.ok(calls.some((call) => call.path === nextLink));
    assert.equal(calls.some((call) => call.query && '$skip' in call.query), false);
    for (const folder of ['spam', 'sent']) assert.equal(
      (await h.request(`/accounts/${account.id}/messages?folder=${folder}&limit=1`)).status, 200);
    assert.ok(calls.some((call) => call.path.includes('/mailFolders/junkemail/messages')));
    assert.ok(calls.some((call) => call.path.includes('/mailFolders/sentitems/messages')));
    assert.ok(calls.some((call) => call.path.includes('/mailFolders/sentitems/messages') &&
      call.query?.$orderby === 'sentDateTime desc'));
    const sentPage = await h.request(`/accounts/${account.id}/messages?folder=sent&limit=1`);
    assert.equal((await sentPage.json()).messages[0].receivedAt, '2026-11-01T01:00:00.000Z');
    const message = page.messages[0];
    assert.equal((await h.request(`/accounts/${account.id}/messages/${message.id}?folderId=wrong-folder`)).status, 404);
    assert.equal((await h.request(`/accounts/outlook-other-user/messages/${message.id}?folderId=${message.folderId}`)).status, 404);
    const detailResponse = await h.request(`/accounts/${account.id}/messages/${message.id}?folderId=${message.folderId}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as MailDetail;
    assert.equal(detail.content, '<p>Outlook body</p>');
    assert.equal(detail.format, 'html');
    const send = await h.request(`/accounts/${account.id}/send`, 'POST', {
      to: 'recipient@example.com', subject: 'Fixture send', content: 'No external mail was sent',
    });
    assert.equal(send.status, 201);
    const sent = calls.filter((call) => call.method === 'POST');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].path, '/me/sendMail');
    assert.deepEqual(sent[0].body, {
      message: { subject: 'Fixture send', body: { contentType: 'Text', content: 'No external mail was sent' },
        toRecipients: [{ emailAddress: { address: 'recipient@example.com' } }] },
      saveToSentItems: true,
    });
  } finally { await h.close(); }
});

test('old accounts default to Zoho and Outlook does not inherit legacy Zoho application configuration', async () => {
  const h = await harness();
  try {
    h.store.saveAccount(savedAccount('old-zoho', { provider: undefined, outlookUserId: undefined, zohoAccountId: '123', clientId: undefined, encryptedClientSecret: undefined }));
    const accounts = await (await h.request('/accounts')).json() as Account[];
    assert.equal(accounts[0].provider, 'zoho');
    h.store.saveAccount(savedAccount('outlook-no-app', { clientId: undefined, encryptedClientSecret: undefined }));
    assert.equal((await h.request('/accounts/outlook-no-app/reauthorize', 'POST')).status, 400);
  } finally { await h.close(); }
});

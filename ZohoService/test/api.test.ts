import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/bootstrap';
import { MailMessage, Account } from '../src/types';

function configure(mode: 'demo' | 'live', dir: string) {
  process.env.APP_MODE = mode;
  process.env.DATA_DIR = dir;
  process.env.APP_PASSWORD = 'test-password-only';
  process.env.TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);
  delete process.env.ZOHO_CLIENT_ID;
  delete process.env.ZOHO_CLIENT_SECRET;
  process.env.FRONTEND_URL = 'http://localhost:5173';
}

test('demo API: seeded inbox/spam, safe send, validation and durable edits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-demo-'));
  configure('demo', dir);
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const api = async (path: string, init?: RequestInit) =>
    fetch(`${base}/api${path}`, init);
  try {
    const status = await (await api('/status')).json();
    assert.equal(status.mode, 'demo');
    const accounts = (await (await api('/accounts')).json()) as Account[];
    assert.equal(accounts.length, 6);
    assert.equal(
      JSON.stringify(accounts).includes('encryptedRefreshToken'),
      false,
    );
    const id = accounts[0].id;
    const inbox = (await (
      await api(`/accounts/${id}/messages?folder=inbox`)
    ).json()) as { messages: MailMessage[] };
    assert.equal(inbox.messages.length, 3);
    const spam = (await (
      await api(`/accounts/${id}/messages?folder=spam`)
    ).json()) as { messages: MailMessage[] };
    assert.equal(spam.messages[0].folder, 'spam');
    const message = inbox.messages[0];
    const detail = await (
      await api(
        `/accounts/${id}/messages/${message.id}?folderId=${message.folderId}`,
      )
    ).json();
    assert.equal(detail.isRead, true);
    assert.ok(detail.content.length > 10);
    const mismatch = await api(
      `/accounts/${id}/messages/${message.id}?folderId=wrong-folder`,
    );
    assert.equal(mismatch.status, 404);
    const invalid = await api(`/accounts/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'invalid',
        subject: 'test',
        content: 'hello',
      }),
    });
    assert.equal(invalid.status, 400);
    const invalidPage = await api(`/accounts/${id}/messages?limit=200000`);
    assert.equal(invalidPage.status, 400);
    const send = await api(`/accounts/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'receiver@example.com',
        subject: 'local test',
        content: 'No external mail must be sent',
      }),
    });
    assert.equal(send.status, 201);
    assert.equal((await send.json()).demo, true);
    const sent = (await (
      await api(`/accounts/${id}/messages?folder=sent`)
    ).json()) as { messages: MailMessage[] };
    assert.equal(sent.messages[0].subject, 'local test');
    const spoof = await api(`/accounts/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'receiver@example.com',
        subject: 'test',
        content: 'test',
        from: 'spoof@example.com',
      }),
    });
    assert.equal(spoof.status, 400);
    const edited = await api(`/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Changed', group: 'Testing' }),
    });
    assert.equal(edited.status, 200);
    const after = await edited.json();
    assert.equal(after.name, 'Changed');
    assert.equal(after.group, 'Testing');
    const hostile = await api('/accounts', {
      headers: { Origin: 'https://hostile.example' },
    });
    assert.equal(hostile.status, 403);
    const unavailableOAuth = await api('/auth/zoho/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'demo@example.com',
        clientId: 'demo-client',
        clientSecret: 'demo-secret',
      }),
    });
    assert.equal(unavailableOAuth.status, 400);
  } finally {
    await app.close();
  }
  const reopened = await createApp();
  await reopened.listen(0, '127.0.0.1');
  try {
    const accounts = (await (
      await fetch(`${await reopened.getUrl()}/api/accounts`)
    ).json()) as Account[];
    assert.equal(accounts[0].name, 'Changed');
  } finally {
    await reopened.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live API: password session is required and OAuth callback is protected from forged state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-live-'));
  configure('live', dir);
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  try {
    assert.equal((await fetch(`${base}/accounts`)).status, 401);
    const invalid = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    assert.equal(invalid.status, 401);
    const login = await fetch(`${base}/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({ password: 'test-password-only' }),
    });
    assert.equal(login.status, 201);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.ok(login.headers.get('set-cookie')!.includes('HttpOnly'));
    const accounts = await fetch(`${base}/accounts`, {
      headers: { Cookie: cookie },
    });
    assert.equal(accounts.status, 200);
    assert.deepEqual(await accounts.json(), []);
    const authorization = await (
      await fetch(`${base}/auth/zoho/url`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'first@example.com',
          clientId: 'manual-client',
          clientSecret: 'manual-secret',
        }),
      })
    ).json();
    const url = new URL(authorization.url);
    assert.equal(url.origin, 'https://accounts.zoho.com');
    assert.equal(url.searchParams.get('client_id'), 'manual-client');
    assert.equal(url.toString().includes('manual-secret'), false);
    assert.equal(
      (await fetch(`${base}/auth/zoho/url`, { headers: { Cookie: cookie } }))
        .status,
      404,
    );
    const incomplete = await fetch(`${base}/auth/zoho/url`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'first@example.com' }),
    });
    assert.equal(incomplete.status, 400);
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.ok(url.searchParams.get('state'));
    const callback = await fetch(
      `${base}/auth/zoho/callback?state=forged&code=fake&accounts-server=https://hostile.example`,
      { headers: { Cookie: cookie }, redirect: 'manual' },
    );
    assert.equal(callback.status, 302);
    assert.ok(
      callback.headers
        .get('location')!
        .startsWith('http://localhost:5173/accounts?error='),
    );
    await fetch(`${base}/session`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    assert.equal(
      (await fetch(`${base}/accounts`, { headers: { Cookie: cookie } })).status,
      401,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

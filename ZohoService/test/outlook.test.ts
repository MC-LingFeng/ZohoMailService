import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AppConfig } from '../src/config';
import { OutlookClient } from '../src/outlook';
import { decryptToken, encryptToken } from '../src/security';
import { MailStore } from '../src/store';
import { StoredAccount } from '../src/types';

const key = 'ab'.repeat(32);
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
const token = (index = 1) => json({ access_token: `access-${index}`, expires_in: 3600, refresh_token: `refresh-${index}` });

function fixture() {
  const config = Object.assign(new AppConfig(), {
    mode: 'live', encryptionKey: key, outlookTenant: 'common',
    outlookScopes: 'User.Read Mail.Read Mail.Send offline_access',
  });
  let account: StoredAccount | null = {
    id: 'outlook-user', zohoAccountId: '', email: 'mail@example.com', name: 'Original',
    group: 'Original group', color: '#000000', status: 'connected', unread: 0, lastSyncedAt: null,
    clientId: 'client-id', encryptedClientSecret: encryptToken('client-secret', key),
    encryptedRefreshToken: encryptToken('refresh-initial', key),
  };
  const store = {
    account: () => account,
    saveAccount: (value: StoredAccount) => { account = value; },
  } as unknown as MailStore;
  const client = new OutlookClient(config, store);
  return { config, client, store, original: account, current: () => account,
    replace: (value: StoredAccount | null) => { account = value; } };
}

async function mocked(handler: typeof fetch, check: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { await check(); } finally { globalThis.fetch = original; }
}

test('Microsoft code exchange uses PKCE and fixed tenant; profile also verifies a real mailbox', async () => {
  const f = fixture();
  const requests: string[] = [];
  await mocked((async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    assert.equal(init?.redirect, 'error');
    if (url.hostname === 'login.microsoftonline.com') {
      assert.equal(url.pathname, '/common/oauth2/v2.0/token');
      const body = init!.body as URLSearchParams;
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('code_verifier'), 'verifier-value');
      assert.equal(body.get('redirect_uri'), 'https://app.example/api/auth/outlook/callback');
      assert.equal(body.get('client_secret'), 'client-secret');
      assert.match(body.get('scope')!, /offline_access/);
      return token();
    }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access-1');
    if (url.pathname === '/v1.0/me') return json({ id: 'user-1', mail: 'MAIL@EXAMPLE.COM', displayName: 'Person' });
    assert.equal(url.pathname, '/v1.0/me/mailFolders/inbox');
    return json({ id: 'inbox-1' });
  }) as typeof fetch, async () => {
    const result = await f.client.exchangeCode('auth-code', { clientId: 'client-id', clientSecret: 'client-secret' },
      'https://app.example/api/auth/outlook/callback', 'verifier-value');
    assert.equal(result.refresh_token, 'refresh-1');
    assert.deepEqual(await f.client.profile(result.access_token), { id: 'user-1', email: 'mail@example.com', displayName: 'Person' });
    assert.equal(requests.length, 3);
  });
});

test('concurrent reads share refresh, rotate token securely and preserve the latest account metadata', async () => {
  const f = fixture();
  let refreshes = 0;
  let graphReads = 0;
  await mocked((async (input, init) => {
    if (String(input).includes('oauth2/v2.0/token')) {
      refreshes++;
      assert.equal((init!.body as URLSearchParams).get('refresh_token'), refreshes === 1 ? 'refresh-initial' : 'refresh-1');
      f.replace({ ...f.current()!, name: 'Edited while refreshing', group: 'Current group' });
      return token(refreshes);
    }
    graphReads++;
    return json({ value: [] });
  }) as typeof fetch, async () => {
    await Promise.all([
      f.client.request(f.original, '/me/mailFolders/inbox/messages'),
      f.client.request(f.original, '/me/mailFolders/sentitems/messages'),
    ]);
    assert.equal(refreshes, 1);
    assert.equal(graphReads, 2);
    assert.equal(f.current()!.name, 'Edited while refreshing');
    assert.equal(f.current()!.group, 'Current group');
    assert.equal(decryptToken(f.current()!.encryptedRefreshToken!, key), 'refresh-1');
    assert.notEqual(f.current()!.encryptedRefreshToken, 'refresh-1');
    await f.client.request(f.original, '/me/mailFolders/inbox/messages');
    assert.equal(refreshes, 1);
    f.client.forget(f.original.id);
    await f.client.request(f.original, '/me/mailFolders/inbox/messages');
    assert.equal(refreshes, 2);
  });
});

test('GET retries an explicit 401 once using the rotated refresh token and preserves nextLink cursor', async () => {
  const f = fixture();
  let refreshes = 0;
  let reads = 0;
  const nextLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=opaque%2Bcursor';
  await mocked((async (input, init) => {
    if (String(input).includes('oauth2/v2.0/token')) {
      refreshes++;
      assert.equal((init!.body as URLSearchParams).get('refresh_token'), refreshes === 1 ? 'refresh-initial' : 'refresh-1');
      return token(refreshes);
    }
    reads++;
    assert.equal(String(input), nextLink);
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer access-${refreshes}`);
    return reads === 1 ? json({ error: { message: 'private detail' } }, 401) : json({ value: [{ id: 'mail-1' }] });
  }) as typeof fetch, async () => {
    assert.deepEqual(await f.client.request(f.original, nextLink), { value: [{ id: 'mail-1' }] });
    assert.equal(refreshes, 2);
    assert.equal(reads, 2);
  });
});

test('POST 202 returns no JSON, and rejected or interrupted sends are never retried', async () => {
  for (const outcome of ['accepted', 'unauthorized', 'interrupted'] as const) {
    const f = fixture();
    let sends = 0;
    await mocked((async (input) => {
      if (String(input).includes('oauth2/v2.0/token')) return token();
      sends++;
      if (outcome === 'interrupted') throw new Error('private request headers');
      return outcome === 'accepted' ? new Response(null, { status: 202 }) : json({ error: 'private token' }, 401);
    }) as typeof fetch, async () => {
      const send = f.client.request(f.original, '/me/sendMail', { method: 'POST', body: { message: { subject: 'Test' } } });
      if (outcome === 'accepted') assert.equal(await send, null);
      else if (outcome === 'unauthorized') {
        await assert.rejects(send, BadRequestException);
        assert.equal(f.current()!.status, 'reauthorize');
      } else await assert.rejects(send, /发送结果未知/);
      assert.equal(sends, 1);
    });
  }
});

test('GET honors one short Retry-After; throttled POST is never retried', async () => {
  for (const method of ['GET', 'POST'] as const) {
    const f = fixture();
    let calls = 0;
    await mocked((async (input) => {
      if (String(input).includes('oauth2/v2.0/token')) return token();
      calls++;
      return calls === 1 ? json({ error: 'private detail' }, 429, { 'Retry-After': '0' }) : json({ value: [] });
    }) as typeof fetch, async () => {
      const request = f.client.request(f.original, method === 'GET' ? '/me/messages' : '/me/sendMail', { method });
      if (method === 'GET') { assert.deepEqual(await request, { value: [] }); assert.equal(calls, 2); }
      else { await assert.rejects(request, ServiceUnavailableException); assert.equal(calls, 1); }
    });
  }
});

test('invalid grants mark reauthorization without leaking provider errors or expiring workspace login', async () => {
  const f = fixture();
  await mocked((async () => json({ error: 'invalid_grant', error_description: 'secret-refresh-token' }, 400)) as typeof fetch, async () => {
    await assert.rejects(f.client.request(f.original, '/me/messages'), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(error.getStatus(), 400);
      assert.doesNotMatch(error.message, /secret-refresh-token/);
      return true;
    });
    assert.equal(f.current()!.status, 'reauthorize');
  });
});

test('untrusted pagination URLs are rejected before requesting credentials or sending a bearer', async () => {
  const f = fixture();
  let calls = 0;
  await mocked((async () => { calls++; return token(); }) as typeof fetch, async () => {
    for (const path of ['https://evil.example/v1.0/me/messages', 'https://graph.microsoft.com.evil.example/v1.0/me/messages',
      'https://user:pass@graph.microsoft.com/v1.0/me/messages', '/v1.0/users/other/messages', '/me/../../users/other',
      '/me/messages#fragment', '/me/%252f../messages']) {
      await assert.rejects(f.client.request(f.original, path), BadRequestException);
    }
    assert.equal(calls, 0);
  });
});

test('refresh finishing after account rebind cannot overwrite the new authorization', async () => {
  const f = fixture();
  await mocked((async () => {
    f.replace({ ...f.current()!, encryptedRefreshToken: encryptToken('new-binding', key) });
    return token();
  }) as typeof fetch, async () => {
    await assert.rejects(f.client.request(f.original, '/me/messages'), /授权已更新/);
    assert.equal(decryptToken(f.current()!.encryptedRefreshToken!, key), 'new-binding');
  });
});

test('profile failure for a Microsoft user without an Exchange mailbox is explicit and redacted', async () => {
  const f = fixture();
  await mocked((async (input) => String(input).includes('mailFolders')
    ? json({ error: { message: 'private mailbox details' } }, 404)
    : json({ id: 'user-without-mailbox', userPrincipalName: 'person@example.com' })) as typeof fetch, async () => {
    await assert.rejects(f.client.profile('access'), (error: unknown) => {
      assert.ok(error instanceof BadGatewayException);
      assert.match(error.message, /许可/);
      assert.doesNotMatch(error.message, /private mailbox details/);
      return true;
    });
  });
});

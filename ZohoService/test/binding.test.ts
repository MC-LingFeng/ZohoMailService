import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { AppConfig } from '../src/config';
import { BindAccountDto } from '../src/dto';
import { MailService } from '../src/mail.service';
import { decryptToken, encryptToken, SessionService } from '../src/security';
import { MailStore } from '../src/store';
import { ZohoClient } from '../src/zoho';
import { OutlookClient } from '../src/outlook';
import { OutlookMailService } from '../src/outlook-mail.service';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-bind-'));
  const config = Object.assign(new AppConfig(), {
    mode: 'live',
    dataDir: dir,
    clientId: '',
    clientSecret: '',
    encryptionKey: 'ab'.repeat(32),
    password: 'test-password-only',
    minInterval: 0,
  });
  const store = new MailStore(config);
  const sessions = new SessionService(config);
  let cookie = '';
  const response = {
    cookie: (_name: string, value: string) => {
      cookie = value;
    },
  } as unknown as ExpressResponse;
  sessions.login(
    { cookies: {}, ip: 'test' } as unknown as ExpressRequest,
    response,
    config.password,
  );
  const request = {
    cookies: { zohome_session: cookie },
    ip: 'test',
  } as unknown as ExpressRequest;
  const zoho = new ZohoClient(config, store);
  const outlook = new OutlookMailService(config, store, new OutlookClient(config, store), sessions);
  const mail = new MailService(config, store, zoho, sessions, outlook);
  return {
    dir,
    config,
    store,
    request,
    zoho,
    mail,
    close: () => {
      store.onModuleDestroy();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const dto = (email: string, clientId: string, clientSecret: string) =>
  Object.assign(new BindAccountDto(), { email, clientId, clientSecret });
const stateFrom = (result: { url: string }) =>
  new URL(result.url).searchParams.get('state')!;

test('two mailboxes persist distinct encrypted OAuth clients and use their own clients to renew tokens', async () => {
  const h = harness();
  const original = globalThis.fetch;
  const tokenRequests: URLSearchParams[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (String(input).includes('/oauth/v2/token')) {
      const body = new URLSearchParams(String(init?.body));
      tokenRequests.push(body);
      const suffix = body.get('client_id') === 'client-A' ? 'A' : 'B';
      return new Response(
        JSON.stringify({
          access_token: `access-${suffix}`,
          refresh_token: `refresh-${suffix}`,
          expires_in: 3600,
        }),
      );
    }
    if (new URL(String(input)).pathname === '/api/accounts') {
      const suffix = new Headers(init?.headers)
        .get('authorization')!
        .endsWith('A')
        ? 'A'
        : 'B';
      return new Response(
        JSON.stringify({
          status: { code: 200 },
          data: [
            {
              type: 'ZOHO_ACCOUNT',
              accountId: suffix === 'A' ? '1001' : '1002',
              primaryEmailAddress: `${suffix.toLowerCase()}@example.com`,
            },
          ],
        }),
      );
    }
    return new Response(JSON.stringify({ status: { code: 200 }, data: [] }));
  }) as typeof fetch;
  try {
    const first = h.mail.authorizationUrl(
      h.request,
      dto('a@example.com', 'client-A', 'secret-A'),
    );
    assert.equal(first.url.includes('secret-A'), false);
    const inspection = new DatabaseSync(join(h.dir, 'live.sqlite'), {
      readOnly: true,
    });
    try {
      const pending = inspection
        .prepare('SELECT payload FROM pending_bindings')
        .all();
      assert.equal(pending.length, 1);
      assert.equal(String(pending[0].payload).includes('secret-A'), false);
    } finally {
      inspection.close();
    }
    await h.mail.callback(h.request, 'code-A', stateFrom(first), 'us');
    const second = h.mail.authorizationUrl(
      h.request,
      dto('b@example.com', 'client-B', 'secret-B'),
    );
    await h.mail.callback(h.request, 'code-B', stateFrom(second), 'us');
    assert.equal(h.store.accounts().length, 2);
    const a = h.store.account('us-1001')!;
    const b = h.store.account('us-1002')!;
    assert.equal(a.clientId, 'client-A');
    assert.equal(b.clientId, 'client-B');
    assert.equal(
      decryptToken(a.encryptedClientSecret!, h.config.encryptionKey),
      'secret-A',
    );
    assert.equal(
      decryptToken(b.encryptedClientSecret!, h.config.encryptionKey),
      'secret-B',
    );
    const publicJson = JSON.stringify(h.mail.accounts());
    for (const forbidden of [
      'clientId',
      'encryptedClientSecret',
      'encryptedRefreshToken',
      'secret-A',
      'secret-B',
      'refresh-A',
      'refresh-B',
    ])
      assert.equal(publicJson.includes(forbidden), false);
    assert.equal(h.mail.accounts()[0].oauthSource, 'account');
    await h.zoho.request(a, '/api/accounts/1001/messages/view');
    await h.zoho.request(b, '/api/accounts/1002/messages/view');
    assert.deepEqual(
      tokenRequests.map((body) => [
        body.get('client_id'),
        body.get('client_secret'),
        body.get('grant_type'),
      ]),
      [
        ['client-A', 'secret-A', 'authorization_code'],
        ['client-B', 'secret-B', 'authorization_code'],
        ['client-A', 'secret-A', 'refresh_token'],
        ['client-B', 'secret-B', 'refresh_token'],
      ],
    );
    assert.equal(
      new URL(h.mail.reauthorize(a.id, h.request).url).searchParams.get(
        'client_id',
      ),
      'client-A',
    );
    await assert.rejects(
      h.mail.callback(h.request, 'replayed', stateFrom(first), 'us'),
      /授权请求已过期/,
    );
  } finally {
    globalThis.fetch = original;
    h.close();
  }
});

test('wrong logged-in Zoho mailbox cannot be bound to the email entered in the form', async () => {
  const h = harness();
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) =>
    String(input).includes('/oauth/v2/token')
      ? new Response(
          JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }),
        )
      : new Response(
          JSON.stringify({
            status: { code: 200 },
            data: [
              {
                accountId: '1001',
                primaryEmailAddress: 'wrong@example.com',
                type: 'ZOHO_ACCOUNT',
              },
            ],
          }),
        )) as typeof fetch;
  try {
    const state = stateFrom(
      h.mail.authorizationUrl(
        h.request,
        dto('expected@example.com', 'client', 'secret'),
      ),
    );
    await assert.rejects(
      h.mail.callback(h.request, 'code', state, 'us'),
      /与填写的 expected@example.com 不一致/,
    );
    assert.equal(h.store.accounts().length, 0);
    assert.equal(
      h.store.consumeBinding(createHash('sha256').update(state).digest('hex')),
      null,
    );
  } finally {
    globalThis.fetch = original;
    h.close();
  }
});

test('expired or wrong-session bindings are consumed without saving mailbox credentials', async () => {
  const h = harness();
  try {
    const expired = stateFrom(
      h.mail.authorizationUrl(
        h.request,
        dto('a@example.com', 'client', 'secret'),
      ),
    );
    const now = Date.now;
    const future = now() + 11 * 60_000;
    try {
      Date.now = () => future;
      await assert.rejects(
        h.mail.callback(h.request, 'code', expired, 'us'),
        /授权请求已过期/,
      );
    } finally {
      Date.now = now;
    }
    assert.equal(
      h.store.consumeBinding(
        createHash('sha256').update(expired).digest('hex'),
      ),
      null,
    );
    const wrongSession = stateFrom(
      h.mail.authorizationUrl(
        h.request,
        dto('a@example.com', 'client', 'secret'),
      ),
    );
    await assert.rejects(
      h.mail.callback(
        { cookies: {} } as unknown as ExpressRequest,
        'code',
        wrongSession,
        'us',
      ),
      /不属于当前会话/,
    );
    assert.equal(
      h.store.consumeBinding(
        createHash('sha256').update(wrongSession).digest('hex'),
      ),
      null,
    );
    assert.equal(h.store.accounts().length, 0);
  } finally {
    h.close();
  }
});

test('changing a client secret requires a new refresh token and preserves the existing account on failure', async () => {
  const h = harness();
  const original = globalThis.fetch;
  let returnRefresh = true;
  globalThis.fetch = (async (input: string | URL | Request) =>
    String(input).includes('/oauth/v2/token')
      ? new Response(
          JSON.stringify({
            access_token: 'access',
            ...(returnRefresh ? { refresh_token: 'refresh-old' } : {}),
          }),
        )
      : new Response(
          JSON.stringify({
            status: { code: 200 },
            data: [
              {
                accountId: '1001',
                primaryEmailAddress: 'a@example.com',
                type: 'ZOHO_ACCOUNT',
              },
            ],
          }),
        )) as typeof fetch;
  try {
    await h.mail.callback(
      h.request,
      'code-old',
      stateFrom(
        h.mail.authorizationUrl(
          h.request,
          dto('a@example.com', 'client', 'old-secret'),
        ),
      ),
      'us',
    );
    const before = h.store.account('us-1001')!;
    returnRefresh = false;
    await assert.rejects(
      h.mail.callback(
        h.request,
        'code-new',
        stateFrom(
          h.mail.authorizationUrl(
            h.request,
            dto('a@example.com', 'client', 'new-secret'),
          ),
        ),
        'us',
      ),
      /未返回该客户端的离线授权/,
    );
    assert.deepEqual(h.store.account('us-1001'), before);
    await h.mail.callback(
      h.request,
      'code-same',
      stateFrom(h.mail.reauthorize('us-1001', h.request)),
      'us',
    );
    assert.equal(
      h.store.account('us-1001')!.encryptedRefreshToken,
      before.encryptedRefreshToken,
    );
  } finally {
    globalThis.fetch = original;
    h.close();
  }
});

test('an old failed renewal cannot overwrite newer credentials saved for the same mailbox', async () => {
  const h = harness();
  const original = globalThis.fetch;
  let begin!: () => void;
  let finish!: (response: Response) => void;
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const response = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  globalThis.fetch = (async () => {
    begin();
    return response;
  }) as typeof fetch;
  try {
    const originalAccount = {
      id: 'us-1001',
      zohoAccountId: '1001',
      email: 'a@example.com',
      name: 'A',
      group: 'test',
      color: '#000',
      status: 'connected' as const,
      unread: 0,
      lastSyncedAt: null,
      clientId: 'old-client',
      encryptedClientSecret: encryptToken('old-secret', h.config.encryptionKey),
      encryptedRefreshToken: encryptToken(
        'old-refresh',
        h.config.encryptionKey,
      ),
    };
    h.store.saveAccount(originalAccount);
    const pending = h.zoho.request(
      originalAccount,
      '/api/accounts/1001/messages/view',
    );
    await started;
    const replacement = {
      ...originalAccount,
      clientId: 'new-client',
      encryptedClientSecret: encryptToken('new-secret', h.config.encryptionKey),
      encryptedRefreshToken: encryptToken(
        'new-refresh',
        h.config.encryptionKey,
      ),
    };
    h.store.saveAccount(replacement);
    finish(new Response(JSON.stringify({ error: 'invalid_grant' })));
    await assert.rejects(pending, /该邮箱授权已失效/);
    assert.deepEqual(h.store.account('us-1001'), replacement);
  } finally {
    globalThis.fetch = original;
    h.close();
  }
});

test('a saved-credential reauthorization cannot resurrect a mailbox disconnected during authorization', async () => {
  const h = harness();
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) =>
    String(input).includes('/oauth/v2/token')
      ? new Response(
          JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }),
        )
      : new Response(
          JSON.stringify({
            status: { code: 200 },
            data: [
              {
                accountId: '1001',
                primaryEmailAddress: 'a@example.com',
                type: 'ZOHO_ACCOUNT',
              },
            ],
          }),
        )) as typeof fetch;
  try {
    await h.mail.callback(
      h.request,
      'code',
      stateFrom(
        h.mail.authorizationUrl(
          h.request,
          dto('a@example.com', 'client', 'secret'),
        ),
      ),
      'us',
    );
    const state = stateFrom(h.mail.reauthorize('us-1001', h.request));
    h.mail.disconnect('us-1001');
    await assert.rejects(
      h.mail.callback(h.request, 'reauth-code', state, 'us'),
      /连接已被移除/,
    );
    assert.equal(h.store.accounts().length, 0);
  } finally {
    globalThis.fetch = original;
    h.close();
  }
});

import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AppConfig } from '../src/config';
import { encryptToken } from '../src/security';
import { MailStore } from '../src/store';
import { StoredAccount } from '../src/types';
import { ZohoClient } from '../src/zoho';

function fixture() {
  const config = Object.assign(new AppConfig(), {
    mode: 'live',
    clientId: 'test',
    clientSecret: 'test',
    encryptionKey: 'ab'.repeat(32),
    minInterval: 0,
  });
  const account: StoredAccount = {
    id: 'test',
    zohoAccountId: '12345',
    email: 'test@example.com',
    name: 'test',
    group: 'test',
    color: '#000000',
    status: 'connected',
    unread: 0,
    lastSyncedAt: null,
    encryptedRefreshToken: encryptToken('refresh', config.encryptionKey),
  };
  const client = new ZohoClient(config, {
    saveAccount: () => undefined,
    account: () => account,
  } as unknown as MailStore);
  return { client, account };
}

test('Zoho POST authorization failure never automatically retries a send', async () => {
  const original = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/oauth/v2/token'))
      return new Response(
        JSON.stringify({ access_token: 'fake', expires_in: 3600 }),
      );
    sends++;
    return new Response(JSON.stringify({ status: { code: 401 } }), {
      status: 401,
    });
  }) as typeof fetch;
  try {
    const { client, account } = fixture();
    await assert.rejects(
      client.request(account, '/api/accounts/12345/messages', {
        method: 'POST',
        body: { content: 'test' },
      }),
      BadRequestException,
    );
    assert.equal(sends, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('Zoho GET refreshes a rejected cached access token once and retries only the read', async () => {
  const original = globalThis.fetch;
  let refreshes = 0;
  let reads = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/oauth/v2/token')) {
      refreshes++;
      return new Response(
        JSON.stringify({ access_token: `fake-${refreshes}`, expires_in: 3600 }),
      );
    }
    reads++;
    if (reads === 1)
      return new Response(JSON.stringify({ status: { code: 401 } }), {
        status: 401,
      });
    return new Response(
      JSON.stringify({
        status: { code: 200 },
        data: [{ messageId: 'message-1' }],
      }),
    );
  }) as typeof fetch;
  try {
    const { client, account } = fixture();
    assert.deepEqual(
      await client.request(account, '/api/accounts/12345/messages/view'),
      [{ messageId: 'message-1' }],
    );
    assert.equal(refreshes, 2);
    assert.equal(reads, 2);
  } finally {
    globalThis.fetch = original;
  }
});

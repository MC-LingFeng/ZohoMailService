import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppConfig } from '../src/config';
import { ListMessagesDto } from '../src/dto';
import { PlatformStore } from '../src/platform-store';
import { decryptToken, encryptToken, SessionService } from '../src/security';
import { StoredAccount } from '../src/types';
import { WorkspaceContext } from '../src/workspace-context';
import { WorkspaceRuntimeRegistry } from '../src/workspace-runtime';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
};

test('workspace runtime keeps identical account IDs, pending pages, caches and writes isolated across interleaved awaits', { timeout: 10_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zohome-runtime-isolation-'));
  const config = Object.assign(new AppConfig(), {
    mode: 'live', dataDir: directory, password: 'synthetic-runtime-password', encryptionKey: 'ab'.repeat(32),
    adsCredentialsFile: join(directory, 'missing-credentials.json'),
  });
  const platform = new PlatformStore(config);
  const context = new WorkspaceContext();
  const sessions = new SessionService(config, platform, context);
  const registry = new WorkspaceRuntimeRegistry(config, platform, context, sessions);
  const gates = [deferred(), deferred()];
  const started = [deferred(), deferred()];
  const requests: Promise<unknown>[] = [];
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ids = [platform.defaultWorkspaceId, platform.createWorkspace(platform.defaultAdminId, 'Workspace B').id];
    const descriptors = ids.map((id) => platform.workspaceConfig(id));
    assert.notEqual(descriptors[0].encryptionKey, descriptors[1].encryptionKey);
    const runtimes = ids.map((id) => registry.forWorkspace(id));
    const calls = [{ folders: 0, pages: 0 }, { folders: 0, pages: 0 }];
    const accountId = 'same-provider-account';
    const messageId = 'same-provider-message';
    const folderId = 'same-provider-inbox';
    const inWorkspace = <T>(id: string, action: () => T) => context.run(() => {
      context.set({ workspaceId: id, userId: platform.defaultAdminId, role: 'owner', isPlatformAdmin: true });
      return action();
    });
    for (let index = 0; index < runtimes.length; index++) {
      const account: StoredAccount = {
        id: accountId, provider: 'zoho', zohoAccountId: 'same-zoho-account', email: `workspace-${index}@example.com`,
        name: `Workspace ${index}`, group: 'Fixture', color: '#5164f4', status: 'connected', unread: 0, lastSyncedAt: null,
        clientId: `client-${index}`, encryptedClientSecret: encryptToken(`client-secret-${index}`, descriptors[index].encryptionKey),
        encryptedRefreshToken: encryptToken(`refresh-${index}`, descriptors[index].encryptionKey),
      };
      runtimes[index].store.saveAccount(account);
      runtimes[index].zoho.request = async (received, path, options = {}) => {
        assert.equal(received.id, accountId);
        assert.equal(received.email, account.email);
        assert.equal(context.current()?.workspaceId, ids[index]);
        assert.equal(decryptToken(received.encryptedRefreshToken!, descriptors[index].encryptionKey), `refresh-${index}`);
        if (path.endsWith('/folders')) {
          calls[index].folders++;
          return [{ folderId, folderName: 'Inbox', folderType: 'Inbox', path: '/Inbox' }];
        }
        assert.ok(path.endsWith('/messages/view'));
        assert.equal(options.query?.folderId, folderId);
        calls[index].pages++;
        started[index].resolve();
        await gates[index].promise;
        assert.equal(context.current()?.workspaceId, ids[index]);
        return [{
          messageId, folderId, fromAddress: `sender-${index}@example.com`, sender: `Sender ${index}`,
          subject: `Private subject ${index}`, summary: `Private preview ${index}`,
          receivedTime: '1793577600000', status: index === 0 ? 'unread' : 'read',
        }];
      };
    }
    assert.throws(() => decryptToken(runtimes[0].store.account(accountId)!.encryptedRefreshToken!, descriptors[1].encryptionKey));

    const mail = registry.proxy('mail');
    const query = Object.assign(new ListMessagesDto(), { folder: 'inbox', start: 1, limit: 30, q: '' });
    let firstFinished = false;
    const first = inWorkspace(ids[0], async () => {
      const page = await mail.list(accountId, query);
      assert.equal(context.current()?.workspaceId, ids[0]);
      firstFinished = true;
      return page;
    });
    const duplicateFirst = inWorkspace(ids[0], () => mail.list(accountId, query));
    const second = inWorkspace(ids[1], async () => {
      const page = await mail.list(accountId, query);
      assert.equal(context.current()?.workspaceId, ids[1]);
      return page;
    });
    requests.push(first, duplicateFirst, second);
    await Promise.race([
      Promise.all(started.map((signal) => signal.promise)),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Each workspace must start its own independent provider request')), 3_000); }),
    ]);
    clearTimeout(timer); timer = undefined;
    assert.equal(context.current(), undefined);
    assert.deepEqual(calls, [{ folders: 1, pages: 1 }, { folders: 1, pages: 1 }]);

    // Finish B while A remains in flight. A shared pending/cache map would
    // incorrectly return A's response or prevent B from reaching its provider.
    gates[1].resolve();
    const secondPage = await second;
    assert.equal(firstFinished, false);
    assert.equal(secondPage.messages[0].subject, 'Private subject 1');
    assert.equal(secondPage.cached, false);
    const cachedSecond = await inWorkspace(ids[1], () => mail.list(accountId, query));
    assert.equal(cachedSecond.cached, true);
    assert.deepEqual(cachedSecond.messages, secondPage.messages);
    assert.equal(runtimes[0].store.messages(accountId, 'inbox').length, 0);
    assert.equal(runtimes[1].store.messages(accountId, 'inbox')[0].subject, 'Private subject 1');

    gates[0].resolve();
    const [firstPage, duplicatePage] = await Promise.all([first, duplicateFirst]);
    assert.equal(firstPage.messages[0].subject, 'Private subject 0');
    assert.equal(firstPage.cached, false);
    assert.deepEqual(duplicatePage, firstPage);
    const cachedFirst = await inWorkspace(ids[0], () => mail.list(accountId, query));
    assert.equal(cachedFirst.cached, true);
    assert.deepEqual(cachedFirst.messages, firstPage.messages);
    assert.deepEqual(calls, [{ folders: 1, pages: 1 }, { folders: 1, pages: 1 }]);
    assert.equal(runtimes[0].store.messages(accountId, 'inbox')[0].subject, 'Private subject 0');
    assert.equal(runtimes[1].store.messages(accountId, 'inbox')[0].subject, 'Private subject 1');
    assert.equal(runtimes[0].store.account(accountId)!.unread, 1);
    assert.equal(runtimes[1].store.account(accountId)!.unread, 0);

    registry.onModuleDestroy(); closed = true;
    for (let index = 0; index < descriptors.length; index++) {
      const persisted = new DatabaseSync(join(descriptors[index].dataDir, 'live.sqlite'), { readOnly: true });
      try {
        const message = JSON.parse(String(persisted.prepare('SELECT payload FROM messages WHERE account_id=? AND id=?').get(accountId, messageId)!.payload));
        const account = JSON.parse(String(persisted.prepare('SELECT payload FROM accounts WHERE id=?').get(accountId)!.payload));
        assert.equal(message.subject, `Private subject ${index}`);
        assert.equal(message.preview, `Private preview ${index}`);
        assert.equal(account.email, `workspace-${index}@example.com`);
        assert.equal(decryptToken(account.encryptedRefreshToken, descriptors[index].encryptionKey), `refresh-${index}`);
      } finally { persisted.close(); }
    }
  } finally {
    if (timer) clearTimeout(timer);
    gates.forEach((gate) => gate.resolve());
    await Promise.allSettled(requests);
    if (!closed) registry.onModuleDestroy();
    platform.onModuleDestroy();
    rmSync(directory, { recursive: true, force: true });
  }
});

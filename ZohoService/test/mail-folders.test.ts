import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/bootstrap';
import { OutlookClient } from '../src/outlook';
import { MailStore } from '../src/store';
import { StoredAccount } from '../src/types';
import { ZohoClient } from '../src/zoho';

type FolderChoice = { id: string; name: string; path?: string; type: 'inbox' | 'spam' | 'sent' | 'other' };

function mailbox(id: string): StoredAccount {
  return {
    id, provider: 'zoho', zohoAccountId: id, email: `${id}@example.com`, name: id,
    group: 'Test', color: '#5164f4', status: 'connected', unread: 0,
    lastSyncedAt: null, encryptedRefreshToken: null,
  };
}

async function harness(mode: 'live' | 'demo' = 'live') {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-mail-folders-'));
  Object.assign(process.env, {
    APP_MODE: mode, DATA_DIR: dir, APP_PASSWORD: 'folder-test-password',
    TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32), FRONTEND_URL: 'http://localhost:5173',
  });
  const app = await createApp({ shutdownHooks: false });
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const login = await fetch(`${base}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'folder-test-password' }),
  });
  const Cookie = login.headers.get('set-cookie')!.split(';')[0];
  const request = (path: string, method = 'GET', headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method, headers: { Cookie, ...headers } });
  return {
    app, request, store: app.get(MailStore), zoho: app.get(ZohoClient),
    close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

function folderRows() {
  return [
    { folderId: 'inbox-id', folderName: '收件箱', folderType: 'Inbox', path: '/Inbox' },
    { folderId: 'spam-id', folderName: '垃圾邮件', folderType: 'Spam', path: '/Spam' },
    { folderId: 'sent-id', folderName: '已发送', folderType: 'Sent', path: '/Sent' },
    { folderId: 'notification-id', folderName: 'Notification', folderType: 'Inbox', path: '/Notification' },
    { folderId: 'newsletter-id', folderName: 'Newsletters', folderType: 'Inbox', path: '/Newsletters' },
    { folderId: 'custom-id', folderName: 'Projects', folderType: 'Inbox', path: '/Projects' },
    { folderId: 'unnamed-id', folderType: 'Inbox', path: '/Unnamed' },
    { folderId: 'archive-id', folderName: 'Archive', folderType: 'Inbox', path: '/Archive' },
  ];
}

test('Zoho exposes all receiving folders and fetches Notification by its real ID without confusing Inbox folder types', async () => {
  const h = await harness();
  try {
    h.store.saveAccount(mailbox('first'));
    h.store.saveAccount(mailbox('second'));
    const calls: { accountId: string; path: string; query?: Record<string, unknown> }[] = [];
    h.zoho.request = async (account, path, options = {}) => {
      calls.push({ accountId: account.id, path, query: options.query });
      if (path.endsWith('/folders')) return account.id === 'first' ? folderRows()
        : [{ folderId: 'second-inbox', folderName: 'Inbox', path: '/Inbox', folderType: 'Inbox' }];
      if (path.endsWith('/content')) return { content: '<p>Notification body</p>' };
      // A real Zoho read showed includearchive=true filtering out normal Inbox/Notification mail.
      if (path.endsWith('/messages/view') && options.query?.includearchive === 'true' && options.query?.folderId !== 'archive-id') return [];
      if (path.endsWith('/messages/view')) return [{
        messageId: `${account.id}-${options.query?.folderId}`, folderId: options.query?.folderId,
        fromAddress: 'notification@example.com', sender: 'Notification sender', subject: 'Notification offer',
        summary: 'Notification preview', receivedTime: '1793577600000', status: 'unread',
      }];
      throw new Error(`Unexpected Zoho path ${path}`);
    };
    assert.equal((await h.request('/accounts/first/folders', 'GET', { Cookie: '' })).status, 401);
    assert.equal((await h.request('/accounts/first/folders', 'GET', { Origin: 'https://hostile.example' })).status, 403);
    const response = await h.request('/accounts/first/folders');
    assert.equal(response.status, 200);
    const folders = await response.json() as FolderChoice[];
    assert.equal(folders.length, folderRows().length);
    for (const id of ['notification-id', 'newsletter-id', 'custom-id'])
      assert.equal(folders.find((folder) => folder.id === id)?.type, 'other');
    assert.equal(folders.find((folder) => folder.id === 'inbox-id')?.type, 'inbox');
    assert.equal(folders.find((folder) => folder.id === 'spam-id')?.type, 'spam');
    assert.equal(folders.find((folder) => folder.id === 'sent-id')?.type, 'sent');
    assert.ok(folders.find((folder) => folder.id === 'unnamed-id')?.name);
    const metadata = calls.find((call) => call.path.endsWith('/folders'))!;
    for (const field of ['folderId', 'folderName', 'folderType', 'path', 'isArchived'])
      assert.ok(String(metadata.query?.fields).split(',').includes(field));
    assert.equal((await h.request('/accounts/first/folders')).status, 200);
    assert.equal(calls.filter((call) => call.accountId === 'first' && call.path.endsWith('/folders')).length, 1);
    const list = await h.request('/accounts/first/messages?folder=other&folderId=notification-id');
    assert.equal(list.status, 200);
    const page = await list.json();
    assert.equal(page.messages[0].folder, 'other');
    assert.equal(page.messages[0].folderId, 'notification-id');
    assert.ok(calls.some((call) => call.path.endsWith('/messages/view') && call.query?.folderId === 'notification-id'));
    const newsletter = await h.request('/accounts/first/messages?folder=other&folderId=newsletter-id');
    assert.equal(newsletter.status, 200);
    const newsletterPage = await newsletter.json();
    assert.equal(newsletterPage.messages[0].folderId, 'newsletter-id');
    assert.notEqual(newsletterPage.messages[0].id, page.messages[0].id);
    const messageId = page.messages[0].id;
    const detail = await h.request(`/accounts/first/messages/${messageId}?folderId=notification-id`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).content, '<p>Notification body</p>');
    assert.equal((await h.request('/accounts/first/messages?folder=other')).status, 400);
    assert.equal((await h.request('/accounts/second/messages?folder=other&folderId=notification-id')).status, 404);
    assert.equal((await h.request(`/accounts/second/messages/${messageId}?folderId=notification-id`)).status, 404);
    const spam = await h.request('/accounts/first/messages?folder=spam');
    assert.equal(spam.status, 200);
    assert.equal((await spam.json()).messages[0].folderId, 'spam-id');
    const inbox = await h.request('/accounts/first/messages?folder=inbox');
    assert.equal(inbox.status, 200);
    assert.equal((await inbox.json()).messages[0].folderId, 'inbox-id');
    const archive = await h.request('/accounts/first/messages?folder=other&folderId=archive-id');
    assert.equal(archive.status, 200);
    assert.equal((await archive.json()).messages[0].folderId, 'archive-id');
    assert.ok(calls.filter((call) => call.path.endsWith('/messages/view'))
      .every((call) => call.query?.folderId === 'archive-id'
        ? call.query.includearchive === 'true' : call.query?.includearchive === undefined));
  } finally { await h.close(); }
});

test('sync refreshes folder discovery and the selected custom receiving folder rather than forcing Inbox', async () => {
  const h = await harness();
  try {
    h.store.saveAccount(mailbox('first'));
    let folders = folderRows();
    let discoveries = 0;
    const fetchedIds: unknown[] = [];
    h.zoho.request = async (_account, path, options = {}) => {
      if (path.endsWith('/folders')) { discoveries++; return folders; }
      if (path.endsWith('/messages/view')) { fetchedIds.push(options.query?.folderId); return []; }
      throw new Error(`Unexpected Zoho path ${path}`);
    };
    assert.equal((await h.request('/accounts/first/folders')).status, 200);
    folders = [...folders, { folderId: 'new-id', folderName: 'New Notification', folderType: 'Inbox', path: '/New Notification' }];
    assert.equal((await h.request('/accounts/first/sync?folder=other&folderId=new-id', 'POST')).status, 201);
    assert.equal(discoveries, 2);
    assert.deepEqual(fetchedIds, ['new-id']);
    const fresh = await (await h.request('/accounts/first/folders')).json() as FolderChoice[];
    assert.ok(fresh.some((folder) => folder.id === 'new-id' && folder.type === 'other'));
    assert.equal(discoveries, 2);
    assert.equal((await h.request('/accounts/first/sync', 'POST')).status, 201);
    assert.deepEqual(fetchedIds, ['new-id', 'inbox-id']);
  } finally { await h.close(); }
});

test('demo folder discovery stays local and exposes its three seeded folders', async () => {
  const h = await harness('demo');
  try {
    h.zoho.request = async () => { throw new Error('demo must not request Zoho'); };
    const foldersResponse = await h.request('/accounts/demo-1/folders');
    assert.equal(foldersResponse.status, 200);
    const folders = await foldersResponse.json() as FolderChoice[];
    assert.deepEqual(folders.map((folder) => folder.type).sort(), ['inbox', 'sent', 'spam']);
    for (const folder of folders) {
      const response = await h.request(`/accounts/demo-1/messages?folder=${folder.type}&folderId=${encodeURIComponent(folder.id)}`);
      assert.equal(response.status, 200);
      assert.ok((await response.json()).messages.every((message: { folderId: string }) => message.folderId === folder.id));
    }
    assert.equal((await h.request('/accounts/demo-1/messages?folder=inbox&folderId=demo-2-inbox')).status, 404);
  } finally { await h.close(); }
});

test('Outlook exposes its supported folders and rejects arbitrary custom folder IDs before a Graph request', async () => {
  const h = await harness();
  try {
    h.store.saveAccount({ ...mailbox('outlook-first'), provider: 'outlook', outlookUserId: 'graph-user', zohoAccountId: '' });
    let requests = 0;
    h.app.get(OutlookClient).request = async (_account, path) => {
      requests++;
      return path.endsWith('/messages') ? { value: [] } : { id: 'graph-inbox-id', unreadItemCount: 0 };
    };
    const response = await h.request('/accounts/outlook-first/folders');
    assert.equal(response.status, 200);
    const folders = await response.json() as FolderChoice[];
    assert.deepEqual(folders.map((folder) => folder.id).sort(), ['inbox', 'junkemail', 'sentitems']);
    assert.equal(requests, 0);
    assert.equal((await h.request('/accounts/outlook-first/messages?folder=other&folderId=notification-id')).status, 400);
    assert.equal(requests, 0);
    assert.equal((await h.request('/accounts/outlook-first/messages?folder=inbox&folderId=inbox')).status, 200);
    assert.equal(requests, 2);
  } finally { await h.close(); }
});

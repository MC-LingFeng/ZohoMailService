import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BadGatewayException } from '@nestjs/common';
import { normalizeZohoFolders } from '../src/zoho-folders';

test('folder normalization exposes smart, system and custom folders in API order without treating custom Inbox types as Inbox', () => {
  const folders = normalizeZohoFolders([
    { folderId: 'notification', folderName: 'Notification', folderType: 'Inbox', path: '/Notification' },
    { folderId: 'custom', folderName: 'Projects', folderType: 'Inbox', path: '/Projects' },
    { folderId: 'inbox', folderName: 'Inbox', folderType: 'Inbox', path: '/INBOX' },
    { folderId: 'newsletter', folderName: 'ZMNewsletter', folderType: 'Inbox', path: '/ZMNewsletter' },
    { folderId: 'spam', folderName: '垃圾邮件', folderType: 'Spam', path: '/Spam' },
    { folderId: 'sent', folderName: 'Sent', folderType: 'Sent', path: '/Sent' },
    { folderId: 'trash', folderName: 'Trash', folderType: 'Trash', path: '/Trash' },
    { folderId: 'drafts', folderName: 'Drafts', folderType: 'Drafts', path: '/Drafts' },
  ]);
  assert.deepEqual(folders.map(({ id }) => id), ['notification', 'custom', 'inbox', 'newsletter', 'spam', 'sent', 'trash', 'drafts']);
  assert.deepEqual(folders.map(({ type }) => type), ['other', 'other', 'inbox', 'other', 'spam', 'sent', 'other', 'other']);
  assert.deepEqual(folders.map(({ name }) => name), ['通知', 'Projects', '收件箱', '订阅', '垃圾邮件', '已发送', '废纸篓', '草稿']);
});

test('custom folder names and nested paths remain unchanged while missing metadata has a usable fallback', () => {
  const folders = normalizeZohoFolders([
    { folderId: 'nested', folderName: 'Notification', folderType: 'Inbox', path: '/Projects/Notification' },
    { folderId: 'renamed', folderName: 'Important notifications', path: '/Notification' },
    { folderId: 'custom-spam', folderName: 'Spam', folderType: 'Spam', path: '/Projects/Spam' },
    { folderId: 'missing-name', folderType: 'Inbox', path: '/Unnamed' },
    { folderId: 'missing-path', folderName: 'Inbox' },
    { folderId: 'localized-sent', folderName: '已发送', folderType: 'Sent' },
    { folderId: 'custom-no-path', folderName: 'Projects', folderType: 'Inbox' },
    { folderId: 12345 },
  ]);
  assert.equal(folders[0].name, 'Notification');
  assert.equal(folders[0].path, '/Projects/Notification');
  assert.equal(folders[0].type, 'other');
  assert.equal(folders[1].name, 'Important notifications');
  assert.equal(folders[2].type, 'other');
  assert.equal(folders[2].name, 'Spam');
  assert.equal(folders[3].name, 'Unnamed');
  assert.equal(folders[4].type, 'inbox');
  assert.equal(folders[5].type, 'sent');
  assert.equal(folders[6].type, 'other');
  assert.equal(folders[7].id, '12345');
  assert.ok(folders[7].name);
});

test('duplicate folder IDs are stable and malformed provider entries fail before any result is used', () => {
  assert.deepEqual(normalizeZohoFolders([]), []);
  assert.equal(normalizeZohoFolders([
    { folderId: 'one', folderName: 'First' }, { folderId: 'one', folderName: 'Duplicate' },
  ])[0].name, 'First');
  for (const value of [null, {}, 'folders', [null], [[]], [{}], [{ folderId: '' }],
    [{ folderId: 'x', path: {} }], [{ folderId: 'x', folderName: 42 }], [{ folderId: Number.MAX_SAFE_INTEGER + 1 }]])
    assert.throws(() => normalizeZohoFolders(value), BadGatewayException);
});

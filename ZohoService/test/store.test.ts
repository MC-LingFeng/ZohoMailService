import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfig } from '../src/config';
import { MailStore } from '../src/store';

test('daily send count survives activity trimming and service restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zohome-stats-'));
  const config = Object.assign(new AppConfig(), { dataDir: dir });
  const store = new MailStore(config);
  try {
    store.addActivity('send', 'demo@example.com', 'sent');
    for (let i = 0; i < 1001; i++)
      store.addActivity('sync', 'demo@example.com', `sync ${i}`);
    assert.equal(store.overview().sentToday, 1);
    assert.ok(store.activity().length <= 20);
  } finally {
    store.onModuleDestroy();
  }
  const reopened = new MailStore(config);
  try {
    assert.equal(reopened.overview().sentToday, 1);
  } finally {
    reopened.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  }
});

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppConfig } from './config';
import {
  Account,
  Activity,
  Folder,
  MailDetail,
  MailMessage,
  StoredAccount,
  PendingBinding,
} from './types';

const chinaDate = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

@Injectable()
export class MailStore implements OnModuleDestroy {
  private readonly db: DatabaseSync;
  constructor(private readonly config: AppConfig) {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    const file = join(config.dataDir, `${config.mode}.sqlite`);
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL, folder TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id,id));
      CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS message_folder ON messages(account_id,folder);
      CREATE TABLE IF NOT EXISTS daily_stats (day TEXT PRIMARY KEY, sent_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS pending_bindings (state_hash TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
    this.cleanupBindings();
    // Migrate existing untrimmed activity from earlier local builds without resetting saved counters.
    const oldCounts = new Map<string, number>();
    for (const row of this.db.prepare('SELECT payload FROM activity').all()) {
      const activity = JSON.parse(String(row.payload)) as Activity;
      if (activity.type === 'send') {
        const day = chinaDate(new Date(activity.createdAt));
        oldCounts.set(day, (oldCounts.get(day) || 0) + 1);
      }
    }
    for (const [day, count] of oldCounts)
      this.db
        .prepare(
          'INSERT OR IGNORE INTO daily_stats(day,sent_count) VALUES(?,?)',
        )
        .run(day, count);
    if (!config.live && !this.accounts().length) this.seed();
  }
  onModuleDestroy() {
    this.db.close();
  }
  accounts(): StoredAccount[] {
    return this.db
      .prepare('SELECT payload FROM accounts')
      .all()
      .map((row) => JSON.parse(String(row.payload)) as StoredAccount);
  }
  publicAccounts(): Account[] {
    // Explicit allowlist: future credential fields must never leak through API responses.
    return this.accounts().map((account) => {
      const individual = Boolean(
        account.clientId && account.encryptedClientSecret,
      );
      const legacy =
        !account.clientId &&
        !account.encryptedClientSecret &&
        this.config.oauthConfigured;
      return {
        id: account.id,
        email: account.email,
        name: account.name,
        group: account.group,
        color: account.color,
        status: account.status,
        unread: account.unread,
        lastSyncedAt: account.lastSyncedAt,
        hasOAuthCredentials: individual || legacy,
        oauthSource: individual ? 'account' : legacy ? 'legacy' : 'none',
      };
    });
  }
  saveBinding(binding: PendingBinding) {
    this.cleanupBindings();
    this.db
      .prepare(
        'INSERT INTO pending_bindings(state_hash,payload,expires_at) VALUES(?,?,?)',
      )
      .run(binding.stateHash, JSON.stringify(binding), binding.expiresAt);
  }
  consumeBinding(stateHash: string): PendingBinding | null {
    this.cleanupBindings();
    const row = this.db
      .prepare(
        'DELETE FROM pending_bindings WHERE state_hash=? RETURNING payload',
      )
      .get(stateHash);
    return row ? (JSON.parse(String(row.payload)) as PendingBinding) : null;
  }
  private cleanupBindings() {
    this.db
      .prepare('DELETE FROM pending_bindings WHERE expires_at<=?')
      .run(Date.now());
  }
  account(id: string) {
    const row = this.db
      .prepare('SELECT payload FROM accounts WHERE id=?')
      .get(id);
    return row ? (JSON.parse(String(row.payload)) as StoredAccount) : null;
  }
  saveAccount(account: StoredAccount) {
    this.db
      .prepare(
        'INSERT INTO accounts(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(account.id, JSON.stringify(account));
  }
  removeAccount(id: string) {
    this.db.prepare('DELETE FROM accounts WHERE id=?').run(id);
  }
  messages(accountId: string, folder: Folder): MailDetail[] {
    return this.db
      .prepare('SELECT payload FROM messages WHERE account_id=? AND folder=?')
      .all(accountId, folder)
      .map((row) => JSON.parse(String(row.payload)) as MailDetail)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }
  message(accountId: string, id: string): MailDetail | null {
    const row = this.db
      .prepare('SELECT payload FROM messages WHERE account_id=? AND id=?')
      .get(accountId, id);
    return row ? (JSON.parse(String(row.payload)) as MailDetail) : null;
  }
  saveMessage(message: MailMessage | MailDetail) {
    const previous = this.message(message.accountId, message.id);
    this.db
      .prepare(
        'INSERT INTO messages(account_id,id,folder,payload) VALUES(?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET folder=excluded.folder,payload=excluded.payload',
      )
      .run(
        message.accountId,
        message.id,
        message.folder,
        JSON.stringify({ ...previous, ...message }),
      );
  }
  addActivity(type: Activity['type'], accountEmail: string, title: string) {
    const activity: Activity = {
      id: randomUUID(),
      type,
      accountEmail,
      title,
      createdAt: new Date().toISOString(),
    };
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO activity(id,payload,created_at) VALUES(?,?,?)')
        .run(activity.id, JSON.stringify(activity), activity.createdAt);
      if (type === 'send')
        this.db
          .prepare(
            'INSERT INTO daily_stats(day,sent_count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET sent_count=sent_count+1',
          )
          .run(chinaDate(new Date(activity.createdAt)));
      this.db.exec(
        'DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY created_at DESC LIMIT 1000)',
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return activity;
  }
  activity(): Activity[] {
    return this.db
      .prepare('SELECT payload FROM activity ORDER BY created_at DESC LIMIT 20')
      .all()
      .map((row) => JSON.parse(String(row.payload)) as Activity);
  }
  overview() {
    const accounts = this.accounts();
    const today = chinaDate(new Date());
    const sentToday = Number(
      this.db
        .prepare('SELECT sent_count FROM daily_stats WHERE day=?')
        .get(today)?.sent_count || 0,
    );
    return {
      accountCount: accounts.length,
      connectedCount: accounts.filter(
        (account) => account.status === 'connected',
      ).length,
      unreadCount: accounts.reduce(
        (total, account) => total + account.unread,
        0,
      ),
      sentToday,
      lastSyncedAt:
        accounts
          .map((account) => account.lastSyncedAt)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) || null,
    };
  }
  private seed() {
    const names = [
      ['Alex Chen', 'alex.chen', '工作邮箱', '#5164f4'],
      ['设计团队', 'design.studio', '团队协作', '#aa79dc'],
      ['客户服务', 'hello.support', '客户服务', '#36a58f'],
      ['海外业务', 'global.business', '工作邮箱', '#e6a44c'],
      ['个人邮箱', 'personal.notes', '个人邮箱', '#db7a97'],
      ['产品动态', 'product.news', '团队协作', '#5496cb'],
    ];
    const subjects = [
      {
        subject: '欢迎来到 ZoHome，让每一个邮箱都井然有序',
        fromName: 'ZoHome 团队',
        from: 'team@example.com',
        preview:
          '一个工作台，连接你所有的 Zoho 邮箱。从现在开始，让沟通更轻松。',
        content:
          '你好，\n\n欢迎来到 ZoHome！\n\n这里是你管理多个邮箱的新起点。你可以在左侧切换账号，查看收件箱和垃圾邮件，也可以直接选择账号撰写新邮件。\n\n当前显示的是演示数据，所有发送操作仅保存在本地，不会发出真实邮件。\n\n祝你拥有专注、高效的一天。\n\nZoHome 团队',
      },
      {
        subject: '下周产品讨论会 · 议程与准备事项',
        fromName: 'Mia Wang',
        from: 'mia@example.com',
        preview:
          'Hi，团队，附上本次讨论会的议程。我们将在周三下午一起讨论新的产品方向。',
        content:
          'Hi，\n\n我们计划在下周三 14:00 举行产品讨论会，欢迎提前准备你的想法。\n\n议程：\n1. 用户反馈与使用数据\n2. 新版本的优先事项\n3. 设计方案与里程碑\n\n期待与你交流！\n\nMia',
      },
      {
        subject: 'Re: 关于项目合作的进一步沟通',
        fromName: 'Daniel Liu',
        from: 'daniel@example.com',
        preview:
          '感谢你的回复！我们已经看过方案，希望有机会进一步讨论项目细节。',
        content:
          '你好，\n\n感谢提供详细的项目方案。我们团队已完成初步评估，整体方向非常契合。\n\n方便的话，请告知下周可以沟通的时间，我们会安排一次线上会议。\n\nDaniel',
      },
    ];
    names.forEach(([name, local, group, color], index) => {
      const id = `demo-${index + 1}`;
      const email = `${local}@zohomail.com`;
      this.saveAccount({
        id,
        email,
        name,
        group,
        color,
        status: 'connected',
        unread: index === 0 ? 3 : 2,
        lastSyncedAt: new Date(Date.now() - index * 180_000).toISOString(),
        zohoAccountId: id,
        encryptedRefreshToken: null,
      });
      subjects.forEach((subject, j) => {
        this.saveMessage({
          ...subject,
          id: `${id}-inbox-${j}`,
          accountId: id,
          folderId: `${id}-inbox`,
          folder: 'inbox',
          to: email,
          receivedAt: new Date(
            Date.now() - (index * 31 + j * 72 + 8) * 60_000,
          ).toISOString(),
          isRead: index !== 0 && j === 2,
          hasAttachment: j === 1,
          format: 'plaintext',
        });
      });
      this.saveMessage({
        id: `${id}-spam-0`,
        accountId: id,
        folderId: `${id}-spam`,
        folder: 'spam',
        from: 'offers@example.net',
        fromName: 'Promotions',
        to: email,
        subject: '限时优惠信息（演示垃圾邮件）',
        preview: '这是一封演示垃圾邮件，用于展示垃圾邮件文件夹。',
        content:
          '这是一封演示垃圾邮件，用于说明可直接在 ZoHome 中检查垃圾邮件。',
        receivedAt: new Date(
          Date.now() - (index + 1) * 3_600_000,
        ).toISOString(),
        isRead: true,
        hasAttachment: false,
        format: 'plaintext',
      });
      this.saveMessage({
        id: `${id}-sent-0`,
        accountId: id,
        folderId: `${id}-sent`,
        folder: 'sent',
        from: email,
        fromName: name,
        to: 'mia@example.com',
        subject: 'Re: 下周产品讨论会',
        preview: '收到，我会提前整理反馈。期待下周的讨论！',
        content: '收到，我会提前整理反馈。期待下周的讨论！',
        receivedAt: new Date(
          Date.now() - (index + 4) * 3_600_000,
        ).toISOString(),
        isRead: true,
        hasAttachment: false,
        format: 'plaintext',
      });
    });
    this.addActivity('connect', 'alex.chen@zohomail.com', '已连接工作邮箱');
    this.addActivity('sync', 'design.studio@zohomail.com', '邮件同步已完成');
  }
}

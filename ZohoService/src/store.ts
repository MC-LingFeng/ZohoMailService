import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
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
import {
  RebateComparison,
  RebateCostIssue,
  RebateCostTarget,
  RebateInput,
  RebateList,
  RebateOptions,
  RebateQuery,
  RebateRecord,
  rebateRate,
} from './rebates.types';

const rebateSelect = `SELECT r.*,
  json_extract(a.payload,'$.email') AS account_email,
  json_extract(a.payload,'$.name') AS account_name,
  json_extract(a.payload,'$.group') AS account_group
  FROM rebate_registrations r JOIN accounts a ON a.id=r.account_id`;

const rebateMoneyTotals = `
  TOTAL(CASE WHEN r.banned=0 THEN r.revenue_cents ELSE 0 END) AS revenue_cents,
  TOTAL(CASE WHEN r.banned=0 AND r.settled=1 THEN r.revenue_cents ELSE 0 END) AS settled_revenue_cents,
  TOTAL(CASE WHEN r.banned=0 AND r.settled=0 THEN r.revenue_cents ELSE 0 END) AS unsettled_revenue_cents,
  TOTAL(r.cost_cents) AS cost_cents`;

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
    this.db.function('zohome_lower', { deterministic: true }, (value) =>
      String(value ?? '').toLocaleLowerCase(),
    );
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL, folder TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id,id));
      CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS message_folder ON messages(account_id,folder);
      CREATE TABLE IF NOT EXISTS daily_stats (day TEXT PRIMARY KEY, sent_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS pending_bindings (state_hash TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rebate_registrations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        site_name TEXT NOT NULL,
        domain TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        offer_name TEXT NOT NULL DEFAULT '',
        revenue_cents INTEGER NOT NULL DEFAULT 0 CHECK(revenue_cents>=0),
        cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(cost_cents>=0),
        settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0,1)),
        settlement_cycle TEXT NOT NULL DEFAULT '',
        banned INTEGER NOT NULL DEFAULT 0 CHECK(banned IN (0,1)),
        ip TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rebate_account ON rebate_registrations(account_id);
      CREATE INDEX IF NOT EXISTS rebate_recent ON rebate_registrations(registered_at DESC,created_at DESC,id);`);
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
  private rebateRecord(row: Record<string, unknown>): RebateRecord {
    const totalRevenue = Number(row.revenue_cents) / 100;
    const totalCost = Number(row.cost_cents) / 100;
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      accountEmail: String(row.account_email),
      accountName: String(row.account_name || ''),
      accountGroup: String(row.account_group || ''),
      siteName: String(row.site_name),
      domain: String(row.domain),
      registeredAt: String(row.registered_at),
      offerName: String(row.offer_name),
      totalRevenue,
      totalCost,
      settled: Boolean(row.settled),
      settlementCycle: String(row.settlement_cycle),
      banned: Boolean(row.banned),
      ip: String(row.ip),
      conversionRate: rebateRate(totalCost, totalRevenue),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
  private rebate(id: string): RebateRecord | null {
    const row = this.db.prepare(`${rebateSelect} WHERE r.id=?`).get(id);
    return row ? this.rebateRecord(row) : null;
  }
  rebateOptions(): RebateOptions {
    const options = (column: 'site_name' | 'domain' | 'offer_name') =>
      this.db
        .prepare(
          `SELECT DISTINCT trim(${column}) AS value FROM rebate_registrations
           WHERE trim(${column})<>'' ORDER BY value COLLATE NOCASE,value`,
        )
        .all()
        .map((row) => String(row.value));
    return {
      siteNames: options('site_name'),
      domains: options('domain'),
      offerNames: options('offer_name'),
    };
  }
  rebateCostTargets(): RebateCostTarget[] {
    return this.db
      .prepare('SELECT id,account_id,offer_name,cost_cents,updated_at FROM rebate_registrations')
      .all()
      .map((row) => ({
        id: String(row.id),
        accountId: String(row.account_id),
        offerName: String(row.offer_name),
        costCents: Number(row.cost_cents),
        updatedAt: String(row.updated_at),
      }));
  }
  saveRebateCosts(
    updates: { target: RebateCostTarget; costCents: number }[],
    refreshedAt: string,
  ) {
    const issues: RebateCostIssue[] = [];
    let updatedRecords = 0;
    let updatedOffers = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Recheck after the network calls: another tab may have edited or added an Offer.
      const current = this.rebateCostTargets();
      const currentOffers = new Map<string, RebateCostTarget[]>();
      for (const row of current) {
        const name = row.offerName.trim();
        currentOffers.set(name, [...(currentOffers.get(name) || []), row]);
      }
      const offers = new Map<string, typeof updates>();
      for (const update of updates) {
        const name = update.target.offerName.trim();
        offers.set(name, [...(offers.get(name) || []), update]);
      }
      const write = this.db.prepare(`UPDATE rebate_registrations
        SET cost_cents=?,updated_at=?
        WHERE id=? AND offer_name=? AND cost_cents=? AND updated_at=?`);
      for (const [offerName, group] of offers) {
        const latest = currentOffers.get(offerName) || [];
        const unchanged = latest.length === group.length && group.every(({ target }) =>
          latest.some((row) => row.id === target.id && row.accountId === target.accountId &&
            row.offerName === target.offerName && row.updatedAt === target.updatedAt && row.costCents === target.costCents));
        if (!unchanged) {
          issues.push({
            offerName,
            reason: 'record_changed',
            message: '刷新期间关联记录已修改、添加或删除，此 Offer 已保留原成本，请重试',
          });
          continue;
        }
        for (const { target, costCents } of group) {
          if (!Number.isSafeInteger(costCents) || costCents < 0 || costCents > 100_000_000_000_000)
            throw new BadRequestException('广告消费金额超出可保存范围');
          write.run(costCents, refreshedAt, target.id, target.offerName, target.costCents, target.updatedAt);
          updatedRecords++;
        }
        updatedOffers++;
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { updatedRecords, updatedOffers, issues };
  }
  rebates(query: RebateQuery): RebateList {
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];
    if (query.accountId) {
      conditions.push('r.account_id=?');
      parameters.push(query.accountId);
    }
    for (const field of ['settled', 'banned'] as const) {
      if (query[field] !== 'all') {
        conditions.push(`r.${field}=?`);
        parameters.push(Number(query[field] === 'yes'));
      }
    }
    if (query.search) {
      const fields = [
        "json_extract(a.payload,'$.email')",
        "json_extract(a.payload,'$.name')",
        "json_extract(a.payload,'$.group')",
        'r.site_name',
        'r.domain',
        'r.offer_name',
        'r.ip',
        'r.settlement_cycle',
      ];
      conditions.push(
        `(${fields.map((field) => `instr(zohome_lower(${field}),?)>0`).join(' OR ')})`,
      );
      parameters.push(...fields.map(() => query.search.toLocaleLowerCase()));
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const from = ` FROM rebate_registrations r JOIN accounts a ON a.id=r.account_id${where}`;
    // SQL filters/aggregates the entire matching set; only the requested page is hydrated.
    // TOTAL avoids SQLite integer-sum overflow with a large imported workspace.
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS record_count,
      COUNT(DISTINCT r.account_id) AS account_count,
      ${rebateMoneyTotals}${from}`,
      )
      .get(...parameters)!;
    if (
      !Number.isSafeInteger(Number(totals.revenue_cents)) ||
      !Number.isSafeInteger(Number(totals.cost_cents))
    ) {
      throw new BadRequestException(
        '汇总金额超出精确计算范围，请按邮箱或关键词缩小筛选范围',
      );
    }
    const total = Number(totals.record_count);
    const page = Math.min(
      query.page,
      Math.max(1, Math.ceil(total / query.pageSize)),
    );
    const records = this.db
      .prepare(
        `${rebateSelect}${where}
      ORDER BY r.registered_at DESC,r.created_at DESC,r.id LIMIT ? OFFSET ?`,
      )
      .all(...parameters, query.pageSize, (page - 1) * query.pageSize)
      .map((row) => this.rebateRecord(row));
    const comparison: RebateComparison[] = this.db
      .prepare(
        `SELECT r.account_id,r.site_name,r.domain,r.offer_name,
      json_extract(a.payload,'$.email') AS account_email,
      json_extract(a.payload,'$.name') AS account_name,
      ${rebateMoneyTotals},
      COUNT(*) AS record_count${from}
      GROUP BY r.account_id,r.site_name,r.domain,r.offer_name
      ORDER BY revenue_cents DESC,r.offer_name,r.site_name,r.domain,account_email,r.account_id`,
      )
      .all(...parameters)
      .map((row) => ({
        accountId: String(row.account_id),
        accountEmail: String(row.account_email),
        accountName: String(row.account_name || ''),
        siteName: String(row.site_name),
        domain: String(row.domain),
        offerName: String(row.offer_name),
        totalRevenue: Number(row.revenue_cents) / 100,
        settledRevenue: Number(row.settled_revenue_cents) / 100,
        unsettledRevenue: Number(row.unsettled_revenue_cents) / 100,
        totalCost: Number(row.cost_cents) / 100,
        conversionRate: rebateRate(
          Number(row.cost_cents),
          Number(row.revenue_cents),
        ),
        recordCount: Number(row.record_count),
      }));
    return {
      records,
      total,
      page,
      pageSize: query.pageSize,
      summary: {
        totalRevenue: Number(totals.revenue_cents) / 100,
        settledRevenue: Number(totals.settled_revenue_cents) / 100,
        unsettledRevenue: Number(totals.unsettled_revenue_cents) / 100,
        totalCost: Number(totals.cost_cents) / 100,
        conversionRate: rebateRate(
          Number(totals.cost_cents),
          Number(totals.revenue_cents),
        ),
        recordCount: total,
        accountCount: Number(totals.account_count),
      },
      comparison,
    };
  }
  createRebate(input: RebateInput) {
    if (!this.account(input.accountId))
      throw new NotFoundException('邮箱账号不存在');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.writeRebate(id, input, now, now);
    return this.rebate(id)!;
  }
  updateRebate(id: string, input: RebateInput) {
    const previous = this.rebate(id);
    if (!previous) throw new NotFoundException('返利网记录不存在');
    if (!this.account(input.accountId))
      throw new NotFoundException('邮箱账号不存在');
    this.writeRebate(id, input, previous.createdAt, new Date().toISOString());
    return this.rebate(id)!;
  }
  removeRebate(id: string) {
    const result = this.db
      .prepare('DELETE FROM rebate_registrations WHERE id=?')
      .run(id);
    if (!result.changes) throw new NotFoundException('返利网记录不存在');
    return { success: true };
  }
  private writeRebate(
    id: string,
    input: RebateInput,
    createdAt: string,
    updatedAt: string,
  ) {
    this.db
      .prepare(
        `INSERT INTO rebate_registrations(
      id,account_id,site_name,domain,registered_at,offer_name,revenue_cents,cost_cents,
      settled,settlement_cycle,banned,ip,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      account_id=excluded.account_id,site_name=excluded.site_name,domain=excluded.domain,
      registered_at=excluded.registered_at,offer_name=excluded.offer_name,
      revenue_cents=excluded.revenue_cents,cost_cents=excluded.cost_cents,
      settled=excluded.settled,settlement_cycle=excluded.settlement_cycle,
      banned=excluded.banned,ip=excluded.ip,updated_at=excluded.updated_at`,
      )
      .run(
        id,
        input.accountId,
        input.siteName,
        input.domain,
        input.registeredAt,
        input.offerName,
        Math.round(input.totalRevenue * 100),
        Math.round(input.totalCost * 100),
        Number(input.settled),
        input.settlementCycle,
        Number(input.banned),
        input.ip,
        createdAt,
        updatedAt,
      );
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

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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
import {
  FingerprintBrowserAccount,
  FingerprintBrowserImportInput,
  FingerprintBrowserImportResult,
  FingerprintBrowserInput,
  FingerprintBrowserList,
  FingerprintBrowserOptions,
  FingerprintBrowserQuery,
  FingerprintBrowserRecord,
} from './fingerprint-browsers.types';

const rebateMailboxId = `COALESCE(r.account_id,zohome_rebate_email_id(r.standalone_email))`;
const rebateMailboxEmail = `COALESCE(json_extract(a.payload,'$.email'),r.standalone_email)`;
const rebateMailboxName = `CASE WHEN r.account_id IS NULL THEN r.standalone_email ELSE COALESCE(json_extract(a.payload,'$.name'),'') END`;
const rebateMailboxGroup = `CASE WHEN r.account_id IS NULL THEN '未知' ELSE COALESCE(json_extract(a.payload,'$.group'),'') END`;
const rebateSelect = `SELECT r.*,
  ${rebateMailboxId} AS rebate_account_id,
  ${rebateMailboxEmail} AS account_email,
  ${rebateMailboxName} AS account_name,
  ${rebateMailboxGroup} AS account_group,
  fb.browser_id AS browser_external_id,fb.serial_number AS browser_serial_number
  FROM rebate_registrations r LEFT JOIN accounts a ON a.id=r.account_id
  LEFT JOIN fingerprint_browsers fb ON fb.id=r.fingerprint_browser_id`;

const standaloneId = (email: string) => `rebate-email:${createHash('sha256').update(email).digest('hex')}`;
const rebateTable = (name: string) => `CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  standalone_email TEXT NOT NULL DEFAULT '',
  fingerprint_browser_id TEXT REFERENCES fingerprint_browsers(id) ON DELETE SET NULL,
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
  updated_at TEXT NOT NULL,
  CHECK ((account_id IS NOT NULL AND standalone_email='') OR (account_id IS NULL AND standalone_email<>''))
)`;

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
    this.db.function('zohome_rebate_email_id', { deterministic: true }, (value) =>
      standaloneId(String(value ?? '').trim().toLowerCase()),
    );
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL, folder TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id,id));
      CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS message_folder ON messages(account_id,folder);
      CREATE TABLE IF NOT EXISTS daily_stats (day TEXT PRIMARY KEY, sent_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS pending_bindings (state_hash TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS fingerprint_browsers (
        id TEXT PRIMARY KEY,browser_id TEXT NOT NULL UNIQUE,serial_number TEXT NOT NULL UNIQUE,
        window_name TEXT NOT NULL,proxy_info TEXT NOT NULL DEFAULT '',account_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      ${rebateTable('IF NOT EXISTS rebate_registrations')};`);
    this.migrateRebateEmails();
    if (!this.db.prepare('PRAGMA table_info(rebate_registrations)').all().some((column) => column.name === 'fingerprint_browser_id'))
      this.db.exec('ALTER TABLE rebate_registrations ADD COLUMN fingerprint_browser_id TEXT REFERENCES fingerprint_browsers(id) ON DELETE SET NULL');
    this.db.exec(`CREATE INDEX IF NOT EXISTS rebate_account ON rebate_registrations(account_id);
      CREATE INDEX IF NOT EXISTS rebate_fingerprint_browser ON rebate_registrations(fingerprint_browser_id);
      CREATE INDEX IF NOT EXISTS rebate_recent ON rebate_registrations(registered_at DESC,created_at DESC,id);
      CREATE INDEX IF NOT EXISTS rebate_standalone_email ON rebate_registrations(standalone_email) WHERE account_id IS NULL;`);
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
  private migrateRebateEmails() {
    const columns = this.db.prepare('PRAGMA table_info(rebate_registrations)').all();
    if (columns.some((column) => column.name === 'standalone_email')) return;
    // Rebuild only the child table so existing accounts, mail and encryption stay untouched.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(`${rebateTable('rebate_registrations_next')};
        INSERT INTO rebate_registrations_next(
          id,account_id,site_name,domain,registered_at,offer_name,revenue_cents,cost_cents,
          settled,settlement_cycle,banned,ip,created_at,updated_at)
        SELECT id,account_id,site_name,domain,registered_at,offer_name,revenue_cents,cost_cents,
          settled,settlement_cycle,banned,ip,created_at,updated_at FROM rebate_registrations;
        DROP TABLE rebate_registrations;
        ALTER TABLE rebate_registrations_next RENAME TO rebate_registrations;
        COMMIT;`);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
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
        account.provider !== 'outlook' &&
        !account.clientId &&
        !account.encryptedClientSecret &&
        this.config.oauthConfigured;
      return {
        id: account.id,
        provider: account.provider || 'zoho',
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
      accountId: String(row.rebate_account_id),
      accountEmail: String(row.account_email),
      accountUnknown: row.account_id === null,
      accountName: String(row.account_name || ''),
      accountGroup: String(row.account_group || ''),
      fingerprintBrowserId: String(row.fingerprint_browser_id || ''),
      fingerprintBrowserExternalId: String(row.browser_external_id || ''),
      fingerprintBrowserSerialNumber: String(row.browser_serial_number || ''),
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
      accounts: [
        ...this.publicAccounts().map(({ id, email, name, group }) => ({ id, email, name, group, unknown: false })),
        ...this.db.prepare(`SELECT DISTINCT standalone_email AS email FROM rebate_registrations
          WHERE account_id IS NULL ORDER BY standalone_email`).all().map((row) => {
          const email = String(row.email);
          return { id: standaloneId(email), email, name: email, group: '未知', unknown: true };
        }),
      ],
      siteNames: options('site_name'),
      domains: options('domain'),
      offerNames: options('offer_name'),
    };
  }
  private fingerprintBrowserEmailOptions(): FingerprintBrowserAccount[] {
    const options = this.rebateOptions().accounts.map((account) => ({
      ...account,
      rebates: [] as FingerprintBrowserAccount['rebates'],
    }));
    const accounts = new Map(options.map((account) => [account.id, account]));
    for (const row of this.db.prepare(`SELECT r.id,${rebateMailboxId} AS mailbox_id,
      r.offer_name,r.site_name,r.domain FROM rebate_registrations r
      LEFT JOIN accounts a ON a.id=r.account_id ORDER BY r.site_name,r.offer_name,r.id`).all()) {
      accounts.get(String(row.mailbox_id))?.rebates.push({
        id: String(row.id), offerName: String(row.offer_name),
        siteName: String(row.site_name), domain: String(row.domain),
      });
    }
    return options;
  }
  fingerprintBrowserOptions(): FingerprintBrowserOptions {
    return {
      browsers: this.db.prepare(`SELECT id,browser_id,serial_number,window_name FROM fingerprint_browsers
        ORDER BY length(serial_number),serial_number,browser_id`).all().map((row) => ({
        id: String(row.id), browserId: String(row.browser_id),
        serialNumber: String(row.serial_number), windowName: String(row.window_name),
      })),
      accounts: this.fingerprintBrowserEmailOptions(),
    };
  }
  private fingerprintBrowserRecords(): FingerprintBrowserRecord[] {
    const accounts = new Map(this.fingerprintBrowserEmailOptions().map((account) => [account.id, account]));
    const linked = new Map<string, Set<string>>();
    for (const row of this.db.prepare(`SELECT DISTINCT r.fingerprint_browser_id,${rebateMailboxId} AS mailbox_id
      FROM rebate_registrations r LEFT JOIN accounts a ON a.id=r.account_id
      WHERE r.fingerprint_browser_id IS NOT NULL`).all()) {
      const browserId = String(row.fingerprint_browser_id);
      if (!linked.has(browserId)) linked.set(browserId, new Set());
      linked.get(browserId)!.add(String(row.mailbox_id));
    }
    return this.db.prepare(`SELECT * FROM fingerprint_browsers
      ORDER BY length(serial_number),serial_number,browser_id`).all().map((row) => {
      const id = String(row.id);
      const accountIds = (JSON.parse(String(row.account_ids)) as string[]).filter((accountId) => accounts.has(accountId));
      const associated = new Set([...accountIds, ...(linked.get(id) || [])]);
      return {
        id, serialNumber: String(row.serial_number), browserId: String(row.browser_id),
        windowName: String(row.window_name), proxyInfo: String(row.proxy_info), accountIds,
        accounts: [...associated].flatMap((accountId) => accounts.has(accountId) ? [accounts.get(accountId)!] : []),
        createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      };
    });
  }
  fingerprintBrowsers(query: FingerprintBrowserQuery = { search: '', page: 1, pageSize: 20 }): FingerprintBrowserList {
    const search = query.search.trim().toLocaleLowerCase();
    const matching = this.fingerprintBrowserRecords().filter((record) => !search || [
      record.serialNumber, record.browserId, record.windowName, record.proxyInfo,
      ...record.accounts.flatMap((account) => [account.email, account.name,
        ...account.rebates.flatMap((rebate) => [rebate.offerName, rebate.siteName])]),
    ].some((value) => value.toLocaleLowerCase().includes(search)));
    const page = Math.min(query.page, Math.max(1, Math.ceil(matching.length / query.pageSize)));
    return {
      records: matching.slice((page - 1) * query.pageSize, page * query.pageSize),
      total: matching.length, page, pageSize: query.pageSize,
    };
  }
  private normalizeFingerprintBrowser(
    input: FingerprintBrowserImportInput,
    fallbackAccountIds: string[] = [],
    allowedAccountIds = new Set(this.rebateOptions().accounts.map((account) => account.id)),
  ): FingerprintBrowserInput {
    const fields = [
      ['serialNumber', '序号', 100], ['browserId', 'ID', 128],
      ['windowName', '窗口名称', 200], ['proxyInfo', '代理信息', 4000],
    ] as const;
    const normalized = {} as FingerprintBrowserInput;
    for (const [key, label, max] of fields) {
      if (typeof input[key] !== 'string' || input[key].trim().length > max ||
          (key !== 'proxyInfo' && !input[key].trim()))
        throw new BadRequestException(`${label}${key === 'proxyInfo' ? '' : '不能为空，且'}须为不超过 ${max} 个字符的文本`);
      normalized[key] = input[key].trim();
    }
    const accountIds = input.accountIds === undefined
      ? fallbackAccountIds.filter((id) => allowedAccountIds.has(id)) : input.accountIds;
    if (!Array.isArray(accountIds) || accountIds.length > 2000 || accountIds.some((id) =>
      typeof id !== 'string' || !allowedAccountIds.has(id)))
      throw new BadRequestException('关联邮箱无效，请从返利网已有邮箱中选择');
    normalized.accountIds = [...new Set(accountIds)];
    return normalized;
  }
  private assertFingerprintBrowserUnique(input: FingerprintBrowserInput, exceptId = '') {
    if (this.db.prepare('SELECT id FROM fingerprint_browsers WHERE id<>? AND browser_id=?').get(exceptId, input.browserId))
      throw new BadRequestException('指纹浏览器 ID 已存在');
    if (this.db.prepare('SELECT id FROM fingerprint_browsers WHERE id<>? AND serial_number=?').get(exceptId, input.serialNumber))
      throw new BadRequestException('指纹浏览器序号已存在');
  }
  private writeFingerprintBrowser(id: string, input: FingerprintBrowserInput, createdAt: string, updatedAt: string) {
    this.db.prepare(`INSERT INTO fingerprint_browsers(id,browser_id,serial_number,window_name,proxy_info,account_ids,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET browser_id=excluded.browser_id,
      serial_number=excluded.serial_number,window_name=excluded.window_name,proxy_info=excluded.proxy_info,
      account_ids=excluded.account_ids,updated_at=excluded.updated_at`).run(
      id, input.browserId, input.serialNumber, input.windowName, input.proxyInfo,
      JSON.stringify(input.accountIds), createdAt, updatedAt,
    );
  }
  createFingerprintBrowser(input: FingerprintBrowserInput) {
    const normalized = this.normalizeFingerprintBrowser(input);
    this.assertFingerprintBrowserUnique(normalized);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.writeFingerprintBrowser(id, normalized, now, now);
    return this.fingerprintBrowserRecords().find((record) => record.id === id)!;
  }
  updateFingerprintBrowser(id: string, input: FingerprintBrowserInput) {
    const previous = this.db.prepare('SELECT created_at FROM fingerprint_browsers WHERE id=?').get(id);
    if (!previous) throw new NotFoundException('指纹浏览器不存在');
    const normalized = this.normalizeFingerprintBrowser(input);
    this.assertFingerprintBrowserUnique(normalized, id);
    this.writeFingerprintBrowser(id, normalized, String(previous.created_at), new Date().toISOString());
    return this.fingerprintBrowserRecords().find((record) => record.id === id)!;
  }
  removeFingerprintBrowser(id: string) {
    const result = this.db.prepare('DELETE FROM fingerprint_browsers WHERE id=?').run(id);
    if (!result.changes) throw new NotFoundException('指纹浏览器不存在');
    return { success: true };
  }
  replaceFingerprintBrowsers(inputs: FingerprintBrowserImportInput[]): FingerprintBrowserImportResult {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 10000)
      throw new BadRequestException('导入须包含 1 至 10000 条有效指纹浏览器记录');
    const existing = this.db.prepare('SELECT * FROM fingerprint_browsers').all();
    const byBrowserId = new Map(existing.map((row) => [String(row.browser_id), row]));
    const allowed = new Set(this.rebateOptions().accounts.map((account) => account.id));
    const normalized = inputs.map((input) => this.normalizeFingerprintBrowser(
      input, JSON.parse(String(byBrowserId.get(input.browserId?.trim())?.account_ids || '[]')) as string[], allowed,
    ));
    const browserIds = new Set<string>();
    const serialNumbers = new Set<string>();
    for (const input of normalized) {
      if (browserIds.has(input.browserId)) throw new BadRequestException(`导入存在重复 ID：${input.browserId}`);
      if (serialNumbers.has(input.serialNumber)) throw new BadRequestException(`导入存在重复序号：${input.serialNumber}`);
      browserIds.add(input.browserId);
      serialNumbers.add(input.serialNumber);
    }
    const removed = existing.filter((row) => !browserIds.has(String(row.browser_id)));
    let unlinkedRebates = 0;
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of removed) {
        unlinkedRebates += Number(this.db.prepare(`UPDATE rebate_registrations SET fingerprint_browser_id=NULL,updated_at=?
          WHERE fingerprint_browser_id=?`).run(now, String(row.id)).changes);
        this.db.prepare('DELETE FROM fingerprint_browsers WHERE id=?').run(String(row.id));
      }
      // Permit serial numbers to be reassigned between retained browsers atomically.
      for (const row of existing) {
        if (browserIds.has(String(row.browser_id)))
          this.db.prepare('UPDATE fingerprint_browsers SET serial_number=? WHERE id=?').run(`import-${randomUUID()}`, String(row.id));
      }
      for (const input of normalized) {
        const previous = byBrowserId.get(input.browserId);
        this.writeFingerprintBrowser(previous ? String(previous.id) : randomUUID(), input,
          previous ? String(previous.created_at) : now, now);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { imported: normalized.length, removed: removed.length, unlinkedRebates };
  }
  rebateCostTargets(): RebateCostTarget[] {
    return this.db
      .prepare(`SELECT r.id,${rebateMailboxId} AS account_id,${rebateMailboxEmail} AS account_email,
        r.offer_name,r.cost_cents,r.updated_at FROM rebate_registrations r LEFT JOIN accounts a ON a.id=r.account_id`)
      .all()
      .map((row) => ({
        id: String(row.id),
        accountId: String(row.account_id),
        mailboxKey: String(row.account_email).trim().toLowerCase(),
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
            row.mailboxKey === target.mailboxKey &&
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
      conditions.push(`${rebateMailboxId}=?`);
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
        rebateMailboxEmail,
        rebateMailboxName,
        rebateMailboxGroup,
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
    const from = ` FROM rebate_registrations r LEFT JOIN accounts a ON a.id=r.account_id${where}`;
    // SQL filters/aggregates the entire matching set; only the requested page is hydrated.
    // TOTAL avoids SQLite integer-sum overflow with a large imported workspace.
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS record_count,
      COUNT(DISTINCT ${rebateMailboxId}) AS account_count,
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
        `SELECT ${rebateMailboxId} AS rebate_account_id,r.account_id,r.site_name,r.domain,r.offer_name,
      ${rebateMailboxEmail} AS account_email,
      ${rebateMailboxName} AS account_name,
      ${rebateMoneyTotals},
      COUNT(*) AS record_count${from}
      GROUP BY ${rebateMailboxId},r.site_name,r.domain,r.offer_name
      ORDER BY revenue_cents DESC,r.offer_name,r.site_name,r.domain,account_email,rebate_account_id`,
      )
      .all(...parameters)
      .map((row) => ({
        accountId: String(row.rebate_account_id),
        accountEmail: String(row.account_email),
        accountUnknown: row.account_id === null,
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
    const id = randomUUID();
    const now = new Date().toISOString();
    this.writeRebate(id, input, now, now);
    return this.rebate(id)!;
  }
  updateRebate(id: string, input: RebateInput) {
    const previous = this.rebate(id);
    if (!previous) throw new NotFoundException('返利网记录不存在');
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
    const mailbox = this.resolveRebateMailbox(input);
    const fingerprintBrowserId = input.fingerprintBrowserId?.trim() || null;
    if (fingerprintBrowserId && !this.db.prepare('SELECT id FROM fingerprint_browsers WHERE id=?').get(fingerprintBrowserId))
      throw new BadRequestException('指纹浏览器不存在，请从已有 ID 或序号中重新选择');
    this.db
      .prepare(
        `INSERT INTO rebate_registrations(
      id,account_id,standalone_email,site_name,domain,registered_at,offer_name,revenue_cents,cost_cents,
      settled,settlement_cycle,banned,ip,created_at,updated_at,fingerprint_browser_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      account_id=excluded.account_id,standalone_email=excluded.standalone_email,site_name=excluded.site_name,domain=excluded.domain,
      registered_at=excluded.registered_at,offer_name=excluded.offer_name,
      revenue_cents=excluded.revenue_cents,cost_cents=excluded.cost_cents,
      settled=excluded.settled,settlement_cycle=excluded.settlement_cycle,
      banned=excluded.banned,ip=excluded.ip,updated_at=excluded.updated_at,
      fingerprint_browser_id=excluded.fingerprint_browser_id`,
      )
      .run(
        id,
        mailbox.accountId,
        mailbox.email,
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
        fingerprintBrowserId,
      );
  }
  private resolveRebateMailbox(input: RebateInput): { accountId: string | null; email: string } {
    const id = input.accountId.trim();
    const email = input.accountEmail?.trim().toLowerCase() || '';
    if (id) {
      const account = this.account(id);
      if (account) {
        if (email && email !== account.email.trim().toLowerCase())
          throw new BadRequestException('邮箱地址与所选邮箱不一致，请重新选择');
        return { accountId: account.id, email: '' };
      }
      const standalone = this.db.prepare(`SELECT standalone_email FROM rebate_registrations
        WHERE account_id IS NULL AND zohome_rebate_email_id(standalone_email)=? LIMIT 1`).get(id);
      if (!standalone) throw new NotFoundException('邮箱不存在，请选择已有邮箱或直接填写邮箱地址');
      if (email && email !== standalone.standalone_email)
        throw new BadRequestException('邮箱地址与所选未知邮箱不一致，请重新填写');
      return { accountId: null, email: String(standalone.standalone_email) };
    }
    if (!email) throw new BadRequestException('请选择邮箱或填写有效的邮箱地址');
    const existing = this.accounts().find((account) => account.email.trim().toLowerCase() === email);
    return existing ? { accountId: existing.id, email: '' } : { accountId: null, email };
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

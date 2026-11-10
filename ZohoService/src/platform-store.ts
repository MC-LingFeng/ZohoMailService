import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppConfig } from './config';

export type WorkspaceRole = 'owner' | 'member';
export interface UserSummary { id: string; username: string; isPlatformAdmin: boolean }
export interface WorkspaceSummary { id: string; name: string; role: WorkspaceRole }
export interface WorkspaceConfig { id: string; dataDir: string; encryptionKey: string; settings: Record<string, string>; legacy: boolean }
export interface SessionRecord { id: string; userId: string; expiresAt: number }
export interface OAuthStateRecord { sessionId: string; userId: string; workspaceId: string; provider: string; expiresAt: number }
type Row = Record<string, unknown>;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fileDigest = (file: string) => {
  const checksum = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const descriptor = openSync(file, 'r');
  try {
    let length: number;
    while ((length = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) checksum.update(buffer.subarray(0, length));
    return checksum.digest('hex');
  } finally { closeSync(descriptor); }
};
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const userSummary = (row: Row): UserSummary => ({ id: String(row.id), username: String(row.username), isPlatformAdmin: Boolean(row.is_platform_admin) });
const hashPassword = (password: string) => {
  const salt = randomBytes(24).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
};
const verifyPassword = (password: string, encoded: string) => {
  const [algorithm, salt, value] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !/^[a-f\d]{128}$/i.test(value || '')) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(value, 'hex'));
};
const dummyPassword = hashPassword(randomBytes(32).toString('hex'));

@Injectable()
export class PlatformStore implements OnModuleDestroy {
  private readonly db: DatabaseSync;
  private readonly masterKey: Buffer;
  readonly defaultWorkspaceId: string;
  readonly defaultAdminId: string;

  constructor(private readonly config: AppConfig) {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    if (/^[a-f\d]{64}$/i.test(config.encryptionKey)) this.masterKey = Buffer.from(config.encryptionKey, 'hex');
    else {
      if (config.live) throw new Error('平台加密密钥无效，无法打开工作区');
      const keyFile = join(config.dataDir, 'platform-demo.key');
      if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
      const value = readFileSync(keyFile, 'utf8');
      if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('演示平台加密密钥损坏');
      this.masterKey = Buffer.from(value, 'hex');
    }
    const file = join(config.dataDir, `platform-${config.mode}.sqlite`);
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,is_platform_admin INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY,name TEXT NOT NULL,data_dir TEXT NOT NULL UNIQUE,encrypted_key TEXT NOT NULL,settings_cipher TEXT NOT NULL,legacy INTEGER NOT NULL DEFAULT 0,database_initialized INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('owner','member')),created_at TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id));
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY,session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,provider TEXT NOT NULL DEFAULT '',expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS state_expiry ON oauth_states(expires_at);`);
    if (!this.db.prepare('PRAGMA table_info(workspaces)').all().some((column) => column.name === 'database_initialized'))
      this.db.exec('ALTER TABLE workspaces ADD COLUMN database_initialized INTEGER NOT NULL DEFAULT 0');
    try {
      this.db.exec('BEGIN IMMEDIATE');
      let workspace = this.db.prepare("SELECT value FROM metadata WHERE key='default_workspace_id'").get();
      let admin = this.db.prepare("SELECT value FROM metadata WHERE key='default_admin_id'").get();
      if (!workspace || !admin) {
        const workspaceId = randomUUID();
        const userId = randomUUID();
        const source = join(config.dataDir, `${config.mode}.sqlite`);
        const dataDir = join(config.dataDir, 'workspaces', workspaceId);
        mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        const legacy = existsSync(source);
        if (legacy) this.snapshotLegacy(source, dataDir, workspaceId);
        const now = new Date().toISOString();
        const username = (config as AppConfig & { adminUsername?: string }).adminUsername || 'admin';
        this.validateUsername(username);
        this.db.prepare('INSERT INTO users(id,username,password_hash,is_platform_admin,created_at) VALUES(?,?,?,?,?)').run(userId, username, hashPassword(config.password), 1, now);
        this.db.prepare('INSERT INTO workspaces(id,name,data_dir,encrypted_key,settings_cipher,legacy,created_at) VALUES(?,?,?,?,?,?,?)').run(workspaceId, '默认工作区', dataDir, this.encrypt(config.encryptionKey || this.masterKey.toString('hex')), this.encrypt(JSON.stringify(this.legacySettings())), Number(legacy), now);
        this.db.prepare('INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES(?,?,?,?)').run(workspaceId, userId, 'owner', now);
        this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('default_workspace_id', workspaceId);
        this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('default_admin_id', userId);
        workspace = { value: workspaceId };
        admin = { value: userId };
      }
      this.defaultWorkspaceId = String(workspace.value);
      this.defaultAdminId = String(admin.value);
      // Fail closed if the catalog key no longer decrypts; never regenerate keys
      // or silently create an empty workspace over inaccessible saved data.
      this.workspaceConfig(this.defaultWorkspaceId);
      for (const row of this.db.prepare('SELECT id FROM workspaces WHERE database_initialized=0').all()) {
        if (this.workspaceDatabaseExists(String(row.id))) this.markWorkspaceInitialized(String(row.id));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
    this.cleanup();
  }

  onModuleDestroy() { this.db.close(); }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }
  private decrypt(value: string) {
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error('工作区加密信息无效，请恢复原平台密钥');
    const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64url'));
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch { throw new Error('工作区加密信息无法解密，请恢复原 TOKEN_ENCRYPTION_KEY，不要重置数据库'); }
  }
  private legacySettings(): Record<string, string> {
    const settings: Record<string, string> = {
      ZOHO_CLIENT_ID: this.config.clientId, ZOHO_CLIENT_SECRET: this.config.clientSecret,
      ADS_MANAGER_ACCOUNT: this.config.adsManagerAccount, ADS_CREDENTIALS_FILE: this.config.adsCredentialsFile,
      ADS_API_VERSION: this.config.adsApiVersion, OUTLOOK_TENANT: this.config.outlookTenant,
      ZOHO_MIN_REQUEST_INTERVAL_MS: String(this.config.minInterval),
    };
    if (existsSync(this.config.adsCredentialsFile)) {
      const file = statSync(this.config.adsCredentialsFile);
      if (!file.isFile() || file.size > 1024 * 1024) throw new Error('现有 Google Ads 凭据文件格式或大小异常，原文件保持不变');
      settings.ADS_CREDENTIALS_JSON = readFileSync(this.config.adsCredentialsFile, 'utf8');
    }
    return settings;
  }
  private snapshotLegacy(source: string, dataDir: string, workspaceId: string) {
    const directory = join(this.config.dataDir, 'backups');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const backup = join(directory, `single-workspace-${this.config.mode}-${workspaceId}.sqlite`);
    const destination = join(dataDir, `${this.config.mode}.sqlite`);
    const original = new DatabaseSync(source, { readOnly: true });
    try {
      original.exec('PRAGMA busy_timeout=5000');
      const check = original.prepare('PRAGMA quick_check').all();
      if (check.some((row) => Object.values(row)[0] !== 'ok')) throw new Error('现有数据库完整性检查失败，未迁移或修改原数据');
      // VACUUM INTO takes a consistent SQLite snapshot, including committed WAL
      // pages. A plain file copy of the legacy main file would miss those pages.
      original.prepare('VACUUM INTO ?').run(backup);
    } finally { original.close(); }
    chmodSync(backup, 0o600);
    const snapshot = new DatabaseSync(backup, { readOnly: true });
    let counts: Record<string, number>;
    try {
      if (snapshot.prepare('PRAGMA quick_check').all().some((row) => Object.values(row)[0] !== 'ok')) throw new Error('迁移备份校验失败，原数据保持不变');
      counts = Object.fromEntries(snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((row) => {
        const table = String(row.name);
        return [table, Number(snapshot.prepare(`SELECT count(*) AS count FROM ${quote(table)}`).get()!.count)];
      }));
    } finally { snapshot.close(); }
    copyFileSync(backup, destination, constants.COPYFILE_EXCL);
    chmodSync(destination, 0o600);
    const sha256 = fileDigest(backup);
    if (fileDigest(destination) !== sha256) throw new Error('工作区数据库副本校验失败，原数据及备份保持不变');
    writeFileSync(join(directory, `single-workspace-${this.config.mode}-${workspaceId}.json`), JSON.stringify({
      version: 1, mode: this.config.mode, workspaceId, source, backup, destination,
      createdAt: new Date().toISOString(), sha256, tableCounts: counts!, originalPreserved: true,
    }, null, 2), { flag: 'wx', mode: 0o600 });
  }

  private validateUsername(value: string) {
    if (typeof value !== 'string' || !/^[a-z\d][a-z\d_.@-]{0,79}$/i.test(value)) throw new BadRequestException('用户名须为 1 至 80 位字母、数字、点、下划线、@ 或连字符');
  }
  private validatePassword(value: string) {
    if (typeof value !== 'string' || value.length < 12 || value.length > 256) throw new BadRequestException('登录密码长度须为 12 至 256 个字符');
  }
  private workspaceName(value: string) {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > 80) throw new BadRequestException('工作区名称须为 1 至 80 个字符');
    return name;
  }
  findUser(username: string) {
    const row = this.db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
    return row ? userSummary(row) : null;
  }
  userById(id: string) {
    const row = this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
    return row ? userSummary(row) : null;
  }
  verifyCredentials(username: string, password: string) {
    const row = this.db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
    const valid = verifyPassword(password, row ? String(row.password_hash) : dummyPassword);
    if (!row || !valid) throw new UnauthorizedException('用户名或密码不正确');
    return userSummary(row);
  }
  private requireAdmin(actorId: string) {
    if (!this.userById(actorId)?.isPlatformAdmin) throw new ForbiddenException('仅平台管理员可以管理用户');
  }
  listUsers(actorId: string) {
    this.requireAdmin(actorId);
    return this.db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE,id').all().map(userSummary);
  }
  createUser(actorId: string, username: string, password: string) {
    this.requireAdmin(actorId); this.validateUsername(username); this.validatePassword(password);
    if (this.findUser(username)) throw new ConflictException('用户名已存在');
    const id = randomUUID();
    this.db.prepare('INSERT INTO users(id,username,password_hash,is_platform_admin,created_at) VALUES(?,?,?,?,?)').run(id, username, hashPassword(password), 0, new Date().toISOString());
    return this.userById(id)!;
  }
  changePassword(userId: string, currentPassword: string, password: string) {
    const user = this.userById(userId);
    if (!user) throw new UnauthorizedException('请重新登录');
    this.verifyCredentials(user.username, currentPassword); this.validatePassword(password);
    this.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), userId);
    this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    return { success: true };
  }
  listWorkspaces(userId: string): WorkspaceSummary[] {
    const user = this.userById(userId);
    if (!user) return [];
    return this.db.prepare(`SELECT w.id,w.name,m.role FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=? WHERE m.user_id IS NOT NULL${user.isPlatformAdmin ? ' OR 1=1' : ''} ORDER BY w.created_at,w.id`).all(userId).map((row) => ({ id: String(row.id), name: String(row.name), role: !user.isPlatformAdmin && row.role === 'member' ? 'member' : 'owner' }));
  }
  workspaceForUser(workspaceId: string, userId: string): WorkspaceSummary | null {
    const user = this.userById(userId);
    if (!user) return null;
    const row = this.db.prepare('SELECT w.id,w.name,m.role FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=? WHERE w.id=?').get(userId, workspaceId);
    if (!row || (!row.role && !user.isPlatformAdmin)) return null;
    return { id: String(row.id), name: String(row.name), role: !user.isPlatformAdmin && row.role === 'member' ? 'member' : 'owner' };
  }
  workspaceConfig(id: string): WorkspaceConfig {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
    if (!row) throw new NotFoundException('工作区不存在');
    // A workspace path is derived from its server-generated UUID and current
    // root, so moving the complete data directory never points back to a source
    // machine's absolute path stored by an earlier catalog version.
    const dataDir = join(this.config.dataDir, 'workspaces', String(row.id));
    const exists = this.workspaceDatabaseExists(String(row.id));
    if (!exists && (row.legacy || row.database_initialized)) throw new Error('工作区数据库缺失，请从保留的备份恢复；不会自动创建空库');
    if (exists && !row.database_initialized) this.markWorkspaceInitialized(String(row.id));
    return { id: String(row.id), dataDir, encryptionKey: this.decrypt(String(row.encrypted_key)), settings: JSON.parse(this.decrypt(String(row.settings_cipher))) as Record<string, string>, legacy: Boolean(row.legacy) };
  }
  private workspaceDatabaseExists(id: string) {
    const file = join(this.config.dataDir, 'workspaces', id, `${this.config.mode}.sqlite`);
    if (!existsSync(file)) return false;
    const expected = join(realpathSync(this.config.dataDir), 'workspaces', id, `${this.config.mode}.sqlite`);
    if (!statSync(file).isFile() || realpathSync(file) !== expected) throw new Error('工作区数据库路径异常，拒绝打开其他目录中的文件');
    return true;
  }
  markWorkspaceInitialized(id: string) {
    if (!this.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(id)) throw new NotFoundException('工作区不存在');
    if (!this.workspaceDatabaseExists(id)) throw new Error('工作区数据库尚未创建，不能标记为已初始化');
    this.db.prepare('UPDATE workspaces SET database_initialized=1 WHERE id=? AND database_initialized=0').run(id);
  }
  getWorkspaceSettings(id: string) { return this.workspaceConfig(id).settings; }
  setWorkspaceSettings(id: string, values: Record<string, string>) {
    this.workspaceConfig(id);
    if (!values || Array.isArray(values) || Object.values(values).some((value) => typeof value !== 'string')) throw new BadRequestException('工作区配置格式无效');
    this.db.prepare('UPDATE workspaces SET settings_cipher=? WHERE id=?').run(this.encrypt(JSON.stringify(values)), id);
  }
  createWorkspace(userId: string, name: string): WorkspaceSummary {
    if (!this.userById(userId)) throw new UnauthorizedException('请重新登录');
    const id = randomUUID(); const now = new Date().toISOString(); const clean = this.workspaceName(name);
    const dataDir = join(this.config.dataDir, 'workspaces', id);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO workspaces(id,name,data_dir,encrypted_key,settings_cipher,legacy,created_at) VALUES(?,?,?,?,?,?,?)').run(id, clean, dataDir, this.encrypt(randomBytes(32).toString('hex')), this.encrypt(JSON.stringify({ OUTLOOK_TENANT: 'common', ZOHO_MIN_REQUEST_INTERVAL_MS: '2100', ADS_API_VERSION: this.config.adsApiVersion })), 0, now);
      this.db.prepare('INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES(?,?,?,?)').run(id, userId, 'owner', now);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { id, name: clean, role: 'owner' };
  }
  private requireOwner(userId: string, workspaceId: string) {
    const workspace = this.workspaceForUser(workspaceId, userId);
    if (!workspace || workspace.role !== 'owner') throw new ForbiddenException('仅工作区所有者可以管理工作区');
    return workspace;
  }
  renameWorkspace(userId: string, id: string, name: string) {
    const workspace = this.requireOwner(userId, id);
    const clean = this.workspaceName(name);
    this.db.prepare('UPDATE workspaces SET name=? WHERE id=?').run(clean, id);
    return { ...workspace, name: clean };
  }
  members(userId: string, workspaceId: string) {
    this.requireOwner(userId, workspaceId);
    return this.db.prepare('SELECT u.id,u.username,m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY u.username COLLATE NOCASE,u.id').all(workspaceId).map((row) => ({ userId: String(row.id), username: String(row.username), role: row.role as WorkspaceRole }));
  }
  addMember(userId: string, workspaceId: string, username: string, role: WorkspaceRole) {
    this.requireOwner(userId, workspaceId);
    if (!['owner', 'member'].includes(role)) throw new BadRequestException('工作区角色无效');
    const user = this.findUser(username);
    if (!user) throw new NotFoundException('用户不存在，请联系平台管理员先创建用户');
    if (this.db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=?').get(workspaceId, user.id)) throw new ConflictException('该用户已是工作区成员');
    this.db.prepare('INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES(?,?,?,?)').run(workspaceId, user.id, role, new Date().toISOString());
    return { userId: user.id, username: user.username, role };
  }
  private keepOwner(workspaceId: string, userId: string) {
    const member = this.db.prepare('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?').get(workspaceId, userId);
    if (!member) throw new NotFoundException('工作区成员不存在');
    if (member.role === 'owner' && Number(this.db.prepare("SELECT count(*) AS count FROM workspace_members WHERE workspace_id=? AND role='owner'").get(workspaceId)!.count) <= 1) throw new BadRequestException('工作区至少保留一名所有者');
  }
  updateMember(actorId: string, workspaceId: string, userId: string, role: WorkspaceRole) {
    this.requireOwner(actorId, workspaceId);
    if (!['owner', 'member'].includes(role)) throw new BadRequestException('工作区角色无效');
    const member = this.db.prepare('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?').get(workspaceId, userId);
    if (!member) throw new NotFoundException('工作区成员不存在');
    if (role === 'member') this.keepOwner(workspaceId, userId);
    this.db.prepare('UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?').run(role, workspaceId, userId);
    return { userId, username: this.userById(userId)!.username, role };
  }
  removeMember(actorId: string, workspaceId: string, userId: string) {
    this.requireOwner(actorId, workspaceId); this.keepOwner(workspaceId, userId);
    this.db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(workspaceId, userId);
    this.db.prepare('DELETE FROM oauth_states WHERE workspace_id=? AND user_id=?').run(workspaceId, userId);
    return { success: true };
  }
  createSession(userId: string) {
    this.cleanup();
    const token = randomBytes(32).toString('base64url'); const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
    this.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token), userId, expiresAt);
    return { token, expiresAt };
  }
  session(token: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now());
    return row ? { id: String(row.token_hash), userId: String(row.user_id), expiresAt: Number(row.expires_at) } : null;
  }
  revokeSession(token: string) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); }
  createState(sessionToken: string, userId: string, workspaceId: string, provider = '') {
    const session = this.session(sessionToken);
    if (!session || session.userId !== userId || !this.workspaceForUser(workspaceId, userId)) throw new UnauthorizedException('登录或工作区权限已失效');
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO oauth_states(state_hash,session_hash,user_id,workspace_id,provider,expires_at) VALUES(?,?,?,?,?,?)').run(digest(token), session.id, userId, workspaceId, provider, Date.now() + 10 * 60_000);
    return token;
  }
  state(token: string): OAuthStateRecord | null {
    const row = this.db.prepare('SELECT * FROM oauth_states WHERE state_hash=? AND expires_at>?').get(digest(token), Date.now());
    return row ? { sessionId: String(row.session_hash), userId: String(row.user_id), workspaceId: String(row.workspace_id), provider: String(row.provider), expiresAt: Number(row.expires_at) } : null;
  }
  consumeState(token: string) {
    const record = this.state(token);
    this.db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(digest(token));
    return record;
  }
  private cleanup() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    this.db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(Date.now());
  }
}

import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Request, Response } from 'express';
import { AppConfig } from '../src/config';
import { PlatformStore } from '../src/platform-store';
import { decryptToken, encryptToken, SessionService } from '../src/security';
import { WorkspaceContext } from '../src/workspace-context';

const key = 'ab'.repeat(32);
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const configFor = (dataDir: string, overrides: Partial<AppConfig> = {}) => Object.assign(new AppConfig(), {
  mode: 'live', dataDir, encryptionKey: key, password: 'synthetic-admin-password',
  adsCredentialsFile: join(dataDir, 'missing-credentials.json'), ...overrides,
});
const temp = () => mkdtempSync(join(tmpdir(), 'zohome-platform-test-'));

test('legacy migration snapshots committed WAL, retains original bytes and exact credentials, and is idempotent', () => {
  const directory = temp();
  const sourceFile = join(directory, 'live.sqlite');
  const source = new DatabaseSync(sourceFile);
  source.exec('PRAGMA journal_mode=WAL; CREATE TABLE accounts(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE counters(value INTEGER NOT NULL); INSERT INTO counters VALUES(37)');
  const secret = encryptToken('  exact saved password !  ', key);
  const payload = JSON.stringify({ encryptedRefreshToken: secret, custom: '原始数据' });
  source.prepare('INSERT INTO accounts(id,payload) VALUES(?,?)').run('mail-1', payload);
  const originalHash = hash(readFileSync(sourceFile));
  const walHash = hash(readFileSync(`${sourceFile}-wal`));
  let platform: PlatformStore | null = null;
  try {
    platform = new PlatformStore(configFor(directory));
    const id = platform.defaultWorkspaceId;
    const descriptor = platform.workspaceConfig(id);
    assert.equal(descriptor.encryptionKey, key);
    assert.equal(descriptor.legacy, true);
    const imported = new DatabaseSync(join(descriptor.dataDir, 'live.sqlite'), { readOnly: true });
    try {
      assert.equal(imported.prepare('SELECT payload FROM accounts WHERE id=?').get('mail-1')!.payload, payload);
      assert.equal(imported.prepare('SELECT value FROM counters').get()!.value, 37);
      assert.equal(decryptToken(JSON.parse(String(imported.prepare('SELECT payload FROM accounts').get()!.payload)).encryptedRefreshToken, descriptor.encryptionKey), '  exact saved password !  ');
    } finally { imported.close(); }
    assert.equal(hash(readFileSync(sourceFile)), originalHash);
    assert.equal(hash(readFileSync(`${sourceFile}-wal`)), walHash);
    const manifestFile = readdirSync(join(directory, 'backups')).find((file) => file.endsWith('.json'))!;
    const manifest = JSON.parse(readFileSync(join(directory, 'backups', manifestFile), 'utf8'));
    assert.deepEqual(manifest.tableCounts, { accounts: 1, counters: 1 });
    assert.equal(manifest.originalPreserved, true);
    const backups = readdirSync(join(directory, 'backups'));
    platform.onModuleDestroy(); platform = null;
    platform = new PlatformStore(configFor(directory));
    assert.equal(platform.defaultWorkspaceId, id);
    assert.deepEqual(readdirSync(join(directory, 'backups')), backups);
    assert.equal(platform.verifyCredentials('admin', 'synthetic-admin-password').isPlatformAdmin, true);
  } finally {
    platform?.onModuleDestroy(); source.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('copying the complete data directory preserves workspace identity, wrapped keys and portable Ads credentials', () => {
  const root = temp(); const original = join(root, 'original'); const moved = join(root, 'server');
  const cfg = configFor(original);
  // A configured, trusted legacy file is captured encrypted without changing it.
  const credentials = JSON.stringify({ type: 'service_account', client_email: 'preview@example.com', private_key: 'synthetic private key' });
  mkdirSync(original, { recursive: true });
  writeFileSync(cfg.adsCredentialsFile, credentials);
  const legacy = new DatabaseSync(join(original, 'live.sqlite'));
  legacy.exec('CREATE TABLE saved(value TEXT); INSERT INTO saved VALUES(\'persisted\')'); legacy.close();
  let platform: PlatformStore | null = new PlatformStore(cfg);
  try {
    const id = platform.defaultWorkspaceId;
    const extra = platform.createWorkspace(platform.defaultAdminId, 'Second');
    const extraKey = platform.workspaceConfig(extra.id).encryptionKey;
    assert.notEqual(extraKey, key);
    assert.equal(platform.workspaceConfig(id).settings.ADS_CREDENTIALS_JSON, credentials);
    assert.equal(readFileSync(cfg.adsCredentialsFile, 'utf8'), credentials);
    const catalog = new DatabaseSync(join(original, 'platform-live.sqlite'), { readOnly: true });
    try {
      const row = catalog.prepare('SELECT encrypted_key,settings_cipher FROM workspaces WHERE id=?').get(id)!;
      assert.equal(String(row.settings_cipher).includes('synthetic private key'), false);
      assert.equal(String(row.encrypted_key).includes(key), false);
    } finally { catalog.close(); }
    platform.onModuleDestroy(); platform = null;
    cpSync(original, moved, { recursive: true });
    rmSync(original, { recursive: true, force: true });
    platform = new PlatformStore(configFor(moved));
    assert.equal(platform.defaultWorkspaceId, id);
    assert.equal(platform.workspaceConfig(id).dataDir, join(moved, 'workspaces', id));
    assert.equal(platform.workspaceConfig(id).settings.ADS_CREDENTIALS_JSON, credentials);
    assert.equal(platform.workspaceConfig(extra.id).encryptionKey, extraKey);
    const imported = new DatabaseSync(join(platform.workspaceConfig(id).dataDir, 'live.sqlite'), { readOnly: true });
    try { assert.equal(imported.prepare('SELECT value FROM saved').get()!.value, 'persisted'); } finally { imported.close(); }
  } finally { platform?.onModuleDestroy(); rmSync(root, { recursive: true, force: true }); }
});

test('invalid legacy database and wrong master key fail closed without replacing saved data', () => {
  const directory = temp();
  let platform: PlatformStore | null = null;
  try {
    const legacyFile = join(directory, 'live.sqlite');
    writeFileSync(legacyFile, 'synthetic invalid database');
    assert.throws(() => new PlatformStore(configFor(directory)));
    assert.equal(readFileSync(legacyFile, 'utf8'), 'synthetic invalid database');
    rmSync(legacyFile);
    const original = new DatabaseSync(legacyFile);
    original.exec('CREATE TABLE saved(value TEXT); INSERT INTO saved VALUES(\'do not lose\')'); original.close();
    platform = new PlatformStore(configFor(directory));
    const id = platform.defaultWorkspaceId;
    const imported = join(platform.workspaceConfig(id).dataDir, 'live.sqlite');
    const checksum = hash(readFileSync(imported));
    platform.onModuleDestroy(); platform = null;
    assert.throws(() => new PlatformStore(configFor(directory, { encryptionKey: 'cd'.repeat(32) })), /无法解密/);
    assert.equal(hash(readFileSync(imported)), checksum);
    platform = new PlatformStore(configFor(directory));
    assert.equal(platform.defaultWorkspaceId, id);
    platform.onModuleDestroy(); platform = null;
    rmSync(imported);
    assert.throws(() => new PlatformStore(configFor(directory)), /不会自动创建空库/);
    assert.equal(existsSync(imported), false);
  } finally { platform?.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

test('catalog passwords and membership stay isolated, while sessions survive restart and password changes revoke them', () => {
  const directory = temp(); let platform: PlatformStore | null = new PlatformStore(configFor(directory));
  try {
    const admin = platform.defaultAdminId;
    const user = platform.createUser(admin, 'member@example.com', 'synthetic-member-password');
    const otherOwner = platform.createWorkspace(user.id, 'Member-owned workspace');
    platform.addMember(user.id, otherOwner.id, 'admin', 'member');
    assert.equal(platform.workspaceForUser(otherOwner.id, admin)!.role, 'owner');
    assert.equal(platform.listWorkspaces(admin).find((workspace) => workspace.id === otherOwner.id)!.role, 'owner');
    assert.equal(platform.renameWorkspace(admin, otherOwner.id, 'Platform admin manages all').name, 'Platform admin manages all');
    assert.throws(() => platform!.verifyCredentials(user.username, 'synthetic-admin-password'), /用户名或密码不正确/);
    const workspace = platform.createWorkspace(admin, 'Workspace B');
    assert.equal(platform.workspaceForUser(workspace.id, user.id), null);
    platform.addMember(admin, workspace.id, user.username, 'member');
    assert.deepEqual(platform.listWorkspaces(user.id), [
      { ...otherOwner, name: 'Platform admin manages all' }, { ...workspace, role: 'member' },
    ]);
    assert.throws(() => platform!.renameWorkspace(user.id, workspace.id, 'no'), /仅工作区所有者/);
    assert.throws(() => platform!.removeMember(admin, workspace.id, admin), /至少保留/);
    assert.throws(() => platform!.createUser(user.id, 'other', 'synthetic-other-password'), /仅平台管理员/);
    const token = platform.createSession(user.id).token;
    platform.onModuleDestroy(); platform = null;
    platform = new PlatformStore(configFor(directory, { password: 'different-bootstrap-password' }));
    assert.equal(platform.session(token)!.userId, user.id);
    assert.equal(platform.verifyCredentials('admin', 'synthetic-admin-password').id, admin);
    assert.throws(() => platform!.verifyCredentials('admin', 'different-bootstrap-password'));
    platform.changePassword(user.id, 'synthetic-member-password', 'new-synthetic-member-password');
    assert.equal(platform.session(token), null);
    assert.equal(platform.verifyCredentials(user.username, 'new-synthetic-member-password').id, user.id);
    assert.throws(() => platform!.verifyCredentials(user.username, 'synthetic-member-password'));
  } finally { platform?.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

test('initialized new workspaces never recreate missing databases and older catalogs discover existing workspace files', () => {
  const directory = temp(); const cfg = configFor(directory);
  const environment = hash(Buffer.from(JSON.stringify(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)))));
  let platform: PlatformStore | null = new PlatformStore(cfg);
  try {
    const workspace = platform.createWorkspace(platform.defaultAdminId, 'New data');
    const descriptor = platform.workspaceConfig(workspace.id);
    const file = join(descriptor.dataDir, 'live.sqlite');
    assert.equal(existsSync(file), false);
    const database = new DatabaseSync(file);
    database.exec('CREATE TABLE saved(value TEXT); INSERT INTO saved VALUES(\'new workspace data\')'); database.close();
    platform.markWorkspaceInitialized(workspace.id);
    platform.onModuleDestroy(); platform = null;
    platform = new PlatformStore(cfg);
    assert.equal(platform.workspaceConfig(workspace.id).legacy, false);
    rmSync(file);
    assert.throws(() => platform!.workspaceConfig(workspace.id), /不会自动创建空库/);
    assert.equal(existsSync(file), false);

    const older = platform.createWorkspace(platform.defaultAdminId, 'Old catalog workspace');
    const oldFile = join(platform.workspaceConfig(older.id).dataDir, 'live.sqlite');
    const oldDatabase = new DatabaseSync(oldFile);
    oldDatabase.exec('CREATE TABLE saved(value TEXT); INSERT INTO saved VALUES(\'existing workspace data\')'); oldDatabase.close();
    platform.onModuleDestroy(); platform = null;
    const catalog = new DatabaseSync(join(directory, 'platform-live.sqlite'));
    catalog.exec('ALTER TABLE workspaces DROP COLUMN database_initialized'); catalog.close();
    platform = new PlatformStore(cfg);
    assert.equal(platform.workspaceConfig(older.id).dataDir, join(directory, 'workspaces', older.id));
    rmSync(oldFile);
    assert.throws(() => platform!.workspaceConfig(older.id), /不会自动创建空库/);
    assert.equal(existsSync(oldFile), false);
    assert.equal(hash(Buffer.from(JSON.stringify(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))))), environment);
  } finally { platform?.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

test('persisted OAuth states bind the initiating workspace, provider and session across workspace switches', () => {
  const directory = temp(); const cfg = configFor(directory); const platform = new PlatformStore(cfg); const context = new WorkspaceContext();
  const sessions = new SessionService(cfg, platform, context);
  let token = '';
  const res = { cookie: (_name: string, value: string) => { token = value; }, clearCookie: () => undefined } as unknown as Response;
  const request = (workspaceId: string, cookie = token, provider = 'zoho') => ({
    cookies: { zohome_session: cookie }, headers: { 'x-workspace-id': workspaceId }, ip: 'test', path: `/api/auth/${provider}/callback`,
  }) as unknown as Request;
  try {
    sessions.login(request(platform.defaultWorkspaceId), res, cfg.password, 'admin');
    const firstToken = token;
    const other = platform.createWorkspace(platform.defaultAdminId, 'Other');
    const state = context.run(() => {
      context.set({ workspaceId: platform.defaultWorkspaceId });
      return sessions.createState(request(platform.defaultWorkspaceId), 'zoho');
    });
    assert.equal(sessions.stateWorkspace(state, request(other.id)), platform.defaultWorkspaceId);
    assert.equal(sessions.stateWorkspace(state, request(other.id, firstToken, 'outlook')), null);
    context.run(() => {
      context.set({ workspaceId: other.id });
      assert.equal(sessions.consumeState(state, request(other.id)), true);
      assert.equal(context.current()!.workspaceId, platform.defaultWorkspaceId);
      assert.equal(sessions.consumeState(state, request(other.id)), false);
    });
    const second = sessions.createState(request(other.id), 'zoho');
    sessions.login(request(other.id, ''), res, cfg.password, 'admin');
    assert.notEqual(token, firstToken);
    assert.equal(sessions.consumeState(second, request(other.id)), false);
    assert.equal(sessions.consumeState(second, request(other.id, firstToken)), false);
    const logout = sessions.createState(request(other.id), 'zoho');
    sessions.logout(request(other.id), res);
    assert.equal(sessions.stateWorkspace(logout, request(other.id)), null);
  } finally { platform.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); }
});

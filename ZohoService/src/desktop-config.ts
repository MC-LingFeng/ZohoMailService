import { mkdirSync, readFileSync, writeFileSync, chmodSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parse } from 'dotenv';

export interface DesktopConfiguration {
  home: string;
  configPath: string;
  env: Record<string, string>;
}

export function desktopHome(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
) {
  if (env.ZOHOME_HOME) return resolve(env.ZOHOME_HOME);
  if (platform === 'win32')
    return join(
      env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
      'ZoHome',
    );
  if (platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'ZoHome');
  return join(
    env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
    'ZoHome',
  );
}

function appendOptionalConfiguration(configPath: string, source: string, saved: Record<string, string>) {
  const optional: Record<string, string> = {
    ADS_MANAGER_ACCOUNT: '',
    ADS_CREDENTIALS_FILE: './credentials.json',
    ADS_API_VERSION: 'v26',
    OUTLOOK_TENANT: 'common',
  };
  const missing = Object.entries(optional).filter(([key]) => !Object.hasOwn(saved, key));
  if (!missing.length) return;
  const newline = source.match(/\r\n|\n|\r/)?.[0] || '\n';
  const suffix = [
    source.endsWith('\n') || source.endsWith('\r') ? '' : newline,
    '# 新增可选配置：Google Ads 与 Outlook', newline,
    ...missing.flatMap(([key, value]) => [`${key}=${value}`, newline]),
  ].join('');
  // Append without rewriting existing values, comments, or line endings.
  // Recheck the source to avoid replacing edits made while startup validated it.
  const fd = openSync(configPath, 'a+');
  try {
    if (readFileSync(fd, 'utf8') !== source)
      throw new Error('桌面配置文件已被修改，请重新启动 ZoHome');
    writeFileSync(fd, suffix, 'utf8');
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

export function loadDesktopConfiguration(
  home = desktopHome(),
): DesktopConfiguration {
  home = resolve(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const configPath = join(home, 'zohome.env');
  // Exclusive creation protects a stable encryption key when the executable is double-clicked twice.
  try {
    writeFileSync(
      configPath,
      [
        '# ZoHome 桌面配置，保存后重启生效。',
        '# 运行模式（demo 演示，live 真实邮箱）',
        'APP_MODE=demo',
        '# 监听地址',
        'HOST=127.0.0.1',
        '# 服务端口',
        'PORT=3001',
        '# 工作区密码（至少 12 个字符）',
        `APP_PASSWORD=${randomBytes(24).toString('base64url')}`,
        '# 令牌加密密钥（修改后旧授权失效）',
        `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
        '# 数据目录',
        'DATA_DIR=./data',
        '# 接口请求间隔（毫秒，至少 2100）',
        'ZOHO_MIN_REQUEST_INTERVAL_MS=2100',
        '',
        '# Google Ads（可选，手动刷新 Offer 的美元累计成本）',
        'ADS_MANAGER_ACCOUNT=',
        '# 相对路径以此配置文件所在目录为准',
        'ADS_CREDENTIALS_FILE=./credentials.json',
        'ADS_API_VERSION=v26',
        '',
        '# 网页地址（可选，默认本机服务端口）',
        '# FRONTEND_URL=http://localhost:3001',
        '# 授权回调地址（可选）',
        '# ZOHO_REDIRECT_URI=http://localhost:3001/api/auth/zoho/callback',
        '# Outlook 回调地址（可选，默认本机服务端口）',
        '# OUTLOOK_REDIRECT_URI=http://localhost:3001/api/auth/outlook/callback',
        '# Microsoft 账户范围（common 兼容个人和企业邮箱）',
        'OUTLOOK_TENANT=common',
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (error as NodeJS.ErrnoException).code !== 'EEXIST'
    )
      throw error;
  }
  const source = readFileSync(configPath, 'utf8');
  const saved = parse(source);
  if (
    !saved.APP_PASSWORD ||
    saved.APP_PASSWORD.length < 12 ||
    !/^[a-f\d]{64}$/i.test(saved.TOKEN_ENCRYPTION_KEY || '')
  ) {
    throw new Error(
      `ZoHome 配置中的管理密码或加密密钥无效，请检查 ${configPath}；已有密钥不会自动重置`,
    );
  }
  const mode = saved.APP_MODE || 'demo';
  if (!['demo', 'live'].includes(mode))
    throw new Error(`APP_MODE 需要为 demo 或 live，请检查 ${configPath}`);
  const port = Number(saved.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`PORT 无效，请检查 ${configPath}`);
  const frontend = new URL(saved.FRONTEND_URL || `http://localhost:${port}`);
  if (
    frontend.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(frontend.hostname) ||
    Number(frontend.port || 80) !== port ||
    frontend.pathname !== '/' ||
    frontend.search ||
    frontend.hash ||
    frontend.username ||
    frontend.password
  ) {
    throw new Error(
      `桌面版 FRONTEND_URL 必须为本机同端口地址 http://localhost:${port}，请检查 ${configPath}`,
    );
  }
  const callback = new URL(
    saved.ZOHO_REDIRECT_URI || `${frontend.origin}/api/auth/zoho/callback`,
  );
  if (
    callback.origin !== frontend.origin ||
    callback.pathname !== '/api/auth/zoho/callback' ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  ) {
    throw new Error(
      `桌面版 ZOHO_REDIRECT_URI 必须为 ${frontend.origin}/api/auth/zoho/callback，请检查 ${configPath}`,
    );
  }
  const dataDir = saved.DATA_DIR
    ? isAbsolute(saved.DATA_DIR)
      ? saved.DATA_DIR
      : resolve(home, saved.DATA_DIR)
    : join(home, 'data');
  const outlookCallback = new URL(saved.OUTLOOK_REDIRECT_URI || `${frontend.origin}/api/auth/outlook/callback`);
  if (outlookCallback.origin !== frontend.origin || outlookCallback.pathname !== '/api/auth/outlook/callback' ||
      outlookCallback.search || outlookCallback.hash || outlookCallback.username || outlookCallback.password)
    throw new Error(`桌面版 OUTLOOK_REDIRECT_URI 必须为 ${frontend.origin}/api/auth/outlook/callback，请检查 ${configPath}`);
  // Upgrade only after the old configuration passes validation; never reset an existing key.
  if (process.platform !== 'win32') chmodSync(configPath, 0o600);
  appendOptionalConfiguration(configPath, source, saved);
  return {
    home,
    configPath,
    env: {
      APP_MODE: mode,
      HOST: '127.0.0.1',
      PORT: String(port),
      FRONTEND_URL: frontend.origin,
      ZOHO_REDIRECT_URI: callback.toString(),
      OUTLOOK_REDIRECT_URI: outlookCallback.toString(),
      OUTLOOK_TENANT: saved.OUTLOOK_TENANT || 'common',
      DATA_DIR: dataDir,
      APP_PASSWORD: saved.APP_PASSWORD,
      TOKEN_ENCRYPTION_KEY: saved.TOKEN_ENCRYPTION_KEY,
      ZOHO_MIN_REQUEST_INTERVAL_MS:
        saved.ZOHO_MIN_REQUEST_INTERVAL_MS || '2100',
      ADS_MANAGER_ACCOUNT: saved.ADS_MANAGER_ACCOUNT || '',
      ADS_CREDENTIALS_FILE: resolve(home, saved.ADS_CREDENTIALS_FILE || 'credentials.json'),
      ADS_API_VERSION: saved.ADS_API_VERSION || 'v26',
      // Desktop mailbox credentials live in the database, never inherited from a developer's environment.
      ZOHO_CLIENT_ID: '',
      ZOHO_CLIENT_SECRET: '',
    },
  };
}

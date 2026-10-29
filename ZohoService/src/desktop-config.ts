import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
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
        '# ZoHome desktop configuration. Close the application before editing this file.',
        '# APP_MODE=live enables real mailboxes. APP_PASSWORD is the ZoHome console password.',
        '# Keep TOKEN_ENCRYPTION_KEY unchanged; back up this file together with data/.',
        'APP_MODE=demo',
        'HOST=127.0.0.1',
        'PORT=3001',
        `APP_PASSWORD=${randomBytes(24).toString('base64url')}`,
        `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
        'DATA_DIR=./data',
        'ZOHO_MIN_REQUEST_INTERVAL_MS=2100',
        '# Browser URL and OAuth callback default to http://localhost:<PORT> and /api/auth/zoho/callback.',
        '# Optional: FRONTEND_URL=http://localhost:3001',
        '# Optional: ZOHO_REDIRECT_URI=http://localhost:3001/api/auth/zoho/callback',
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
  if (process.platform !== 'win32') chmodSync(configPath, 0o600);
  const saved = parse(readFileSync(configPath));
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
  return {
    home,
    configPath,
    env: {
      APP_MODE: mode,
      HOST: '127.0.0.1',
      PORT: String(port),
      FRONTEND_URL: frontend.origin,
      ZOHO_REDIRECT_URI: callback.toString(),
      DATA_DIR: dataDir,
      APP_PASSWORD: saved.APP_PASSWORD,
      TOKEN_ENCRYPTION_KEY: saved.TOKEN_ENCRYPTION_KEY,
      ZOHO_MIN_REQUEST_INTERVAL_MS:
        saved.ZOHO_MIN_REQUEST_INTERVAL_MS || '2100',
      // Desktop mailbox credentials live in the database, never inherited from a developer's environment.
      ZOHO_CLIENT_ID: '',
      ZOHO_CLIENT_SECRET: '',
    },
  };
}

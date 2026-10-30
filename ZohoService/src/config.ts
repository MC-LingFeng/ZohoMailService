import { Injectable } from '@nestjs/common';
import { resolve } from 'node:path';
import { environmentOverrideKeys, runtimeEnvironmentFile } from './runtime-env';

@Injectable()
export class AppConfig {
  readonly envFile = runtimeEnvironmentFile() || resolve(process.env.DOTENV_CONFIG_PATH || '.env');
  readonly environmentOverrides = environmentOverrideKeys();
  readonly environmentValues: ReadonlyMap<string, string> = new Map(
    [...this.environmentOverrides].flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!] as const]),
  );
  readonly mode = process.env.APP_MODE || 'demo';
  readonly port = Number(process.env.PORT || 3001);
  readonly host = process.env.HOST || '127.0.0.1';
  readonly frontendUrl =
    process.env.FRONTEND_URL ||
    (process.env.WEB_ROOT
      ? `http://localhost:${this.port}`
      : 'http://localhost:5173');
  readonly redirectUri =
    process.env.ZOHO_REDIRECT_URI ||
    `${this.frontendUrl.replace(/\/$/, '')}/api/auth/zoho/callback`;
  readonly clientId = process.env.ZOHO_CLIENT_ID || '';
  readonly clientSecret = process.env.ZOHO_CLIENT_SECRET || '';
  readonly password = process.env.APP_PASSWORD || '';
  readonly encryptionKey = process.env.TOKEN_ENCRYPTION_KEY || '';
  readonly dataDir = resolve(process.env.DATA_DIR || './data');
  readonly minInterval = Math.max(
    2100,
    Number(process.env.ZOHO_MIN_REQUEST_INTERVAL_MS || 2100) || 2100,
  );
  readonly accountsBase = 'https://accounts.zoho.com';
  readonly mailBase = 'https://mail.zoho.com';
  readonly scopes =
    'ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE';

  constructor() {
    if (!['demo', 'live'].includes(this.mode))
      throw new Error('APP_MODE must be demo or live');
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535)
      throw new Error('Invalid PORT');
    const frontend = new URL(this.frontendUrl);
    const redirect = new URL(this.redirectUri);
    if (
      !['http:', 'https:'].includes(frontend.protocol) ||
      !['http:', 'https:'].includes(redirect.protocol)
    ) {
      throw new Error(
        'FRONTEND_URL and ZOHO_REDIRECT_URI must use http or https',
      );
    }
    if (
      this.live &&
      (this.password.length < 12 || !/^[a-f\d]{64}$/i.test(this.encryptionKey))
    ) {
      throw new Error(
        'Live mode requires APP_PASSWORD (at least 12 characters) and TOKEN_ENCRYPTION_KEY (64 hex characters)',
      );
    }
  }
  get live() {
    return this.mode === 'live';
  }
  get oauthConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }
  get secureCookies() {
    return new URL(this.frontendUrl).protocol === 'https:';
  }
}

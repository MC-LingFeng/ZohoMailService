import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfig } from './config';
import { MailStore } from './store';
import { decryptToken, encryptToken } from './security';
import { OAuthCredentials, StoredAccount } from './types';
import { createHash } from 'node:crypto';

type ZohoData = Record<string, unknown>;

@Injectable()
export class ZohoClient {
  private readonly tokens = new Map<
    string,
    { value: string; expires: number; fingerprint: string }
  >();
  private readonly renewing = new Map<string, Promise<string>>();
  private tail: Promise<unknown> = Promise.resolve();
  private lastCall = 0;
  private blockedUntil = 0;
  private waiting = 0;
  constructor(
    private readonly config: AppConfig,
    private readonly store: MailStore,
  ) {}

  async exchangeCode(code: string, credentials: OAuthCredentials) {
    return this.tokenRequest(
      {
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.config.redirectUri,
      },
      credentials,
    );
  }
  credentialsFor(account: StoredAccount): OAuthCredentials {
    if (account.clientId || account.encryptedClientSecret) {
      if (!account.clientId || !account.encryptedClientSecret)
        throw new BadRequestException(
          '该邮箱的 OAuth 配置不完整，请重新填写并绑定',
        );
      try {
        return {
          clientId: account.clientId,
          clientSecret: decryptToken(
            account.encryptedClientSecret,
            this.config.encryptionKey,
          ),
        };
      } catch {
        throw new ServiceUnavailableException(
          '无法解密邮箱客户端配置，请检查服务端加密密钥',
        );
      }
    }
    if (this.config.oauthConfigured)
      return {
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      };
    throw new BadRequestException(
      '该邮箱尚未保存 OAuth 配置，请重新填写 Client ID 和 Client Secret 绑定',
    );
  }
  async initialAccounts(token: string) {
    return this.mailRequest('/api/accounts', token) as Promise<ZohoData[]>;
  }
  async request(
    account: StoredAccount,
    path: string,
    options: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number>;
    } = {},
  ): Promise<unknown> {
    if (!this.config.live)
      throw new BadRequestException('演示模式不会访问 Zoho');
    try {
      const token = await this.accessToken(account);
      try {
        return await this.mailRequest(path, token, options);
      } catch (error) {
        // Only retry a read after an explicit authorization failure. Never retry a send.
        if (
          error instanceof UnauthorizedException &&
          (!options.method || options.method === 'GET')
        ) {
          this.tokens.delete(account.id);
          const renewed = await this.accessToken(account);
          return await this.mailRequest(path, renewed, options);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        const latest = this.store.account(account.id);
        if (latest && this.fingerprint(latest) === this.fingerprint(account))
          this.store.saveAccount({ ...latest, status: 'reauthorize' });
        // A Zoho credential failure must not be mistaken for an expired ZoHome app session.
        throw new BadRequestException(
          '该邮箱授权已失效，请在账号管理中重新连接',
        );
      }
      throw error;
    }
  }
  forget(accountId: string) {
    this.tokens.delete(accountId);
  }

  private async accessToken(account: StoredAccount): Promise<string> {
    const fingerprint = this.fingerprint(account);
    const cached = this.tokens.get(account.id);
    if (
      cached &&
      cached.fingerprint === fingerprint &&
      cached.expires > Date.now() + 60_000
    )
      return cached.value;
    const renewalKey = `${account.id}:${fingerprint}`;
    const pending = this.renewing.get(renewalKey);
    if (pending) return pending;
    const promise = this.renew(account, fingerprint);
    this.renewing.set(renewalKey, promise);
    try {
      return await promise;
    } finally {
      this.renewing.delete(renewalKey);
    }
  }
  private async renew(account: StoredAccount, fingerprint: string) {
    if (!account.encryptedRefreshToken)
      throw new UnauthorizedException('该邮箱需要重新授权');
    let refresh: string;
    try {
      refresh = decryptToken(
        account.encryptedRefreshToken,
        this.config.encryptionKey,
      );
    } catch {
      throw new ServiceUnavailableException(
        '无法解密邮箱授权，请检查服务端加密密钥',
      );
    }
    const credentials = this.credentialsFor(account);
    try {
      const data = await this.tokenRequest(
        {
          refresh_token: refresh,
          grant_type: 'refresh_token',
        },
        credentials,
      );
      const value = String(data.access_token);
      this.tokens.set(account.id, {
        value,
        expires: Date.now() + Number(data.expires_in || 3600) * 1000,
        fingerprint,
      });
      const current = this.store.account(account.id);
      if (
        current &&
        this.fingerprint(current) === fingerprint &&
        (!current.clientId ||
          !current.encryptedClientSecret ||
          current.status !== 'connected')
      )
        this.store.saveAccount({
          ...current,
          status: 'connected',
          clientId: credentials.clientId,
          encryptedClientSecret:
            current.encryptedClientSecret ||
            encryptToken(credentials.clientSecret, this.config.encryptionKey),
        });
      return value;
    } catch (error) {
      const latest = this.store.account(account.id);
      if (
        error instanceof UnauthorizedException &&
        latest &&
        this.fingerprint(latest) === fingerprint
      )
        this.store.saveAccount({ ...latest, status: 'reauthorize' });
      throw error;
    }
  }
  private fingerprint(account: StoredAccount) {
    return createHash('sha256')
      .update(
        `${account.clientId || this.config.clientId}\0${account.encryptedClientSecret || this.config.clientSecret}\0${account.encryptedRefreshToken || ''}`,
      )
      .digest('hex');
  }
  private async tokenRequest(
    parameters: Record<string, string>,
    credentials: OAuthCredentials,
  ): Promise<ZohoData> {
    if (!this.config.live || !credentials.clientId || !credentials.clientSecret)
      throw new BadRequestException('请填写完整的 Zoho OAuth 客户端配置');
    const body = new URLSearchParams({
      ...parameters,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
    let response: globalThis.Response;
    try {
      response = await fetch(`${this.config.accountsBase}/oauth/v2/token`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(25_000),
        redirect: 'error',
      });
    } catch {
      throw new BadGatewayException('无法连接 Zoho 授权服务，请稍后重试');
    }
    let data: ZohoData;
    try {
      data = (await response.json()) as ZohoData;
    } catch {
      throw new BadGatewayException('Zoho 授权服务返回了无效响应');
    }
    if (!response.ok || !data.access_token) {
      if (
        data.error === 'invalid_code' ||
        data.error === 'invalid_grant' ||
        data.error === 'invalid_token'
      )
        throw new UnauthorizedException('邮箱授权已失效，请重新连接');
      throw new BadGatewayException(
        'Zoho 授权失败，请检查客户端配置或稍后重试',
      );
    }
    return data;
  }
  private async mailRequest(
    path: string,
    token: string,
    options: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number>;
    } = {},
  ): Promise<unknown> {
    if (!path.startsWith('/api/') || path.includes('..'))
      throw new BadRequestException('无效的接口路径');
    return this.enqueue(async () => {
      const url = new URL(path, this.config.mailBase);
      for (const [key, value] of Object.entries(options.query || {}))
        url.searchParams.set(key, String(value));
      let response: globalThis.Response;
      try {
        response = await fetch(url, {
          method: options.method || 'GET',
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
          signal: AbortSignal.timeout(25_000),
          redirect: 'error',
        });
      } catch {
        throw new BadGatewayException(
          options.method === 'POST'
            ? '连接 Zoho 中断，发送结果未知；请先检查已发送邮件，避免重复发送'
            : '无法连接 Zoho 邮件服务，请稍后重试',
        );
      }
      let data: { status?: { code?: number }; data?: unknown };
      try {
        data = (await response.json()) as typeof data;
      } catch {
        throw new BadGatewayException('Zoho 邮件服务返回了无效响应');
      }
      const code = Number(data.status?.code || response.status);
      if (response.status === 429 || code === 429) {
        this.blockedUntil = Date.now() + 60_000;
        throw new ServiceUnavailableException(
          '已达到 Zoho 调用频率限制，请稍后重试',
        );
      }
      if (response.status === 401 || code === 401)
        throw new UnauthorizedException('Zoho 授权已失效，请重新连接邮箱');
      if (response.status === 403 || code === 403)
        throw new BadRequestException(
          '当前邮箱缺少该操作权限，请检查账号和 OAuth 授权',
        );
      if (!response.ok || code < 200 || code >= 300)
        throw new BadGatewayException(
          'Zoho 未能完成此操作，请检查邮箱状态后重试',
        );
      return data.data;
    });
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.waiting >= 100)
      return Promise.reject(
        new ServiceUnavailableException('请求正在排队，请稍后重试'),
      );
    this.waiting++;
    const next = this.tail.then(async () => {
      if (this.blockedUntil > Date.now())
        throw new ServiceUnavailableException('Zoho 接口暂时限流，请稍后重试');
      const delay = this.lastCall + this.config.minInterval - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      this.lastCall = Date.now();
      return task();
    });
    this.tail = next.catch(() => undefined);
    return next.finally(() => {
      this.waiting--;
    });
  }
}

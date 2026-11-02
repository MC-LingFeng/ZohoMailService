import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfig } from './config';
import { decryptToken, encryptToken } from './security';
import { MailStore } from './store';
import { OAuthCredentials, StoredAccount } from './types';

interface MicrosoftToken {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

interface CachedToken {
  value: string;
  expires: number;
  fingerprint: string;
}

interface GraphOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number>;
  body?: unknown;
}

interface RequestQueue {
  tail: Promise<unknown>;
  lastCall: number;
  blockedUntil: number;
  waiting: number;
}

const graphOrigin = 'https://graph.microsoft.com';
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

@Injectable()
export class OutlookClient {
  private readonly tokens = new Map<string, CachedToken>();
  private readonly renewing = new Map<string, Promise<CachedToken>>();
  private readonly queues = new Map<string, RequestQueue>();

  constructor(private readonly config: AppConfig, private readonly store: MailStore) {}

  exchangeCode(code: string, credentials: OAuthCredentials, redirectUri: string, verifier: string) {
    return this.tokenRequest({
      grant_type: 'authorization_code', code,
      redirect_uri: redirectUri, code_verifier: verifier,
    }, credentials);
  }

  credentialsFor(account: StoredAccount): OAuthCredentials {
    if (!account.clientId || !account.encryptedClientSecret)
      throw new BadRequestException('该 Outlook 邮箱尚未配置完整的应用凭据，请重新填写并绑定');
    try {
      return {
        clientId: account.clientId,
        clientSecret: decryptToken(account.encryptedClientSecret, this.config.encryptionKey),
      };
    } catch {
      throw new ServiceUnavailableException('无法解密 Outlook 应用配置，请检查服务端加密密钥');
    }
  }

  async profile(accessToken: string): Promise<{ id: string; email: string; displayName?: string }> {
    const queue = `profile:${createHash('sha256').update(accessToken).digest('hex')}`;
    try {
      const data = await this.graphRequest('/me', accessToken, queue, {
        query: { $select: 'id,mail,userPrincipalName,displayName' },
      });
      const user = data as Record<string, unknown> | null;
      const email = user?.mail || user?.userPrincipalName;
      if (!user || typeof user.id !== 'string' || !user.id ||
          typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new BadGatewayException('Microsoft 返回的邮箱资料不完整，无法绑定此账号');
      // An Entra user may have a profile without an Exchange/Outlook mailbox.
      const inbox = await this.graphRequest('/me/mailFolders/inbox', accessToken, queue, {
        query: { $select: 'id' },
      }) as Record<string, unknown> | null;
      if (!inbox || typeof inbox.id !== 'string' || !inbox.id)
        throw new BadGatewayException('该 Microsoft 账号未返回有效的 Outlook 邮箱');
      return {
        id: user.id,
        email: email.trim().toLowerCase(),
        ...(typeof user.displayName === 'string' ? { displayName: user.displayName } : {}),
      };
    } finally {
      this.queues.delete(queue);
    }
  }

  async request(account: StoredAccount, path: string, options: GraphOptions = {}): Promise<unknown> {
    if (!this.config.live) throw new BadRequestException('演示模式不会访问 Outlook');
    // Validate before acquiring or sending any token, including server-supplied nextLink cursors.
    this.graphUrl(path, options.query);
    const latest = this.store.account(account.id);
    if (!latest) throw new BadRequestException('该邮箱已断开连接，请重新加载账号列表');
    let issued: CachedToken | undefined;
    try {
      issued = await this.accessToken(latest);
      try {
        return await this.graphRequest(path, issued.value, account.id, options);
      } catch (error) {
        if (!(error instanceof UnauthorizedException) || (options.method && options.method !== 'GET')) throw error;
        if (this.tokens.get(account.id)?.value === issued.value) this.tokens.delete(account.id);
        const current = this.store.account(account.id);
        if (!current) throw new BadRequestException('该邮箱已断开连接，请重新加载账号列表');
        issued = await this.accessToken(current);
        return await this.graphRequest(path, issued.value, account.id, options);
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.markReauthorize(account.id, issued?.fingerprint || this.fingerprint(latest));
        // Provider authorization failures must not log the user out of the workspace.
        throw new BadRequestException('该 Outlook 邮箱授权已失效，请在账号管理中重新连接');
      }
      throw error;
    }
  }

  forget(accountId: string) {
    this.tokens.delete(accountId);
    const queue = this.queues.get(accountId);
    if (!queue?.waiting) this.queues.delete(accountId);
  }

  private fingerprint(account: StoredAccount) {
    return createHash('sha256').update(
      `${account.clientId || ''}\0${account.encryptedClientSecret || ''}\0${account.encryptedRefreshToken || ''}`,
    ).digest('hex');
  }

  private markReauthorize(id: string, fingerprint: string) {
    const latest = this.store.account(id);
    if (latest && this.fingerprint(latest) === fingerprint)
      this.store.saveAccount({ ...latest, status: 'reauthorize' });
  }

  private async accessToken(account: StoredAccount): Promise<CachedToken> {
    const fingerprint = this.fingerprint(account);
    const cached = this.tokens.get(account.id);
    if (cached?.fingerprint === fingerprint && cached.expires > Date.now() + 60_000) return cached;
    const renewalKey = `${account.id}:${fingerprint}`;
    const pending = this.renewing.get(renewalKey);
    if (pending) return pending;
    const promise = this.renew(account, fingerprint);
    this.renewing.set(renewalKey, promise);
    try { return await promise; }
    finally { this.renewing.delete(renewalKey); }
  }

  private async renew(account: StoredAccount, fingerprint: string): Promise<CachedToken> {
    if (!account.encryptedRefreshToken) throw new UnauthorizedException('该 Outlook 邮箱需要重新授权');
    let refresh: string;
    try { refresh = decryptToken(account.encryptedRefreshToken, this.config.encryptionKey); }
    catch { throw new ServiceUnavailableException('无法解密 Outlook 邮箱授权，请检查服务端加密密钥'); }
    try {
      const data = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh }, this.credentialsFor(account));
      const latest = this.store.account(account.id);
      if (!latest || this.fingerprint(latest) !== fingerprint)
        throw new BadRequestException('邮箱授权已更新或已断开连接，请重新操作');
      const updated = {
        ...latest,
        status: 'connected' as const,
        encryptedRefreshToken: data.refresh_token
          ? encryptToken(data.refresh_token, this.config.encryptionKey)
          : latest.encryptedRefreshToken,
      };
      // Refresh tokens can rotate. Preserve current name/group and store the replacement atomically.
      this.store.saveAccount(updated);
      const token = {
        value: data.access_token,
        expires: Date.now() + data.expires_in * 1000,
        fingerprint: this.fingerprint(updated),
      };
      this.tokens.set(account.id, token);
      return token;
    } catch (error) {
      if (error instanceof UnauthorizedException) this.markReauthorize(account.id, fingerprint);
      throw error;
    }
  }

  private async tokenRequest(parameters: Record<string, string>, credentials: OAuthCredentials): Promise<MicrosoftToken> {
    if (!this.config.live || !credentials.clientId || !credentials.clientSecret)
      throw new BadRequestException('请填写完整的 Microsoft OAuth 应用配置');
    if (!/^[a-z\d.-]+$/i.test(this.config.outlookTenant))
      throw new BadRequestException('OUTLOOK_TENANT 格式无效');
    let response: Response;
    let data: Record<string, unknown>;
    try {
      response = await fetch(`https://login.microsoftonline.com/${this.config.outlookTenant}/oauth2/v2.0/token`, {
        method: 'POST',
        body: new URLSearchParams({
          ...parameters,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          scope: this.config.outlookScopes,
        }),
        signal: AbortSignal.timeout(25_000),
        redirect: 'error',
      });
      data = await response.json() as Record<string, unknown>;
    } catch {
      throw new BadGatewayException('无法连接 Microsoft 授权服务或响应无效，请稍后重试');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new BadGatewayException('Microsoft 授权服务返回了无效响应');
    if (!response.ok || data.error) {
      if (data.error === 'invalid_grant' || data.error === 'interaction_required' || data.error === 'consent_required')
        throw new UnauthorizedException('Microsoft 邮箱授权已失效，请重新连接');
      throw new BadGatewayException('Microsoft 授权失败，请检查应用配置、租户及用户授权');
    }
    const expires = Number(data.expires_in);
    if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(expires) || expires <= 0 ||
        (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token)))
      throw new BadGatewayException('Microsoft 授权服务返回了无效的令牌');
    return { access_token: data.access_token, expires_in: expires,
      ...(typeof data.refresh_token === 'string' ? { refresh_token: data.refresh_token } : {}) };
  }

  private graphUrl(path: string, query?: Record<string, string | number>) {
    let url: URL;
    try {
      url = new URL(path.startsWith('/me') ? `/v1.0${path}` : path, graphOrigin);
      const decoded = decodeURIComponent(url.pathname);
      if (url.origin !== graphOrigin || url.username || url.password || url.hash ||
          (url.pathname !== '/v1.0/me' && !url.pathname.startsWith('/v1.0/me/')) ||
          decoded.includes('..') || decoded.includes('\\')) throw new Error();
    } catch { throw new BadRequestException('无效的 Outlook 接口路径或分页地址'); }
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
    return url;
  }

  private async graphRequest(path: string, token: string, queueId: string, options: GraphOptions = {}) {
    const url = this.graphUrl(path, options.query);
    const method = options.method || 'GET';
    if (method !== 'GET' && method !== 'POST') throw new BadRequestException('不支持的 Outlook 请求方法');
    return this.enqueue(queueId, async (queue) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        let response: Response;
        try {
          response = await fetch(url, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
            signal: AbortSignal.timeout(25_000), redirect: 'error',
          });
        } catch {
          throw new BadGatewayException(method === 'POST'
            ? '连接 Outlook 中断，发送结果未知；请先检查已发送邮件，避免重复发送'
            : '无法连接 Outlook 邮件服务，请稍后重试');
        }
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const seconds = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : NaN;
          const date = retryAfter ? Date.parse(retryAfter) : NaN;
          const delay = Number.isFinite(seconds) ? seconds * 1000
            : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1000;
          queue.blockedUntil = Date.now() + delay;
          if (method === 'GET' && attempt === 0 && delay <= 30_000) {
            await sleep(delay);
            continue;
          }
          throw new ServiceUnavailableException('Outlook 接口暂时限流，请稍后重试');
        }
        if (response.status === 401) throw new UnauthorizedException('Outlook 邮箱授权已失效');
        if (response.status === 403)
          throw new BadRequestException('该 Outlook 邮箱缺少读取或发信权限，请检查应用权限及管理员授权');
        if (!response.ok)
          throw new BadGatewayException('Outlook 未能完成此操作，请检查邮箱是否可用及 Microsoft 365 邮箱许可');
        if (response.status === 202 || response.status === 204) return null;
        try {
          const data: unknown = await response.json();
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
          return data;
        } catch { throw new BadGatewayException('Outlook 邮件服务返回了无效响应'); }
      }
      throw new ServiceUnavailableException('Outlook 接口暂时限流，请稍后重试');
    });
  }

  private enqueue<T>(id: string, task: (queue: RequestQueue) => Promise<T>): Promise<T> {
    let queue = this.queues.get(id);
    if (!queue) {
      queue = { tail: Promise.resolve(), lastCall: 0, blockedUntil: 0, waiting: 0 };
      this.queues.set(id, queue);
    }
    if (queue.waiting >= 100) return Promise.reject(new ServiceUnavailableException('Outlook 请求正在排队，请稍后重试'));
    const state = queue;
    state.waiting++;
    const next = state.tail.then(async () => {
      if (state.blockedUntil > Date.now()) throw new ServiceUnavailableException('Outlook 接口暂时限流，请稍后重试');
      const delay = state.lastCall + 200 - Date.now();
      if (delay > 0) await sleep(delay);
      state.lastCall = Date.now();
      return task(state);
    });
    state.tail = next.catch(() => undefined);
    return next.finally(() => { state.waiting--; });
  }
}

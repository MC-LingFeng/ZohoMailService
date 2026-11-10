import {
  CanActivate,
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { AppConfig } from './config';
import { PlatformStore, UserSummary } from './platform-store';
import { WorkspaceContext } from './workspace-context';

const COOKIE = 'zohome_session';
const SESSION_LIFETIME = 12 * 60 * 60 * 1000;

export function encryptToken(value: string, keyHex: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64url'))
    .join('.');
}
export function decryptToken(value: string, keyHex: string) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted credential');
  const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}

@Injectable()
export class SessionService {
  // The memory adapter keeps direct unit-test construction isolated. The app
  // always injects PlatformStore and persists sessions in its catalog.
  private readonly sessions = new Map<string, number>();
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();
  private readonly states = new Map<
    string,
    { session: string; workspaceId: string; provider: string; expiresAt: number }
  >();
  constructor(
    private readonly config: AppConfig,
    @Optional() private readonly platform?: PlatformStore,
    @Optional() private readonly context?: WorkspaceContext,
  ) {}
  authenticated(req: Request) {
    return !this.config.live || Boolean(this.sessionId(req));
  }
  sessionId(req: Request) {
    const token = req.cookies?.[COOKIE];
    if (this.platform) return typeof token === 'string' && this.platform.session(token) ? token : null;
    const expires =
      typeof token === 'string' ? this.sessions.get(token) : undefined;
    if (expires && expires > Date.now()) return token as string;
    if (token) this.sessions.delete(token);
    return null;
  }
  user(req: Request): UserSummary | null {
    const token = this.sessionId(req);
    if (this.platform) {
      const session = token ? this.platform.session(token) : null;
      return session ? this.platform.userById(session.userId) : !this.config.live ? this.platform.userById(this.platform.defaultAdminId) : null;
    }
    return token || !this.config.live ? { id: 'legacy-admin', username: 'admin', isPlatformAdmin: true } : null;
  }
  workspaceId(req: Request) {
    const current = this.context?.current()?.workspaceId;
    if (current) return current;
    if (!this.platform) return 'legacy';
    const user = this.user(req);
    if (!user) return null;
    const header = req.headers?.['x-workspace-id'];
    const id = typeof header === 'string' ? header : this.platform.defaultWorkspaceId;
    return this.platform.workspaceForUser(id, user.id)?.id || null;
  }
  login(req: Request, res: Response, password: string, username = 'admin') {
    username = username.trim();
    this.cleanup();
    const accountKey = `account:${req.ip || 'local'}:${username.toLowerCase()}`;
    const ipKey = `ip:${req.ip || 'local'}`;
    const attempt = this.attempts.get(accountKey);
    const ipAttempt = this.attempts.get(ipKey);
    if ((attempt && attempt.until > Date.now() && attempt.count >= 10) ||
      (ipAttempt && ipAttempt.until > Date.now() && ipAttempt.count >= 50)) {
      throw new ForbiddenException('尝试次数过多，请 15 分钟后重试');
    }
    let user: UserSummary | null = null;
    let valid = true;
    if (this.platform) {
      try { user = this.platform.verifyCredentials(username, password); }
      catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
        valid = false;
      }
    } else {
      const supplied = createHash('sha256').update(password).digest();
      const expected = createHash('sha256').update(this.config.password).digest();
      valid = !this.config.live || (username.toLowerCase() === 'admin' && timingSafeEqual(supplied, expected));
    }
    if (!valid) {
      for (const [key, previous] of [[accountKey, attempt], [ipKey, ipAttempt]] as const) {
        const active = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 15 * 60_000 };
        this.attempts.set(key, { ...active, count: active.count + 1 });
      }
      throw new UnauthorizedException('用户名或密码不正确');
    }
    this.attempts.delete(accountKey);
    this.cleanup();
    const previous = this.sessionId(req);
    if (previous) {
      if (this.platform) this.platform.revokeSession(previous);
      else this.sessions.delete(previous);
    }
    const token = this.platform && user ? this.platform.createSession(user.id).token : randomBytes(32).toString('base64url');
    if (!this.platform) this.sessions.set(token, Date.now() + SESSION_LIFETIME);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.secureCookies,
      maxAge: SESSION_LIFETIME,
      path: '/api',
    });
    return { success: true, ...(user ? { user } : {}) };
  }
  logout(req: Request, res: Response) {
    const token = this.sessionId(req);
    if (token) {
      if (this.platform) this.platform.revokeSession(token);
      else this.sessions.delete(token);
    }
    res.clearCookie(COOKIE, {
      path: '/api',
      sameSite: 'lax',
      secure: this.config.secureCookies,
    });
    return { success: true };
  }
  createState(req: Request, provider = '') {
    this.cleanup();
    const session = this.sessionId(req);
    if (!session) throw new UnauthorizedException('请先登录管理系统');
    const workspaceId = this.workspaceId(req);
    if (!workspaceId) throw new UnauthorizedException('请先选择有权访问的工作区');
    if (this.platform) {
      const user = this.user(req);
      if (!user) throw new UnauthorizedException('请先登录管理系统');
      return this.platform.createState(session, user.id, workspaceId, provider);
    }
    const state = randomBytes(32).toString('base64url');
    this.states.set(state, { session, workspaceId, provider, expiresAt: Date.now() + 10 * 60_000 });
    return state;
  }
  stateWorkspace(state: string, req: Request) {
    if (typeof state !== 'string' || !state) return null;
    const session = this.sessionId(req);
    if (!session) return null;
    const expectedProvider = req.path?.includes('/outlook/') ? 'outlook' : req.path?.includes('/zoho/') ? 'zoho' : '';
    if (this.platform) {
      const record = this.platform.state(state);
      const authenticated = this.platform.session(session);
      if (!record || !authenticated || record.sessionId !== authenticated.id || record.userId !== authenticated.userId ||
        (record.provider && expectedProvider && record.provider !== expectedProvider) ||
        !this.platform.workspaceForUser(record.workspaceId, authenticated.userId)) return null;
      return record.workspaceId;
    }
    const record = this.states.get(state);
    return record && record.session === session && record.expiresAt > Date.now() && (!record.provider || !expectedProvider || record.provider === expectedProvider) ? record.workspaceId : null;
  }
  consumeState(state: string, req: Request) {
    const workspaceId = this.stateWorkspace(state, req);
    if (this.platform) {
      this.platform.consumeState(typeof state === 'string' ? state : '');
      if (!workspaceId) return false;
      const user = this.user(req)!;
      const workspace = this.platform.workspaceForUser(workspaceId, user.id)!;
      this.context?.set({ workspaceId, userId: user.id, role: workspace.role, isPlatformAdmin: user.isPlatformAdmin });
      return true;
    }
    const record = this.states.get(state);
    this.states.delete(state);
    return Boolean(
      workspaceId && record &&
        record.expiresAt > Date.now() &&
        record.session === this.sessionId(req),
    );
  }
  private cleanup() {
    const now = Date.now();
    for (const [key, expires] of this.sessions)
      if (expires < now) this.sessions.delete(key);
    for (const [key, record] of this.states)
      if (record.expiresAt < now) this.states.delete(key);
    for (const [key, record] of this.attempts)
      if (record.until < now) this.attempts.delete(key);
  }
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly platform: PlatformStore,
    private readonly context: WorkspaceContext,
  ) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    const allowed = new URL(this.config.frontendUrl).origin;
    const oauthCallback = req.path === '/api/auth/zoho/callback' ||
      req.path === '/api/auth/outlook/callback';
    // Also reject a hostile Origin on reads: OAuth URL generation creates state.
    if (origin && origin !== allowed)
      throw new ForbiddenException('请求来源不被允许');
    if (
      req.headers['sec-fetch-site'] === 'cross-site' &&
      !oauthCallback
    ) {
      throw new ForbiddenException('不接受跨站请求');
    }
    const open =
      req.path === '/api/status' ||
      (req.path === '/api/session' && req.method === 'POST') ||
      oauthCallback;
    if (!open && !this.sessions.authenticated(req))
      throw new UnauthorizedException('请先登录 ZoHome');
    const user = this.sessions.user(req);
    if (user) this.context.set({ userId: user.id, isPlatformAdmin: user.isPlatformAdmin });
    if (oauthCallback) {
      const workspaceId = this.sessions.stateWorkspace(typeof req.query.state === 'string' ? req.query.state : '', req);
      const workspace = user && workspaceId ? this.platform.workspaceForUser(workspaceId, user.id) : null;
      if (workspace) this.context.set({ workspaceId: workspace.id, role: workspace.role });
      return true;
    }
    if (open) return true;
    if (!user) throw new UnauthorizedException('请先登录 ZoHome');
    if (req.path === '/api/settings' && !user.isPlatformAdmin) throw new ForbiddenException('仅平台管理员可以修改服务端配置');
    if (/^\/api\/(?:me(?:\/|$)|users(?:\/|$)|workspaces(?:\/|$)|settings$|session$)/.test(req.path)) return true;
    const header = req.headers['x-workspace-id'];
    if (header !== undefined && (typeof header !== 'string' || !header.trim() || header.length > 80)) throw new BadRequestException('工作区标识无效');
    const workspaceId = typeof header === 'string' ? header : this.platform.defaultWorkspaceId;
    const workspace = this.platform.workspaceForUser(workspaceId, user.id);
    if (!workspace) throw new ForbiddenException('无权访问该工作区，请选择已加入的工作区');
    this.context.set({ workspaceId: workspace.id, role: workspace.role });
    return true;
  }
}

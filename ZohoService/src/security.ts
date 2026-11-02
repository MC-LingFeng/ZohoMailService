import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
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
  private readonly sessions = new Map<string, number>();
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();
  private readonly states = new Map<
    string,
    { session: string; expiresAt: number }
  >();
  constructor(private readonly config: AppConfig) {}
  authenticated(req: Request) {
    return !this.config.live || Boolean(this.sessionId(req));
  }
  sessionId(req: Request) {
    const token = req.cookies?.[COOKIE];
    const expires =
      typeof token === 'string' ? this.sessions.get(token) : undefined;
    if (expires && expires > Date.now()) return token as string;
    if (token) this.sessions.delete(token);
    return null;
  }
  login(req: Request, res: Response, password: string) {
    const ip = req.ip || 'local';
    const attempt = this.attempts.get(ip);
    if (attempt && attempt.until > Date.now() && attempt.count >= 10) {
      throw new ForbiddenException('尝试次数过多，请 15 分钟后重试');
    }
    const supplied = createHash('sha256').update(password).digest();
    const expected = createHash('sha256').update(this.config.password).digest();
    if (this.config.live && !timingSafeEqual(supplied, expected)) {
      const active =
        attempt && attempt.until > Date.now()
          ? attempt
          : { count: 0, until: Date.now() + 15 * 60_000 };
      this.attempts.set(ip, { ...active, count: active.count + 1 });
      throw new UnauthorizedException('管理密码不正确');
    }
    this.attempts.delete(ip);
    this.cleanup();
    const previous = this.sessionId(req);
    if (previous) this.sessions.delete(previous);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, Date.now() + SESSION_LIFETIME);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.secureCookies,
      maxAge: SESSION_LIFETIME,
      path: '/api',
    });
    return { success: true };
  }
  logout(req: Request, res: Response) {
    const token = this.sessionId(req);
    if (token) this.sessions.delete(token);
    res.clearCookie(COOKIE, {
      path: '/api',
      sameSite: 'lax',
      secure: this.config.secureCookies,
    });
    return { success: true };
  }
  createState(req: Request) {
    this.cleanup();
    const session = this.sessionId(req);
    if (!session) throw new UnauthorizedException('请先登录管理系统');
    const state = randomBytes(32).toString('base64url');
    this.states.set(state, { session, expiresAt: Date.now() + 10 * 60_000 });
    return state;
  }
  consumeState(state: string, req: Request) {
    const record = this.states.get(state);
    this.states.delete(state);
    return Boolean(
      record &&
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
    return true;
  }
}

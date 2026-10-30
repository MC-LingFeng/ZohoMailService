import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { AppConfig } from './config';
import { parseEnvDocument, updateEnvDocument } from './env-file';

const secretKey = /PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL/i;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const keyTitles: Record<string, string> = {
  APP_MODE: '运行模式', HOST: '监听地址', PORT: '服务端口',
  FRONTEND_URL: '网页地址', ZOHO_REDIRECT_URI: '授权回调地址',
  ZOHO_CLIENT_ID: '应用编号', ZOHO_CLIENT_SECRET: '应用密钥',
  APP_PASSWORD: '工作区密码', TOKEN_ENCRYPTION_KEY: '令牌加密密钥',
  DATA_DIR: '数据目录', ZOHO_MIN_REQUEST_INTERVAL_MS: '请求间隔（毫秒）',
};
const valuesOf = (source: string) => new Map(parseEnvDocument(source).map((entry) => [entry.key, entry.value]));
const valuesRevision = (source: string) => digest(JSON.stringify([...valuesOf(source)].sort(([a], [b]) => a.localeCompare(b))));

export interface SettingsField {
  key: string;
  label: string;
  comment: string;
  value: string | null;
  secret: boolean;
  configured: boolean;
  readOnly: boolean;
  reason?: string;
}

export interface SettingsDocument {
  fileName: string;
  revision: string;
  restartRequired: boolean;
  fields: SettingsField[];
}

@Injectable()
export class SettingsService {
  private filePath: string;
  private desktop = false;
  private baseline?: string;

  constructor(private readonly config: AppConfig) {
    this.filePath = config.envFile;
    this.captureBaseline();
  }

  setSource(filePath: string, desktop = false) {
    this.filePath = resolve(filePath);
    this.desktop = desktop;
    this.captureBaseline();
  }

  private captureBaseline() {
    try { this.baseline = valuesRevision(readFileSync(this.filePath, 'utf8')); }
    catch { this.baseline = undefined; }
  }

  private source() {
    try {
      const info = statSync(this.filePath);
      if (!info.isFile() || info.size > 1024 * 1024)
        throw new BadRequestException('配置文件格式或大小不受支持');
      return readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new NotFoundException('未找到配置文件，请先创建应用的 .env 配置文件');
      if (code === 'EACCES' || code === 'EPERM') throw new ForbiddenException('配置文件无法读取，请检查文件权限');
      throw new InternalServerErrorException('配置文件读取失败');
    }
  }

  private lockedReason(key: string, value: string): string | undefined {
    if (key === 'TOKEN_ENCRYPTION_KEY' && /^[a-f\d]{64}$/i.test(value))
      return '已有加密密钥需保持不变，以免已保存的邮箱授权无法解密';
    if (this.desktop && key === 'HOST') return '桌面版仅监听本机地址';
    if (!this.desktop && this.config.environmentOverrides.has(key))
      return '该项由启动环境提供，请在启动配置中修改';
    return undefined;
  }

  private document(source: string): SettingsDocument {
    return {
      fileName: basename(this.filePath),
      revision: digest(source),
      restartRequired: this.baseline === undefined || this.baseline !== valuesRevision(source),
      fields: parseEnvDocument(source).map((entry) => {
        const secret = secretKey.test(entry.key);
        const reason = this.lockedReason(entry.key, entry.value);
        const fallback = Object.hasOwn(keyTitles, entry.key) ? keyTitles[entry.key] : entry.key;
        return {
          key: entry.key,
          label: entry.label === entry.key ? fallback : entry.label,
          comment: entry.comment,
          value: secret ? null : entry.value,
          secret,
          configured: entry.value.length > 0,
          readOnly: Boolean(reason),
          ...(reason ? { reason } : {}),
        };
      }),
    };
  }

  read() {
    return this.document(this.source());
  }

  update(revision: string, input: Record<string, string>) {
    const source = this.source();
    if (digest(source) !== revision) throw new ConflictException('配置文件已被修改，请重新加载后再保存');
    if (!input || Array.isArray(input) || typeof input !== 'object')
      throw new BadRequestException('配置内容必须为键值对象');
    const entries = valuesOf(source);
    const updates: Record<string, string> = Object.create(null);
    for (const [key, value] of Object.entries(input)) {
      if (!entries.has(key)) throw new BadRequestException('提交了不存在的配置项，请重新加载');
      if (typeof value !== 'string' || value.length > 65536 || value.includes('\0'))
        throw new BadRequestException('配置值格式无效或长度超出限制');
      if (secretKey.test(key) && value === '') continue;
      if (value === entries.get(key)) continue;
      const reason = this.lockedReason(key, entries.get(key)!);
      if (reason) throw new BadRequestException(reason);
      updates[key] = value;
    }
    if (Object.keys(updates).length === 0) return this.document(source);
    let next: string;
    try { next = updateEnvDocument(source, updates); }
    catch { throw new BadRequestException('配置值无法保存，请检查引号或换行内容'); }
    if (Buffer.byteLength(next, 'utf8') > 1024 * 1024)
      throw new BadRequestException('保存后的配置文件超出大小限制');
    this.validate(valuesOf(next));
    this.write(source, next);
    return this.document(next);
  }

  private validate(values: Map<string, string>) {
    if (!this.desktop) {
      values = new Map(values);
      for (const [key, value] of this.config.environmentValues) values.set(key, value);
    }
    const get = (key: string) => values.get(key) ?? '';
    const mode = get('APP_MODE') || 'demo';
    if (!['demo', 'live'].includes(mode)) throw new BadRequestException('运行模式只能为演示模式或真实邮箱模式');
    const port = Number(get('PORT') || '3001');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BadRequestException('服务端口必须为 1 至 65535 的整数');
    for (const [key, title] of [['FRONTEND_URL', '网页地址'], ['ZOHO_REDIRECT_URI', '授权回调地址']]) {
      if (!get(key)) continue;
      try {
        const url = new URL(get(key));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch { throw new BadRequestException(`${title}必须为不含账号密码的 HTTP 或 HTTPS 地址`); }
    }
    const password = get('APP_PASSWORD');
    if ((password && password.length < 12) || password.length > 256 || (mode === 'live' && password.length < 12))
      throw new BadRequestException('工作区密码长度需为 12 至 256 个字符');
    const encryptionKey = get('TOKEN_ENCRYPTION_KEY');
    if ((encryptionKey || mode === 'live' || this.desktop) && !/^[a-f\d]{64}$/i.test(encryptionKey))
      throw new BadRequestException('令牌加密密钥必须为 64 位十六进制字符');
    const interval = get('ZOHO_MIN_REQUEST_INTERVAL_MS');
    if (interval && (!Number.isSafeInteger(Number(interval)) || Number(interval) < 2100))
      throw new BadRequestException('请求间隔必须为不少于 2100 的整数，单位为毫秒');
    const host = get('HOST');
    if (host && !/^[a-z\d_.:\-]+$/i.test(host)) throw new BadRequestException('监听地址格式无效');
    if (this.desktop) {
      if (password.length < 12) throw new BadRequestException('桌面版工作区密码至少需要 12 个字符');
      const frontend = new URL(get('FRONTEND_URL') || `http://localhost:${port}`);
      if (frontend.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(frontend.hostname) ||
        Number(frontend.port || 80) !== port || frontend.pathname !== '/' || frontend.search || frontend.hash)
        throw new BadRequestException(`桌面版网页地址必须为本机同端口地址 http://localhost:${port}`);
      const callback = new URL(get('ZOHO_REDIRECT_URI') || `${frontend.origin}/api/auth/zoho/callback`);
      if (callback.origin !== frontend.origin || callback.pathname !== '/api/auth/zoho/callback' || callback.search || callback.hash)
        throw new BadRequestException('桌面版授权回调必须为网页地址下的 /api/auth/zoho/callback');
    }
  }

  private write(previous: string, next: string) {
    let temporary: string | undefined;
    try {
      const target = realpathSync(this.filePath);
      const info = statSync(target);
      if ((info.mode & 0o222) === 0) throw Object.assign(new Error(), { code: 'EACCES' });
      accessSync(target, constants.W_OK);
      temporary = join(dirname(target), `.zohome-env-${process.pid}-${randomUUID()}.tmp`);
      let fd: number;
      try { fd = openSync(temporary, 'wx', info.mode & 0o777); }
      catch (error) {
        // A writable bind-mounted file may have a parent owned by a different UID.
        if (!['EACCES', 'EPERM', 'EROFS'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
        this.writeInPlace(target, previous, next);
        return;
      }
      try { writeFileSync(fd, next, 'utf8'); fsyncSync(fd); }
      finally { closeSync(fd); }
      if (readFileSync(target, 'utf8') !== previous)
        throw new ConflictException('配置文件已被修改，请重新加载后再保存');
      try { renameSync(temporary, target); }
      catch (error) {
        // A single-file Docker bind mount cannot be replaced with rename().
        if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
        this.writeInPlace(target, previous, next);
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (['EACCES', 'EPERM', 'EROFS'].includes(code || ''))
        throw new ForbiddenException('配置文件不可写，请检查文件权限和挂载是否为只读');
      throw new InternalServerErrorException('配置文件保存失败，请检查磁盘空间和文件权限');
    } finally {
      try { if (temporary) rmSync(temporary, { force: true }); } catch { /* Preserve the original save error. */ }
    }
  }

  private writeInPlace(target: string, previous: string, next: string) {
    const fd = openSync(target, 'r+');
    const writeAll = (value: string) => {
      const bytes = Buffer.from(value);
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (written === 0) throw new Error('配置写入中断');
        offset += written;
      }
      ftruncateSync(fd, bytes.length);
      fsyncSync(fd);
    };
    try {
      if (!fstatSync(fd).isFile() || readFileSync(fd, 'utf8') !== previous)
        throw new ConflictException('配置文件已被修改，请重新加载后再保存');
      try { writeAll(next); }
      catch (error) {
        // Restore the previous content if an in-place write fails part way through.
        try { writeAll(previous); } catch { /* Report the original disk error. */ }
        throw error;
      }
    } finally { closeSync(fd); }
  }
}

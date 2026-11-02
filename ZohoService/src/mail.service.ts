import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Request } from 'express';
import { AppConfig } from './config';
import {
  BindAccountDto,
  ListMessagesDto,
  SendDto,
  UpdateAccountDto,
} from './dto';
import { decryptToken, encryptToken, SessionService } from './security';
import { MailStore } from './store';
import { Folder, MailDetail, MailFolder, MailMessage, StoredAccount } from './types';
import { ZohoClient } from './zoho';
import { OutlookMailService } from './outlook-mail.service';
import { normalizeZohoFolders } from './zoho-folders';

type Json = Record<string, unknown>;
type Page = { messages: MailMessage[]; hasMore: boolean; cached: boolean };
const standardFolders: MailFolder[] = [
  { id: 'inbox', name: '收件箱', path: '/Inbox', type: 'inbox' },
  { id: 'spam', name: '垃圾邮件', path: '/Spam', type: 'spam' },
  { id: 'sent', name: '已发送', path: '/Sent', type: 'sent' },
];

@Injectable()
export class MailService {
  private readonly pages = new Map<string, { expires: number; value: Page }>();
  private readonly pendingPages = new Map<string, Promise<Page>>();
  private readonly folders = new Map<
    string,
    { expires: number; value: MailFolder[] }
  >();
  constructor(
    private readonly config: AppConfig,
    private readonly store: MailStore,
    private readonly zoho: ZohoClient,
    private readonly sessions: SessionService,
    private readonly outlook: OutlookMailService,
  ) {}

  accounts() {
    return this.store.publicAccounts();
  }
  overview() {
    return this.store.overview();
  }
  activity() {
    return this.store.activity();
  }
  account(id: string) {
    const account = this.store.account(id);
    if (!account) throw new NotFoundException('邮箱不存在或已断开连接');
    return account;
  }
  update(id: string, dto: UpdateAccountDto) {
    const account = this.account(id);
    this.store.saveAccount({
      ...account,
      ...(dto.name === undefined
        ? {}
        : { name: dto.name.trim() || account.email }),
      ...(dto.group === undefined
        ? {}
        : { group: dto.group.trim() || '未分组' }),
    });
    return this.accounts().find((item) => item.id === id);
  }
  disconnect(id: string) {
    this.account(id);
    this.store.removeAccount(id);
    this.zoho.forget(id);
    this.outlook.forget(id);
    this.invalidate(id);
    return { success: true };
  }
  async list(id: string, query: ListMessagesDto): Promise<Page> {
    const account = this.account(id);
    if (query.folder === 'other' && !query.folderId) throw new BadRequestException('请选择具体的邮件文件夹');
    const key = JSON.stringify([id, query.folder, query.folderId || '', query.start, query.limit, query.q]);
    if (!this.config.live) {
      if (query.folderId && !(await this.listFolders(id)).some((folder) => folder.id === query.folderId && folder.type === query.folder))
        throw new NotFoundException('该邮箱不存在所选文件夹');
      const all = this.store
        .messages(id, query.folder)
        .filter(
          (message) =>
            (!query.folderId || message.folderId === query.folderId) && (!query.q ||
            [
              message.subject,
              message.from,
              message.fromName,
              message.preview,
            ].some((value) =>
              value.toLowerCase().includes(query.q.toLowerCase()),
            )),
        );
      return {
        messages: all
          .slice(query.start - 1, query.start - 1 + query.limit)
          .map(({ content: _content, format: _format, ...message }) => message),
        hasMore: query.start - 1 + query.limit < all.length,
        cached: false,
      };
    }
    const cached = this.pages.get(key);
    if (cached && cached.expires > Date.now())
      return { ...cached.value, cached: true };
    const pending = this.pendingPages.get(key);
    if (pending) return pending;
    const task = this.fetchPage(account, query, key);
    this.pendingPages.set(key, task);
    try {
      return await task;
    } finally {
      this.pendingPages.delete(key);
    }
  }
  private async fetchPage(
    account: StoredAccount,
    query: ListMessagesDto,
    key: string,
  ): Promise<Page> {
    let messages: MailMessage[];
    let hasMore: boolean;
    let providerUnread: number | undefined;
    if (account.provider === 'outlook') {
      const page = await this.outlook.page(account, query);
      messages = page.messages;
      hasMore = page.hasMore;
      providerUnread = page.unread;
    } else {
      const folder = await this.folder(account, query);
      const data = await this.zoho.request(
        account,
        `/api/accounts/${encodeURIComponent(account.zohoAccountId)}/messages/view`,
        {
          query: {
            folderId: folder.id,
            start: query.start,
            limit: query.limit,
            includeto: 'true',
            includesent: query.folder === 'sent' ? 'true' : 'false',
            // On Zoho, opting into archived mail can hide ordinary messages.
            // Use that filter only for the dedicated Archive folder.
            ...(folder.path.toLowerCase() === '/archive' ? { includearchive: 'true' } : {}),
            sortBy: 'date',
            sortorder: 'false',
          },
        },
      );
      if (!Array.isArray(data))
        throw new BadRequestException('Zoho 返回了无效的邮件列表');
      messages = data.map((row) =>
        this.mapMessage(row as Json, account, query.folder, folder.id),
      );
      hasMore = data.length === query.limit;
    }
    for (const message of messages) this.store.saveMessage(message);
    const unread = providerUnread ?? (
      query.folder === 'inbox'
        ? this.store
            .messages(account.id, 'inbox')
            .filter((message) => !message.isRead).length
        : account.unread);
    const latest = this.account(account.id);
    this.store.saveAccount({
      ...latest,
      unread,
      status: 'connected',
      lastSyncedAt: new Date().toISOString(),
    });
    // q is a page-local filter; frontend also labels its search as current-page filtering.
    const value = {
      messages: query.q
        ? messages.filter((message) =>
            [
              message.subject,
              message.from,
              message.fromName,
              message.preview,
            ].some((text) =>
              text.toLowerCase().includes(query.q.toLowerCase()),
            ),
          )
        : messages,
      hasMore,
      cached: false,
    };
    if (this.pages.size > 2000) this.pages.clear();
    this.pages.set(key, { expires: Date.now() + 60_000, value });
    return value;
  }
  async detail(
    id: string,
    messageId: string,
    folderId: string,
  ): Promise<MailDetail> {
    const account = this.account(id);
    const previous = this.store.message(id, messageId);
    if (!previous || previous.folderId !== folderId)
      throw new NotFoundException('请先从当前邮箱的邮件列表打开这封邮件');
    if (!this.config.live) {
      if (!previous.isRead) {
        this.store.saveMessage({ ...previous, isRead: true });
        this.store.saveAccount({
          ...account,
          unread: Math.max(
            0,
            account.unread - (previous.folder === 'inbox' ? 1 : 0),
          ),
        });
      }
      return { ...previous, isRead: true };
    }
    if (account.provider === 'outlook') return this.outlook.detail(account, previous);
    const data = (await this.zoho.request(
      account,
      `/api/accounts/${encodeURIComponent(account.zohoAccountId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/content`,
    )) as Json;
    const detail: MailDetail = {
      ...previous,
      content: String(data?.content || ''),
      format: 'html',
    };
    // Viewing a real message uses READ permission only. It does not modify server-side read flags.
    return detail;
  }
  async send(id: string, dto: SendDto) {
    const account = this.account(id);
    let messageId: string;
    if (!this.config.live) {
      messageId = randomUUID();
      this.store.saveMessage({
        id: messageId,
        accountId: id,
        folderId: `${id}-sent`,
        folder: 'sent',
        from: account.email,
        fromName: account.name,
        to: dto.to,
        subject: dto.subject,
        preview: dto.content.slice(0, 180),
        receivedAt: new Date().toISOString(),
        isRead: true,
        hasAttachment: false,
        content: dto.content,
        format: 'plaintext',
      });
    } else if (account.provider === 'outlook') {
      messageId = (await this.outlook.send(account, dto)).messageId;
      this.invalidate(id);
    } else {
      const data = (await this.zoho.request(
        account,
        `/api/accounts/${encodeURIComponent(account.zohoAccountId)}/messages`,
        {
          method: 'POST',
          body: {
            fromAddress: account.email,
            toAddress: dto.to,
            subject: dto.subject,
            content: dto.content,
            mailFormat: 'plaintext',
            encoding: 'UTF-8',
          },
        },
      )) as Json;
      messageId = String(data?.messageId || 'accepted');
      this.invalidate(id);
    }
    this.store.addActivity(
      'send',
      account.email,
      this.config.live ? `已发送：${dto.subject}` : `演示发送：${dto.subject}`,
    );
    return { messageId, demo: !this.config.live };
  }
  async sync(id: string, query: ListMessagesDto = new ListMessagesDto()) {
    const account = this.account(id);
    this.invalidate(id);
    if (this.config.live)
      await this.list(
        id,
        Object.assign(new ListMessagesDto(), { folder: query.folder, folderId: query.folderId }),
      );
    else
      this.store.saveAccount({
        ...account,
        lastSyncedAt: new Date().toISOString(),
      });
    this.store.addActivity('sync', account.email, '邮件同步已完成');
    return { success: true };
  }
  authorizationUrl(req: Request, dto: BindAccountDto) {
    this.requireLiveBinding();
    return this.beginBinding(
      req,
      dto.email.trim().toLowerCase(),
      dto.clientId,
      encryptToken(dto.clientSecret, this.config.encryptionKey),
    );
  }
  reauthorize(id: string, req: Request) {
    this.requireLiveBinding();
    const account = this.account(id);
    if (account.provider === 'outlook') return this.outlook.reauthorize(account, req);
    const credentials = this.zoho.credentialsFor(account);
    return this.beginBinding(
      req,
      account.email.trim().toLowerCase(),
      credentials.clientId,
      encryptToken(credentials.clientSecret, this.config.encryptionKey),
      account.id,
    );
  }
  private requireLiveBinding() {
    if (!this.config.live)
      throw new BadRequestException(
        '演示模式使用示例邮箱。切换真实模式后即可连接邮箱',
      );
  }
  private beginBinding(
    req: Request,
    email: string,
    clientId: string,
    encryptedClientSecret: string,
    accountId?: string,
  ) {
    const state = this.sessions.createState(req);
    this.store.saveBinding({
      stateHash: createHash('sha256').update(state).digest('hex'),
      provider: 'zoho',
      email,
      clientId,
      encryptedClientSecret,
      expiresAt: Date.now() + 10 * 60_000,
      ...(accountId ? { accountId } : {}),
    });
    const url = new URL('/oauth/v2/auth', this.config.accountsBase);
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes,
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString();
    return { url: url.toString() };
  }
  async callback(req: Request, code: string, state: string, location?: string) {
    const validState = this.sessions.consumeState(state, req);
    const binding = this.store.consumeBinding(
      createHash('sha256')
        .update(typeof state === 'string' ? state : '')
        .digest('hex'),
    );
    if (!this.config.live || !validState || !binding || (binding.provider && binding.provider !== 'zoho'))
      throw new UnauthorizedException(
        '授权请求已过期或不属于当前会话，请重新填写并连接邮箱',
      );
    if (location && location !== 'us')
      throw new BadRequestException(
        '当前版本仅支持美国数据中心（mail.zoho.com）的账号',
      );
    if (!code) throw new BadRequestException('授权未完成，请重新连接邮箱');
    const credentials = {
      clientId: binding.clientId,
      clientSecret: decryptToken(
        binding.encryptedClientSecret,
        this.config.encryptionKey,
      ),
    };
    const tokens = await this.zoho.exchangeCode(code, credentials);
    const accounts = await this.zoho.initialAccounts(
      String(tokens.access_token),
    );
    if (!Array.isArray(accounts) || !accounts.length)
      throw new BadRequestException('此账号没有可用的 Zoho 邮箱');
    const primaryEmail = (item: Json) =>
      String(
        item.primaryEmailAddress ||
          item.mailboxAddress ||
          item.incomingUserName ||
          '',
      )
        .trim()
        .toLowerCase();
    const item = accounts.find(
      (candidate) =>
        (!candidate.type || candidate.type === 'ZOHO_ACCOUNT') &&
        primaryEmail(candidate) === binding.email,
    );
    if (!item)
      throw new BadRequestException(
        `授权的邮箱与填写的 ${binding.email} 不一致，请在 Zoho 页面切换到该邮箱后重新绑定`,
      );
    const zohoAccountId = String(item.accountId || '');
    if (!zohoAccountId)
      throw new BadRequestException('Zoho 未返回有效的邮箱标识，请重试');
    const id = `us-${zohoAccountId}`;
    if (binding.accountId && binding.accountId !== id)
      throw new BadRequestException(
        '授权的邮箱与当前账号不一致，请切换到正确的 Zoho 邮箱',
      );
    const previous = this.store.account(id);
    if (binding.accountId && !previous)
      throw new NotFoundException('该邮箱连接已被移除，请重新填写并绑定');
    let sameClient = false;
    if (previous) {
      try {
        const saved = this.zoho.credentialsFor(previous);
        sameClient =
          saved.clientId === credentials.clientId &&
          saved.clientSecret === credentials.clientSecret;
      } catch {
        /* An unavailable or incomplete old configuration cannot supply a fallback token. */
      }
    }
    const refresh = tokens.refresh_token
      ? encryptToken(String(tokens.refresh_token), this.config.encryptionKey)
      : sameClient
        ? previous?.encryptedRefreshToken
        : undefined;
    if (!refresh)
      throw new BadRequestException(
        'Zoho 未返回该客户端的离线授权，请重新授权并同意全部权限',
      );
    this.store.saveAccount({
      id,
      provider: 'zoho',
      email: primaryEmail(item),
      name:
        previous?.name ||
        String(
          item.accountDisplayName ||
            item.displayName ||
            binding.email.split('@')[0],
        ),
      group: previous?.group || '未分组',
      color:
        previous?.color ||
        ['#5164f4', '#aa79dc', '#36a58f', '#e6a44c'][
          this.store.accounts().length % 4
        ],
      status: 'connected',
      unread: previous?.unread || 0,
      lastSyncedAt: previous?.lastSyncedAt || null,
      zohoAccountId,
      encryptedRefreshToken: refresh,
      clientId: binding.clientId,
      encryptedClientSecret: binding.encryptedClientSecret,
    });
    this.zoho.forget(id);
    this.invalidate(id);
    this.store.addActivity(
      'connect',
      binding.email,
      previous ? '邮箱及客户端配置已重新授权' : '邮箱与客户端配置已绑定',
    );
    return { success: true };
  }
  outlookAuthorizationUrl(req: Request, dto: BindAccountDto) {
    this.requireLiveBinding();
    return this.outlook.authorizationUrl(req, dto);
  }
  async outlookCallback(req: Request, code: string, state: string) {
    const result = await this.outlook.callback(req, code, state);
    this.invalidate(result.accountId);
    return { success: true };
  }
  async listFolders(id: string): Promise<MailFolder[]> {
    const account = this.account(id);
    if (!this.config.live) return standardFolders.map((folder) => ({ ...folder, id: `${id}-${folder.type}` }));
    if (account.provider === 'outlook') return standardFolders.map((folder) => ({
      ...folder, id: folder.type === 'spam' ? 'junkemail' : folder.type === 'sent' ? 'sentitems' : 'inbox',
    }));
    let cached = this.folders.get(account.id);
    if (!cached || cached.expires < Date.now()) {
      const data = await this.zoho.request(
        account,
        `/api/accounts/${encodeURIComponent(account.zohoAccountId)}/folders`,
        { query: { fields: 'folderId,folderName,folderType,path,isArchived' } },
      );
      cached = { expires: Date.now() + 3_600_000, value: normalizeZohoFolders(data) };
      this.folders.set(account.id, cached);
    }
    return cached.value;
  }
  private async folder(account: StoredAccount, query: ListMessagesDto) {
    if (query.folder === 'other' && !query.folderId) throw new BadRequestException('请选择具体的邮件文件夹');
    const folders = await this.listFolders(account.id);
    const result = query.folderId
      ? folders.find((item) => item.id === query.folderId)
      : folders.find((item) => item.type === query.folder);
    if (!result || result.type !== query.folder)
      throw new NotFoundException('该邮箱不存在所选文件夹，请刷新文件夹列表后重试');
    return result;
  }
  private invalidate(id: string) {
    for (const key of this.pages.keys())
      if ((JSON.parse(key) as string[])[0] === id) this.pages.delete(key);
    this.folders.delete(id);
    this.outlook.invalidate(id);
  }
  private mapMessage(
    row: Json,
    account: StoredAccount,
    folder: Folder,
    folderId: string,
  ): MailMessage {
    const numericDate = Number(
      row.receivedTime || row.receivedtime || row.sentDateInGMT || 0,
    );
    return {
      id: String(row.messageId),
      accountId: account.id,
      folderId: String(row.folderId || folderId),
      folder,
      from: String(row.fromAddress || ''),
      fromName: String(row.sender || row.fromAddress || ''),
      to: String(row.toAddress || account.email),
      subject: String(row.subject || '（无主题）'),
      preview: String(row.summary || '')
        .replace(/<[^>]*>/g, ' ')
        .slice(0, 400),
      receivedAt:
        numericDate > 0 && Number.isFinite(numericDate)
          ? new Date(numericDate).toISOString()
          : new Date(0).toISOString(),
      isRead: row.status === 'read' || row.status === '1' || row.status === 1,
      hasAttachment:
        row.hasAttachment === true ||
        row.hasAttachment === '1' ||
        row.hasAttachment === 1,
    };
  }
}

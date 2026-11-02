import { BadGatewayException, BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Request } from 'express';
import { AppConfig } from './config';
import { BindAccountDto, ListMessagesDto, SendDto } from './dto';
import { OutlookClient } from './outlook';
import { decryptToken, encryptToken, SessionService } from './security';
import { MailStore } from './store';
import { Folder, MailDetail, MailMessage, StoredAccount } from './types';

type Json = Record<string, unknown>;
const folders: Record<Folder, string> = { inbox: 'inbox', spam: 'junkemail', sent: 'sentitems' };

@Injectable()
export class OutlookMailService {
  private readonly cursors = new Map<string, Map<number, string>>();
  constructor(
    private readonly config: AppConfig,
    private readonly store: MailStore,
    private readonly client: OutlookClient,
    private readonly sessions: SessionService,
  ) {}

  authorizationUrl(req: Request, dto: BindAccountDto) {
    return this.beginBinding(req, dto.email.trim().toLowerCase(), dto.clientId,
      encryptToken(dto.clientSecret, this.config.encryptionKey));
  }

  reauthorize(account: StoredAccount, req: Request) {
    const credentials = this.client.credentialsFor(account);
    return this.beginBinding(req, account.email, credentials.clientId,
      encryptToken(credentials.clientSecret, this.config.encryptionKey), account.id);
  }

  private beginBinding(req: Request, email: string, clientId: string, encryptedClientSecret: string, accountId?: string) {
    if (!this.config.live) throw new BadRequestException('演示模式使用示例邮箱，切换真实模式后即可连接 Outlook');
    if (!/^[a-z\d.-]+$/i.test(this.config.outlookTenant)) throw new BadRequestException('OUTLOOK_TENANT 格式无效');
    const state = this.sessions.createState(req);
    const verifier = randomBytes(32).toString('base64url');
    this.store.saveBinding({
      stateHash: createHash('sha256').update(state).digest('hex'),
      provider: 'outlook', email, clientId, encryptedClientSecret,
      encryptedCodeVerifier: encryptToken(verifier, this.config.encryptionKey),
      expiresAt: Date.now() + 10 * 60_000,
      ...(accountId ? { accountId } : {}),
    });
    const url = new URL(`https://login.microsoftonline.com/${this.config.outlookTenant}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({
      client_id: clientId, response_type: 'code', response_mode: 'query',
      redirect_uri: this.config.outlookRedirectUri, scope: this.config.outlookScopes,
      prompt: 'select_account', login_hint: email, state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString() };
  }

  async callback(req: Request, code: string, state: string) {
    const valid = this.sessions.consumeState(state, req);
    const binding = this.store.consumeBinding(createHash('sha256')
      .update(typeof state === 'string' ? state : '').digest('hex'));
    if (!this.config.live || !valid || binding?.provider !== 'outlook' || !binding.encryptedCodeVerifier)
      throw new UnauthorizedException('授权请求已过期或不属于当前会话，请重新连接 Outlook 邮箱');
    if (typeof code !== 'string' || !code) throw new BadRequestException('Microsoft 授权未完成，请重新连接邮箱');
    const credentials = {
      clientId: binding.clientId,
      clientSecret: decryptToken(binding.encryptedClientSecret, this.config.encryptionKey),
    };
    const tokens = await this.client.exchangeCode(code, credentials, this.config.outlookRedirectUri,
      decryptToken(binding.encryptedCodeVerifier, this.config.encryptionKey));
    const profile = await this.client.profile(tokens.access_token);
    if (profile.email.toLowerCase() !== binding.email)
      throw new BadRequestException(`授权邮箱与填写的 ${binding.email} 不一致，请填写邮箱主地址并在 Microsoft 页面选择该账号`);
    const id = `outlook-${profile.id}`;
    if (binding.accountId && binding.accountId !== id)
      throw new BadRequestException('授权邮箱与当前账号不一致，请选择正确的 Outlook 邮箱');
    const previous = this.store.account(id);
    if (binding.accountId && !previous) throw new NotFoundException('该邮箱已被移除，请重新添加');
    let sameClient = false;
    if (previous) {
      try {
        const saved = this.client.credentialsFor(previous);
        sameClient = saved.clientId === credentials.clientId && saved.clientSecret === credentials.clientSecret;
      } catch { /* Missing old credentials cannot supply a fallback refresh token. */ }
    }
    const refresh = tokens.refresh_token
      ? encryptToken(tokens.refresh_token, this.config.encryptionKey)
      : sameClient ? previous?.encryptedRefreshToken : undefined;
    if (!refresh) throw new BadRequestException('Microsoft 未返回离线授权，请重新连接并同意 offline_access 权限');
    this.store.saveAccount({
      id, provider: 'outlook', outlookUserId: profile.id, zohoAccountId: '',
      email: profile.email, name: previous?.name || profile.displayName || binding.email.split('@')[0],
      group: previous?.group || '未分组',
      color: previous?.color || ['#5164f4', '#aa79dc', '#36a58f', '#e6a44c'][this.store.accounts().length % 4],
      status: 'connected', unread: previous?.unread || 0, lastSyncedAt: previous?.lastSyncedAt || null,
      encryptedRefreshToken: refresh, clientId: binding.clientId, encryptedClientSecret: binding.encryptedClientSecret,
    });
    this.forget(id);
    this.store.addActivity('connect', profile.email, previous ? 'Outlook 邮箱已重新授权' : 'Outlook 邮箱已绑定');
    return { success: true, accountId: id };
  }

  async page(account: StoredAccount, query: ListMessagesDto) {
    const folder = folders[query.folder];
    const key = `${account.id}:${query.folder}:${query.limit}`;
    let cursors = this.cursors.get(key);
    if (!cursors) {
      if (this.cursors.size >= 2000) this.cursors.delete(this.cursors.keys().next().value!);
      cursors = new Map();
      this.cursors.set(key, cursors);
    }
    const nextLink = cursors.get(query.start);
    if (query.start > 1 && !nextLink)
      throw new BadRequestException('Outlook 分页信息已失效，请回到第一页或刷新邮件后重试');
    const folderData = await this.client.request(account, `/me/mailFolders/${folder}`, {
      query: { $select: 'id,unreadItemCount' },
    }) as Json | null;
    if (!folderData || typeof folderData.id !== 'string' || !folderData.id)
      throw new BadGatewayException('Outlook 返回了无效的邮件文件夹');
    // Preserve Microsoft's opaque nextLink instead of constructing $skip offsets.
    const data = await this.client.request(account, nextLink || `/me/mailFolders/${folder}/messages`, nextLink ? {} : {
      query: {
        $select: 'id,parentFolderId,from,toRecipients,subject,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments',
        $orderby: query.folder === 'sent' ? 'sentDateTime desc' : 'receivedDateTime desc',
        $top: query.limit,
      },
    }) as Json | null;
    if (!data || !Array.isArray(data.value) ||
        (data['@odata.nextLink'] !== undefined && typeof data['@odata.nextLink'] !== 'string'))
      throw new BadGatewayException('Outlook 返回了无效的邮件列表');
    const messages = data.value.map((row: unknown) => this.mapMessage(row, account, query.folder, String(folderData.id)));
    const next = data['@odata.nextLink'];
    if (next) {
      // Limit retained cursors per folder; older pages can always restart from the first page.
      if (cursors.size >= 1000) cursors.delete(cursors.keys().next().value!);
      cursors.set(query.start + query.limit, String(next));
    } else cursors.delete(query.start + query.limit);
    return {
      messages, hasMore: Boolean(next),
      unread: query.folder === 'inbox' && Number.isSafeInteger(folderData.unreadItemCount) && Number(folderData.unreadItemCount) >= 0
        ? Number(folderData.unreadItemCount) : account.unread,
    };
  }

  async detail(account: StoredAccount, previous: MailDetail): Promise<MailDetail> {
    const data = await this.client.request(account,
      `/me/mailFolders/${encodeURIComponent(previous.folderId)}/messages/${encodeURIComponent(previous.id)}`,
      { query: { $select: 'id,parentFolderId,body,isRead' } }) as Json | null;
    const body = data?.body as Json | undefined;
    if (!data || data.id !== previous.id || !body || typeof body.content !== 'string' ||
        !['html', 'text'].includes(String(body.contentType).toLowerCase()))
      throw new BadGatewayException('Outlook 返回了无效的邮件正文');
    return { ...previous, content: body.content,
      format: String(body.contentType).toLowerCase() === 'html' ? 'html' : 'plaintext',
      isRead: data.isRead === true };
  }

  async send(account: StoredAccount, dto: SendDto) {
    await this.client.request(account, '/me/sendMail', {
      method: 'POST', body: {
        message: { subject: dto.subject, body: { contentType: 'Text', content: dto.content },
          toRecipients: [{ emailAddress: { address: dto.to } }] },
        saveToSentItems: true,
      },
    });
    return { messageId: 'accepted' };
  }

  invalidate(id: string) {
    for (const key of this.cursors.keys()) if (key.startsWith(`${id}:`)) this.cursors.delete(key);
  }
  forget(id: string) { this.invalidate(id); this.client.forget(id); }

  private mapMessage(value: unknown, account: StoredAccount, folder: Folder, folderId: string): MailMessage {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadGatewayException('Outlook 返回了无效的邮件条目');
    const row = value as Json;
    if (typeof row.id !== 'string' || !row.id)
      throw new BadGatewayException('Outlook 未返回有效的邮件标识');
    const from = (row.from as { emailAddress?: { address?: string; name?: string } } | undefined)?.emailAddress;
    const recipients = Array.isArray(row.toRecipients) ? row.toRecipients : [];
    const date = String((folder === 'sent' ? row.sentDateTime : row.receivedDateTime) || row.receivedDateTime || '');
    return {
      id: row.id, accountId: account.id, folder,
      folderId: typeof row.parentFolderId === 'string' && row.parentFolderId ? row.parentFolderId : folderId,
      from: String(from?.address || ''), fromName: String(from?.name || from?.address || ''),
      to: recipients.map((item: { emailAddress?: { address?: string } }) => item?.emailAddress?.address || '').filter(Boolean).join(', ') || account.email,
      subject: String(row.subject || '（无主题）'), preview: String(row.bodyPreview || '').slice(0, 400),
      receivedAt: Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : new Date(0).toISOString(),
      isRead: row.isRead === true, hasAttachment: row.hasAttachments === true,
    };
  }
}

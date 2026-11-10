import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Patch } from '@nestjs/common';
import { createHash, createPrivateKey } from 'node:crypto';
import { PlatformStore } from './platform-store';
import { WorkspaceContext } from './workspace-context';
import { UpdateSettingsDto } from './settings.dto';

const fields = [
  ['ZOHO_MIN_REQUEST_INTERVAL_MS', 'Zoho 请求间隔（毫秒）', false, '2100'],
  ['OUTLOOK_TENANT', 'Microsoft 账户类型或租户', false, 'common'],
  ['ZOHO_CLIENT_ID', '旧版 Zoho 应用编号', false, ''],
  ['ZOHO_CLIENT_SECRET', '旧版 Zoho 应用密钥', true, ''],
  ['ADS_MANAGER_ACCOUNT', 'Google Ads 经理号', false, ''],
  ['ADS_API_VERSION', 'Google Ads API 版本', false, 'v26'],
  ['ADS_CREDENTIALS_JSON', 'Google Ads 服务账号 JSON', true, ''],
] as const;
const revisionOf = (values: Record<string, string>) => createHash('sha256')
  .update(JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');

@Controller('workspace-settings')
export class WorkspaceSettingsController {
  constructor(private readonly platform: PlatformStore, private readonly context: WorkspaceContext) {}

  private id() {
    const id = this.context.current()?.workspaceId;
    if (!id) throw new ForbiddenException('请选择工作空间');
    return id;
  }

  private document() {
    const values = this.platform.getWorkspaceSettings(this.id());
    const owner = this.context.current()?.role === 'owner';
    return {
      fileName: '工作空间设置', revision: revisionOf(values), restartRequired: false,
      fields: fields.map(([key, label, secret, fallback]) => ({
        key, label, secret, comment: key.startsWith('ZOHO_CLIENT_') ? '仅用于兼容旧授权，新邮箱可在绑定时填写应用配置。' : '',
        value: secret ? null : values[key] ?? fallback,
        configured: Boolean(values[key]), readOnly: !owner,
        ...(!owner ? { reason: '仅工作空间所有者可以修改' } : {}),
      })),
    };
  }

  @Get()
  read() { return this.document(); }

  @Patch()
  update(@Body() input: UpdateSettingsDto) {
    if (this.context.current()?.role !== 'owner') throw new ForbiddenException('仅工作空间所有者可以修改设置');
    const values = this.platform.getWorkspaceSettings(this.id());
    if (revisionOf(values) !== input.revision) throw new ConflictException('设置已被修改，请重新加载');
    const allowed = new Map(fields.map((field) => [field[0] as string, field]));
    const next = { ...values };
    for (const [key, value] of Object.entries(input.values)) {
      const field = allowed.get(key);
      if (!field || typeof value !== 'string' || value.includes('\0') || value.length > 65536)
        throw new BadRequestException('工作空间设置包含无效字段或内容');
      if (field[2] && !value) continue;
      next[key] = value;
    }
    if (next.ZOHO_MIN_REQUEST_INTERVAL_MS && (!Number.isSafeInteger(Number(next.ZOHO_MIN_REQUEST_INTERVAL_MS)) || Number(next.ZOHO_MIN_REQUEST_INTERVAL_MS) < 2100))
      throw new BadRequestException('请求间隔必须为不少于 2100 的整数');
    if (next.OUTLOOK_TENANT && !/^[a-z\d.-]+$/i.test(next.OUTLOOK_TENANT)) throw new BadRequestException('Microsoft 租户格式无效');
    if (next.ADS_MANAGER_ACCOUNT && !/^\d{10}$/.test(next.ADS_MANAGER_ACCOUNT.replace(/[\s-]/g, ''))) throw new BadRequestException('经理号必须包含 10 位数字');
    if (next.ADS_API_VERSION && !/^v\d{1,3}$/.test(next.ADS_API_VERSION)) throw new BadRequestException('Google Ads API 版本格式无效');
    if (next.ADS_CREDENTIALS_JSON) {
      try {
        const credentials = JSON.parse(next.ADS_CREDENTIALS_JSON);
        if (credentials.type !== 'service_account' || typeof credentials.client_email !== 'string' || !credentials.client_email || typeof credentials.private_key !== 'string' || createPrivateKey(credentials.private_key).asymmetricKeyType !== 'rsa') throw new Error();
      } catch { throw new BadRequestException('请提供有效的 Google Ads 服务账号 JSON 密钥'); }
    }
    this.platform.setWorkspaceSettings(this.id(), next);
    return this.document();
  }
}

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createPrivateKey, sign, KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AppConfig } from './config';

export interface CampaignCost {
  customerId: string;
  campaignId: string;
  campaignName: string;
  currencyCode: string;
  costMicros: string;
}

interface ServiceAccount {
  email: string;
  privateKey: KeyObject;
  fingerprint: string;
}

interface AdsRow {
  customerClient?: {
    clientCustomer?: string;
    manager?: boolean;
    level?: string | number;
  };
  customer?: { currencyCode?: string };
  campaign?: { id?: string; name?: string };
  metrics?: { costMicros?: string };
}

const tokenUrl = 'https://oauth2.googleapis.com/token';
const adsScope = 'https://www.googleapis.com/auth/adwords';
const hierarchyQuery = `SELECT customer_client.client_customer,
  customer_client.manager, customer_client.level
  FROM customer_client WHERE customer_client.level <= 1`;
// No date or status filter: request cumulative spend, including paused/removed campaigns.
const campaignQuery = `SELECT campaign.id, campaign.name,
  metrics.cost_micros, customer.currency_code FROM campaign`;

const errorAdvice: Record<string, string> = {
  CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION:
    '服务账号所属 Google Cloud 项目尚未获得正式账户访问权限，请在 Cloud Console 中申请 Google Ads API Explorer 或更高访问级别',
  USER_PERMISSION_DENIED: '请将服务账号邮箱添加到经理号并授予读取权限',
  CUSTOMER_NOT_ENABLED: '广告账户不可用，请检查账户状态',
  INVALID_LOGIN_CUSTOMER_ID_SERVING_CUSTOMER_ID_COMBINATION:
    '请检查经理号与广告账户的关联关系',
  RESOURCE_EXHAUSTED: 'Google Ads 请求额度不足，请稍后重试',
};

@Injectable()
export class GoogleAdsClient {
  private token?: { value: string; expires: number; fingerprint: string };
  private renewing?: { fingerprint: string; promise: Promise<string> };

  constructor(private readonly config: AppConfig) {}

  async campaignCosts(): Promise<CampaignCost[]> {
    const managerId = this.config.adsManagerAccount.replace(/[\s-]/g, '');
    if (!/^\d{10}$/.test(managerId))
      throw new BadRequestException('请在工作空间设置中配置有效的 ADS_MANAGER_ACCOUNT（10 位经理号）');
    if (!/^v\d{1,3}$/.test(this.config.adsApiVersion))
      throw new BadRequestException('ADS_API_VERSION 格式须为 v26 这样的 API 主版本号');

    const credentials = await this.credentials();
    const token = await this.accessToken(credentials);
    const managers = [managerId];
    const visitedManagers = new Set<string>();
    const customerIds = new Set<string>();
    while (managers.length) {
      const current = managers.shift()!;
      if (visitedManagers.has(current)) continue;
      visitedManagers.add(current);
      const rows = await this.search(current, managerId, token, hierarchyQuery);
      for (const row of rows) {
        const child = row.customerClient;
        const id = /^customers\/(\d{10})$/.exec(child?.clientCustomer || '')?.[1];
        const level = Number(child?.level ?? 0);
        if (!id || !Number.isInteger(level) || level < 0 || level > 1 ||
            (child?.manager !== undefined && typeof child.manager !== 'boolean'))
          throw new BadGatewayException('Google Ads 返回的账户层级数据格式无效，成本未更新');
        if (level === 0) continue;
        if (child?.manager) managers.push(id);
        else customerIds.add(id);
      }
    }

    const result: CampaignCost[] = [];
    const campaigns = new Set<string>();
    for (const customerId of customerIds) {
      const rows = await this.search(customerId, managerId, token, campaignQuery);
      for (const row of rows) {
        const campaignId = row.campaign?.id;
        const campaignName = row.campaign?.name;
        const currencyCode = row.customer?.currencyCode;
        // Protobuf JSON omits zero-valued int64 fields.
        const costMicros = row.metrics?.costMicros ?? '0';
        if (typeof campaignId !== 'string' || !/^\d+$/.test(campaignId) ||
            typeof campaignName !== 'string' || !campaignName.trim() ||
            typeof currencyCode !== 'string' || !/^[A-Z]{3}$/.test(currencyCode) ||
            typeof costMicros !== 'string' || !/^\d+$/.test(costMicros))
          throw new BadGatewayException('Google Ads 返回的广告系列消费数据格式无效，成本未更新');
        const key = `${customerId}/${campaignId}`;
        if (campaigns.has(key)) continue;
        campaigns.add(key);
        result.push({ customerId, campaignId, campaignName, currencyCode, costMicros });
      }
    }
    return result;
  }

  private async credentials(): Promise<ServiceAccount> {
    try {
      const source = this.config.adsCredentialsJson || await readFile(this.config.adsCredentialsFile, 'utf8');
      const data = JSON.parse(source);
      if (data.type !== 'service_account' || typeof data.client_email !== 'string' ||
          !data.client_email || typeof data.private_key !== 'string') throw new Error();
      const privateKey = createPrivateKey(data.private_key);
      if (privateKey.asymmetricKeyType !== 'rsa') throw new Error();
      return {
        email: data.client_email,
        privateKey,
        fingerprint: createHash('sha256').update(source).digest('hex'),
      };
    } catch {
      throw new ServiceUnavailableException('无法读取有效的 Google Ads 服务账号密钥，请检查工作空间设置或原有 ADS_CREDENTIALS_FILE');
    }
  }

  private async accessToken(credentials: ServiceAccount): Promise<string> {
    if (this.token?.fingerprint === credentials.fingerprint &&
        this.token.expires > Date.now() + 60_000) return this.token.value;
    if (this.renewing?.fingerprint === credentials.fingerprint) return this.renewing.promise;
    const promise = this.renew(credentials);
    this.renewing = { fingerprint: credentials.fingerprint, promise };
    try { return await promise; }
    finally { if (this.renewing?.promise === promise) this.renewing = undefined; }
  }

  private async renew(credentials: ServiceAccount): Promise<string> {
    const issued = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: credentials.email, scope: adsScope, aud: tokenUrl, iat: issued, exp: issued + 3600,
    })}`;
    const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), credentials.privateKey).toString('base64url')}`;
    let response: Response;
    let data: Record<string, unknown>;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        signal: AbortSignal.timeout(30_000),
      });
      data = await response.json() as Record<string, unknown>;
    } catch {
      throw new BadGatewayException('Google 服务账号授权请求失败或超时，请检查网络后重试');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new BadGatewayException('Google 服务账号授权响应格式无效');
    const expires = Number(data.expires_in);
    if (!response.ok || typeof data.access_token !== 'string' || !data.access_token ||
        !Number.isFinite(expires) || expires <= 0)
      throw new BadGatewayException('Google 服务账号授权失败，请检查 credentials.json 中的密钥是否有效');
    this.token = {
      value: data.access_token,
      expires: Date.now() + expires * 1000,
      fingerprint: credentials.fingerprint,
    };
    return this.token.value;
  }

  private async search(customerId: string, managerId: string, token: string, query: string) {
    const rows: AdsRow[] = [];
    const pageTokens = new Set<string>();
    let pageToken: string | undefined;
    do {
      let response: Response;
      let data: Record<string, unknown>;
      try {
        response = await fetch(`https://googleads.googleapis.com/${this.config.adsApiVersion}/customers/${customerId}/googleAds:search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'login-customer-id': managerId,
          },
          body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
          signal: AbortSignal.timeout(30_000),
        });
        data = await response.json() as Record<string, unknown>;
      } catch {
        throw new BadGatewayException(`Google Ads 账户 ${customerId} 查询失败或超时，成本未更新，请检查网络后重试`);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new BadGatewayException('Google Ads 返回的数据格式无效，成本未更新');
      if (!response.ok || data.error) {
        if (response.status === 401) this.token = undefined;
        // Never forward Google response messages: they can contain request headers or credential data.
        const serialized = JSON.stringify(data.error || {});
        const advice = Object.entries(errorAdvice).find(([code]) => serialized.includes(`"${code}"`))?.[1];
        throw new BadGatewayException(`Google Ads 账户 ${customerId} 查询失败（HTTP ${response.status}），成本未更新。${advice || '请检查 Cloud 项目 API 访问级别、服务账号读取权限及经理号配置'}`);
      }
      if (!data || typeof data !== 'object' ||
          (data.results !== undefined && !Array.isArray(data.results)) ||
          (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string'))
        throw new BadGatewayException('Google Ads 返回的数据格式无效，成本未更新');
      if ((data.results as unknown[] | undefined)?.some(row => !row || typeof row !== 'object' || Array.isArray(row)))
        throw new BadGatewayException('Google Ads 返回的数据格式无效，成本未更新');
      rows.push(...((data.results || []) as AdsRow[]));
      pageToken = (data.nextPageToken || undefined) as string | undefined;
      if (pageToken && pageTokens.has(pageToken))
        throw new BadGatewayException('Google Ads 返回了重复的分页标记，成本未更新，请重试');
      if (pageToken) pageTokens.add(pageToken);
    } while (pageToken);
    return rows;
  }
}

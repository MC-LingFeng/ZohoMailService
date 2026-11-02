import { ConflictException, Injectable } from '@nestjs/common';
import { GoogleAdsClient, CampaignCost } from './google-ads';
import { MailStore } from './store';
import { RebateCostIssue, RebateCostRefresh, RebateCostTarget } from './rebates.types';

// Sum integer micros before rounding to cents, without floating-point drift.
function usdCents(campaigns: CampaignCost[]): number | null {
  if (campaigns.some((campaign) => !/^\d+$/.test(campaign.costMicros))) return null;
  const micros = campaigns.reduce((sum, campaign) => sum + BigInt(campaign.costMicros), 0n);
  const cents = (micros + 5_000n) / 10_000n;
  return cents <= 100_000_000_000_000n ? Number(cents) : null;
}

function allocate(targets: RebateCostTarget[], cents: number) {
  const mailboxes = new Map<string, RebateCostTarget[]>();
  for (const target of targets)
    mailboxes.set(target.accountId, [...(mailboxes.get(target.accountId) || []), target]);
  const groups = [...mailboxes].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return groups.flatMap(([, rows], index) => {
    const share = Math.floor(cents / groups.length) + Number(index < cents % groups.length);
    return rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((target, row) => ({
      target,
      costCents: Math.floor(share / rows.length) + Number(row < share % rows.length),
    }));
  });
}

@Injectable()
export class RebateCostsService {
  private refreshing = false;

  constructor(
    private readonly store: MailStore,
    private readonly ads: GoogleAdsClient,
  ) {}

  async refresh(): Promise<RebateCostRefresh> {
    if (this.refreshing) throw new ConflictException('广告消费正在刷新，请稍候');
    this.refreshing = true;
    try {
      const targets = this.store.rebateCostTargets();
      const offers = new Map<string, RebateCostTarget[]>();
      const issues: RebateCostIssue[] = [];
      for (const target of targets) {
        const name = target.offerName.trim();
        if (!name) continue;
        offers.set(name, [...(offers.get(name) || []), target]);
      }
      if (targets.some((target) => !target.offerName.trim())) issues.push({
        offerName: '', reason: 'empty_offer', message: '未填写 Offer 名称的记录已跳过',
      });
      const campaigns = new Map<string, CampaignCost[]>();
      // Read every account before writing anything; an incomplete hierarchy could hide a name collision.
      if (offers.size) for (const campaign of await this.ads.campaignCosts()) {
        const name = campaign.campaignName.trim();
        campaigns.set(name, [...(campaigns.get(name) || []), campaign]);
      }
      const updates: { target: RebateCostTarget; costCents: number }[] = [];
      for (const [offerName, rows] of offers) {
        const matches = campaigns.get(offerName) || [];
        let reason = '';
        let message = '';
        if (!matches.length) {
          reason = 'not_found';
          message = '未找到名称完全一致的广告系列，已保留原成本';
        } else if (matches.some((campaign) => campaign.currencyCode !== 'USD')) {
          reason = 'non_usd';
          message = '匹配的广告账户包含非 USD 币种，尚未配置美元换算，已保留原成本';
        } else {
          const costCents = usdCents(matches);
          if (costCents === null) {
            reason = 'invalid_cost';
            message = '广告消费金额格式无效或超出保存范围，已保留原成本';
          } else updates.push(...allocate(rows, costCents));
        }
        if (reason) issues.push({ offerName, reason, message });
      }
      const refreshedAt = new Date().toISOString();
      const saved = this.store.saveRebateCosts(updates, refreshedAt);
      return {
        currency: 'USD', refreshedAt, totalOffers: offers.size,
        updatedOffers: saved.updatedOffers, updatedRecords: saved.updatedRecords,
        issues: [...issues, ...saved.issues],
      };
    } finally {
      this.refreshing = false;
    }
  }
}

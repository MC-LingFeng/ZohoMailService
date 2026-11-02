export interface RebateInput {
  accountId: string;
  siteName: string;
  domain: string;
  registeredAt: string;
  offerName: string;
  totalRevenue: number;
  totalCost: number;
  settled: boolean;
  settlementCycle: string;
  banned: boolean;
  ip: string;
}

export interface RebateRecord extends RebateInput {
  id: string;
  accountEmail: string;
  accountName: string;
  accountGroup: string;
  conversionRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface RebateComparison {
  accountId: string;
  accountEmail: string;
  accountName: string;
  siteName: string;
  domain: string;
  offerName: string;
  totalRevenue: number;
  settledRevenue: number;
  unsettledRevenue: number;
  totalCost: number;
  conversionRate: number;
  recordCount: number;
}

export interface RebateQuery {
  search: string;
  accountId: string;
  settled: 'all' | 'yes' | 'no';
  banned: 'all' | 'yes' | 'no';
  page: number;
  pageSize: number;
}

export interface RebateList {
  records: RebateRecord[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    totalRevenue: number;
    settledRevenue: number;
    unsettledRevenue: number;
    totalCost: number;
    conversionRate: number;
    recordCount: number;
    accountCount: number;
  };
  comparison: RebateComparison[];
}

export interface RebateOptions {
  siteNames: string[];
  domains: string[];
  offerNames: string[];
}

export interface RebateCostTarget {
  id: string;
  accountId: string;
  offerName: string;
  costCents: number;
  updatedAt: string;
}

export interface RebateCostIssue {
  offerName: string;
  reason: string;
  message: string;
}

export interface RebateCostRefresh {
  currency: 'USD';
  refreshedAt: string;
  totalOffers: number;
  updatedOffers: number;
  updatedRecords: number;
  issues: RebateCostIssue[];
}

export function rebateRate(cost: number, revenue: number) {
  return revenue > 0 ? Math.round((cost / revenue) * 10000) / 100 : 0;
}

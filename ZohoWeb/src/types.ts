export type Folder = 'inbox' | 'spam' | 'sent';
export interface AppStatus {
  name: string;
  mode: 'demo' | 'live';
  oauthConfigured: boolean;
  manualCredentialsSupported?: boolean;
  authenticated: boolean;
}

export interface SettingsField {
  key: string;
  label: string;
  comment?: string;
  value: string | null;
  secret: boolean;
  configured: boolean;
  readOnly: boolean;
  reason?: string;
}

export interface AppSettings {
  fileName: string;
  revision: string;
  restartRequired: boolean;
  fields: SettingsField[];
}
export interface Account {
  id: string;
  email: string;
  name: string;
  group: string;
  color: string;
  status: 'connected' | 'reauthorize' | 'error';
  unread: number;
  lastSyncedAt: string | null;
  hasOAuthCredentials?: boolean;
  oauthSource?: 'account' | 'legacy' | 'none';
}
export interface MailMessage {
  id: string;
  accountId: string;
  folderId: string;
  folder: Folder;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  preview: string;
  receivedAt: string;
  isRead: boolean;
  hasAttachment: boolean;
}
export interface MailDetail extends MailMessage {
  content: string;
  format: 'html' | 'plaintext';
}
export interface Overview {
  accountCount: number;
  connectedCount: number;
  unreadCount: number;
  sentToday: number;
  lastSyncedAt: string | null;
}
export interface Activity {
  id: string;
  type: 'connect' | 'sync' | 'send';
  accountEmail: string;
  title: string;
  createdAt: string;
}
export interface MailList {
  messages: MailMessage[];
  hasMore: boolean;
  cached: boolean;
}

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

export interface RebateOptions {
  siteNames: string[];
  domains: string[];
  offerNames: string[];
}

export interface RebateCostRefresh {
  currency: 'USD';
  refreshedAt: string;
  totalOffers: number;
  updatedOffers: number;
  updatedRecords: number;
  issues: Array<{
    offerName: string;
    reason: string;
    message: string;
  }>;
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

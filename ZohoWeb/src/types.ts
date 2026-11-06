export type Folder = 'inbox' | 'spam' | 'sent' | 'other';
export interface MailFolder {
  id: string;
  name: string;
  path: string;
  type: Folder;
}
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
  provider?: 'zoho' | 'outlook';
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
  fingerprintBrowserId?: string;
  accountEmail?: string;
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
  accounts: RebateAccountOption[];
  siteNames: string[];
  domains: string[];
  offerNames: string[];
}

export interface RebateAccountOption {
  id: string;
  email: string;
  name: string;
  group: string;
  unknown: boolean;
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
  fingerprintBrowserId: string;
  fingerprintBrowserExternalId: string;
  fingerprintBrowserSerialNumber: string;
  accountEmail: string;
  accountName: string;
  accountGroup: string;
  accountUnknown: boolean;
  conversionRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface RebateComparison {
  accountId: string;
  accountEmail: string;
  accountName: string;
  accountUnknown: boolean;
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

export interface FingerprintBrowserInput {
  serialNumber: string;
  browserId: string;
  windowName: string;
  proxyInfo: string;
  accountIds: string[];
}

export interface FingerprintBrowserAccount extends RebateAccountOption {
  rebates: Array<{ id: string; offerName: string; siteName: string; domain: string }>;
}

export interface FingerprintBrowserRecord extends FingerprintBrowserInput {
  id: string;
  accounts: FingerprintBrowserAccount[];
  createdAt: string;
  updatedAt: string;
}

export interface FingerprintBrowserOption {
  id: string;
  browserId: string;
  serialNumber: string;
  windowName: string;
}

export interface FingerprintBrowserOptions {
  browsers: FingerprintBrowserOption[];
  accounts: FingerprintBrowserAccount[];
}

export interface FingerprintBrowserList {
  records: FingerprintBrowserRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FingerprintBrowserImportRow extends Omit<FingerprintBrowserInput, 'accountIds'> {
  accountIds?: string[];
}

export interface FingerprintBrowserImportPreview {
  records: FingerprintBrowserImportRow[];
  count: number;
}

export interface FingerprintBrowserImportResult {
  imported: number;
  removed: number;
  unlinkedRebates: number;
}

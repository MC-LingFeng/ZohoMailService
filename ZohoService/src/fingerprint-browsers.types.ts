import { RebateAccountOption } from './rebates.types';

export interface FingerprintBrowserInput {
  serialNumber: string;
  browserId: string;
  windowName: string;
  proxyInfo: string;
  accountIds: string[];
}

export type FingerprintBrowserImportInput = Omit<FingerprintBrowserInput, 'accountIds'> & {
  accountIds?: string[];
};

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

export interface FingerprintBrowserQuery {
  search: string;
  page: number;
  pageSize: number;
}

export interface FingerprintBrowserList {
  records: FingerprintBrowserRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FingerprintBrowserOptions {
  browsers: FingerprintBrowserOption[];
  accounts: FingerprintBrowserAccount[];
}

export interface FingerprintBrowserImportResult {
  imported: number;
  removed: number;
  unlinkedRebates: number;
}

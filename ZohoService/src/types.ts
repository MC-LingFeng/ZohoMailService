export type Folder = 'inbox' | 'spam' | 'sent';
export type AccountStatus = 'connected' | 'reauthorize' | 'error';
export interface Account {
  id: string;
  email: string;
  name: string;
  group: string;
  color: string;
  status: AccountStatus;
  unread: number;
  lastSyncedAt: string | null;
  hasOAuthCredentials?: boolean;
  oauthSource?: 'account' | 'legacy' | 'none';
}
export interface StoredAccount extends Account {
  zohoAccountId: string;
  encryptedRefreshToken: string | null;
  clientId?: string;
  encryptedClientSecret?: string;
}
export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}
export interface PendingBinding {
  stateHash: string;
  email: string;
  clientId: string;
  encryptedClientSecret: string;
  expiresAt: number;
  accountId?: string;
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
export interface Activity {
  id: string;
  type: 'connect' | 'sync' | 'send';
  accountEmail: string;
  title: string;
  createdAt: string;
}

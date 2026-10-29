export type Folder = 'inbox' | 'spam' | 'sent';
export interface AppStatus {
  name: string;
  mode: 'demo' | 'live';
  oauthConfigured: boolean;
  manualCredentialsSupported?: boolean;
  authenticated: boolean;
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

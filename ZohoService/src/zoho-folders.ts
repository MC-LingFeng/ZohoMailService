import { BadGatewayException } from '@nestjs/common';
import { Folder, MailFolder } from './types';

const builtinTypes: Record<string, Folder> = { inbox: 'inbox', spam: 'spam', sent: 'sent' };
const labels: Record<string, string> = {
  inbox: '收件箱', spam: '垃圾邮件', sent: '已发送',
  notification: '通知', notifications: '通知', zmnotification: '通知',
  newsletter: '订阅', newsletters: '订阅', zmnewsletter: '订阅',
  trash: '废纸篓', archive: '归档', drafts: '草稿', outbox: '发件箱',
  templates: '模板', snoozed: '稍后处理',
};

// Zoho's custom folders can also have folderType=Inbox; prefer their exact path.
// https://www.zoho.com/mail/help/api/get-all-folder-details.html
export function normalizeZohoFolders(rows: unknown): MailFolder[] {
  if (!Array.isArray(rows)) throw new BadGatewayException('Zoho 返回了无效的文件夹列表');
  const seen = new Set<string>();
  const folders: MailFolder[] = [];
  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadGatewayException('Zoho 返回了无效的文件夹条目');
    const row = value as Record<string, unknown>;
    const id = typeof row.folderId === 'string' ? row.folderId.trim()
      : typeof row.folderId === 'number' && Number.isSafeInteger(row.folderId) && row.folderId > 0
        ? String(row.folderId) : '';
    if (!id || id.length > 256 || /[\0\r\n]/.test(id) ||
        ['folderName', 'path', 'folderType'].some((key) => row[key] !== undefined && row[key] !== null && typeof row[key] !== 'string'))
      throw new BadGatewayException('Zoho 返回了无效的文件夹标识或资料');
    const path = typeof row.path === 'string' && row.path.trim() ? row.path : '';
    const suppliedName = typeof row.folderName === 'string' && row.folderName.trim() ? row.folderName : '';
    const nameKey = suppliedName.toLowerCase();
    const pathKey = /^\/[^/]+$/.test(path) ? path.slice(1).toLowerCase() : '';
    let type: Folder = 'other';
    if (path) type = builtinTypes[pathKey] || 'other';
    else {
      type = builtinTypes[nameKey] || 'other';
      if (type === 'other' && typeof row.folderType === 'string') {
        const declared = row.folderType.toLowerCase();
        if (declared === 'spam' || declared === 'sent') type = declared;
      }
    }
    let name = suppliedName || path.split('/').filter(Boolean).at(-1) || `文件夹 ${id}`;
    if (type !== 'other') name = labels[type];
    else if (!path && labels[nameKey]) name = labels[nameKey];
    else if (labels[pathKey] && (!suppliedName || labels[nameKey] === labels[pathKey])) name = labels[pathKey];
    // Keep all folder kinds, including drafts and user-created nested folders.
    if (!seen.has(id)) {
      seen.add(id);
      folders.push({ id, name, path, type });
    }
  }
  return folders;
}

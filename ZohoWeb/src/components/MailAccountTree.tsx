import { useEffect, useId, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Mail,
  Search,
  X,
} from 'lucide-react';
import type { Account } from '../types';

interface MailAccountTreeProps {
  accounts: Account[];
  selectedId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}

const groupName = (account: Account) => account.group.trim() || '未分组';
const normalize = (value: string) => value.trim().toLocaleLowerCase();

export default function MailAccountTree({
  accounts,
  selectedId,
  disabled = false,
  onSelect,
}: MailAccountTreeProps) {
  const id = useId();
  const [search, setSearch] = useState('');
  const query = normalize(search);
  const selectedGroup = accounts.find((account) => account.id === selectedId);
  const activeGroup = selectedGroup ? groupName(selectedGroup) : '';
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeGroup ? [activeGroup] : []),
  );
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    if (!activeGroup) return;
    setExpanded((previous) => {
      if (previous.has(activeGroup)) return previous;
      return new Set(previous).add(activeGroup);
    });
    setSearchCollapsed((previous) => {
      if (!previous.has(activeGroup)) return previous;
      const next = new Set(previous);
      next.delete(activeGroup);
      return next;
    });
  }, [selectedId, activeGroup]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, Account[]>();
    for (const account of accounts) {
      const name = groupName(account);
      const members = byGroup.get(name);
      if (members) members.push(account);
      else byGroup.set(name, [account]);
    }
    return [...byGroup].flatMap(([name, members]) => {
      const visible =
        !query || normalize(name).includes(query)
          ? members
          : members.filter((account) =>
              [account.name, account.email].some((value) =>
                normalize(value).includes(query),
              ),
            );
      return visible.length ? [{ name, accounts: visible }] : [];
    });
  }, [accounts, query]);

  const matchCount = groups.reduce(
    (total, group) => total + group.accounts.length,
    0,
  );
  const updateSearch = (value: string) => {
    setSearch(value);
    setSearchCollapsed(new Set());
  };
  const toggle = (name: string) => {
    const update = (previous: Set<string>) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    };
    if (query) setSearchCollapsed(update);
    else setExpanded(update);
  };

  return (
    <aside className="mail-account-tree" aria-label="邮箱账号选择">
      <div className="mail-account-tree-header">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold">
            <Folder size={15} className="text-accent" aria-hidden="true" />
            邮箱分组
          </h2>
          <span className="badge-muted" title="已接入邮箱总数">
            {accounts.length}
          </span>
        </div>
        <div className="search-field mt-3 bg-surface-muted">
          <Search size={13} className="shrink-0" aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索邮箱名称、分组或邮箱地址"
            placeholder="搜索名称、分组或邮箱…"
            value={search}
            onChange={(event) => updateSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="icon-button size-6"
              aria-label="清除邮箱搜索"
              onClick={() => updateSearch('')}
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        {query && (
          <p className="mt-2 text-[10px] text-subtle" role="status">
            找到 {matchCount} 个邮箱
          </p>
        )}
      </div>
      <nav className="mail-account-tree-body" aria-label="按分组选择邮箱">
        {groups.length ? (
          <ul className="space-y-1">
            {groups.map((group, index) => {
              const open = query
                ? !searchCollapsed.has(group.name)
                : expanded.has(group.name);
              const groupId = `${id}-group-${index}`;
              return (
                <li key={group.name}>
                  <button
                    type="button"
                    className={`mail-account-group ${group.name === activeGroup ? 'text-accent' : ''}`}
                    aria-expanded={open}
                    aria-controls={groupId}
                    onClick={() => toggle(group.name)}
                  >
                    {open ? (
                      <ChevronDown
                        size={13}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        size={13}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <Folder size={14} className="shrink-0" aria-hidden="true" />
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={group.name}
                    >
                      {group.name}
                    </span>
                    <span className="text-[10px] font-normal tabular-nums text-subtle">
                      {group.accounts.length}
                    </span>
                  </button>
                  <ul
                    id={groupId}
                    className="mail-account-children"
                    hidden={!open}
                  >
                    {open &&
                      group.accounts.map((account) => {
                        const selected = account.id === selectedId;
                        const status =
                          account.status === 'connected'
                            ? '已连接'
                            : account.status === 'reauthorize'
                              ? '需要重新授权'
                              : '连接异常';
                        return (
                          <li key={account.id}>
                            <button
                              type="button"
                              className={`mail-account-node ${selected ? 'mail-account-node-active' : ''}`}
                              aria-current={selected ? 'true' : undefined}
                              disabled={disabled}
                              onClick={() => onSelect(account.id)}
                              title={`${account.name || account.email}\n${account.email}`}
                            >
                              <Mail
                                size={14}
                                className="mt-0.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="block min-w-0 flex-1">
                                <span className="block truncate text-[11px] font-medium">
                                  {account.name || account.email}
                                </span>
                                <span className="mt-1 block truncate text-[10px] font-normal text-subtle">
                                  {account.email}
                                </span>
                              </span>
                              <span className="flex shrink-0 flex-col items-end gap-2 pt-1">
                                <span
                                  className={`size-1.5 rounded-full ${account.status === 'connected' ? 'bg-brand-400' : account.status === 'reauthorize' ? 'bg-warning-ink' : 'bg-danger-ink'}`}
                                  title={status}
                                >
                                  <span className="sr-only">{status}</span>
                                </span>
                                {account.unread > 0 && (
                                  <span
                                    className="mail-account-unread"
                                    aria-label={`${account.unread} 封缓存未读邮件`}
                                  >
                                    {account.unread > 999
                                      ? '999+'
                                      : account.unread}
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-3 py-8 text-center">
            <Search
              size={23}
              className="mx-auto mb-3 text-subtle"
              aria-hidden="true"
            />
            <p className="text-xs text-body">
              {query ? '没有匹配的邮箱' : '还没有邮箱分组'}
            </p>
            <p className="mt-2 text-[10px] leading-5 text-subtle">
              {query
                ? '试试其他名称、分组或邮箱地址。'
                : '添加邮箱后会自动按分组展示。'}
            </p>
            {query && (
              <button
                type="button"
                className="btn-quiet mt-3 text-accent"
                onClick={() => updateSearch('')}
              >
                清除搜索
              </button>
            )}
          </div>
        )}
      </nav>
      {disabled && (
        <p
          className="shrink-0 border-t border-line-soft px-4 py-3 text-[10px] leading-5 text-subtle"
          role="status"
        >
          当前邮箱正在刷新，完成后即可切换。
        </p>
      )}
    </aside>
  );
}

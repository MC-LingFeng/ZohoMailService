import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Folder,
  KeyRound,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, dateLabel } from '../api';
import {
  Avatar,
  EmptyState,
  ErrorNotice,
  Modal,
  PageTitle,
  Spinner,
} from '../components/ui';
import { useWorkspace } from '../workspace';
import type { Account } from '../types';

const hasSavedCredentials = (account?: Account | null) =>
  account?.oauthSource === 'account' || account?.oauthSource === 'legacy';

export default function AccountsPage() {
  const { accounts, status, loading, refresh, toast } = useWorkspace();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('全部分组');
  const [page, setPage] = useState(0);
  const [connect, setConnect] = useState(false);
  const [bindingAccount, setBindingAccount] = useState<Account | null>(null);
  const [bindingEmail, setBindingEmail] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [useSavedCredentials, setUseSavedCredentials] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('connected')) {
      toast('邮箱授权成功，已加入你的工作区。');
      void refresh();
      setParams({}, { replace: true });
    }
    if (params.get('error')) {
      setError(`授权未完成：${params.get('error')}`);
      setConnect(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams, refresh, toast]);
  const groups = [
    '全部分组',
    ...new Set(accounts.map((account) => account.group || '未分组')),
  ];
  const filtered = useMemo(
    () =>
      accounts.filter(
        (account) =>
          (group === '全部分组' || (account.group || '未分组') === group) &&
          `${account.name} ${account.email} ${account.group}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [accounts, search, group],
  );
  useEffect(() => {
    setPage(0);
  }, [search, group]);
  const maxPage = Math.max(0, Math.ceil(filtered.length / 9) - 1);
  const currentPage = Math.min(page, maxPage);
  const visible = filtered.slice(currentPage * 9, (currentPage + 1) * 9);
  const openBinding = (account?: Account, replaceCredentials = false) => {
    setBindingAccount(account || null);
    setBindingEmail(account?.email || '');
    setClientId('');
    setClientSecret('');
    setUseSavedCredentials(
      Boolean(account && !replaceCredentials && hasSavedCredentials(account)),
    );
    setEditing(null);
    setError('');
    setConnect(true);
  };
  const closeBinding = () => {
    if (busy) return;
    setClientSecret('');
    setClientId('');
    setBindingEmail('');
    setBindingAccount(null);
    setUseSavedCredentials(false);
    setConnect(false);
  };
  const startConnect = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const reuse = useSavedCredentials && bindingAccount;
      const path = reuse
        ? `/accounts/${encodeURIComponent(bindingAccount.id)}/reauthorize`
        : '/auth/zoho/url';
      const { url } = await api<{ url: string }>(path, {
        method: 'POST',
        body: JSON.stringify(
          reuse
            ? {}
            : {
                email: bindingEmail.trim(),
                clientId: clientId.trim(),
                clientSecret: clientSecret.trim(),
              },
        ),
      });
      const target = new URL(url);
      if (target.origin !== 'https://accounts.zoho.com')
        throw new Error('授权地址不正确');
      setClientSecret('');
      window.location.assign(target.href);
    } catch (error) {
      setError(error instanceof Error ? error.message : '无法开始授权');
      setBusy(false);
    }
  };
  const edit = (account: Account) => {
    setEditing(account);
    setName(account.name);
    setNewGroup(account.group);
    setDisconnecting(false);
    setError('');
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      await api(`/accounts/${encodeURIComponent(editing.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), group: newGroup.trim() }),
      });
      setEditing(null);
      toast('账号资料已更新。');
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/accounts/${encodeURIComponent(editing.id)}`, {
        method: 'DELETE',
      });
      setEditing(null);
      toast('账号已从 ZoHome 移除。');
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : '移除失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-wrap">
      <PageTitle
        eyebrow="Account management"
        title="每个邮箱，都各就各位。"
        description="在同一个工作区管理账号，按用途分组，随时切换你的发件身份。"
        action={
          <button className="btn-primary" onClick={() => openBinding()}>
            <Plus size={15} />
            添加邮箱
          </button>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-x-7 gap-y-3 rounded-xl border border-line bg-surface px-5 py-4">
        <span className="flex items-center gap-2 text-xs text-muted">
          <Mail size={16} className="text-brand-500" />
          全部邮箱 <b className="text-ink">{accounts.length}</b>
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="size-1.5 rounded-full bg-brand-500" />
          连接正常{' '}
          <b className="text-ink">
            {
              accounts.filter((account) => account.status === 'connected')
                .length
            }
          </b>
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          <Folder size={15} className="text-subtle" />
          自定义分组 <b className="text-ink">{groups.length - 1}</b>
        </span>
        <span className="ml-auto hidden text-[10px] text-subtle sm:block">
          账号列表分页展示 · 邮件按需加载
        </span>
      </div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="search-field w-full sm:w-80">
          <Search size={15} />
          <input
            aria-label="搜索邮箱账号"
            placeholder="搜索邮箱、名称或分组…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          className="input w-auto min-w-32"
          aria-label="筛选账号分组"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
        >
          {groups.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      {loading ? (
        <Spinner />
      ) : visible.length ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((account) => (
            <article className="panel p-5" key={account.id}>
              <div className="flex items-start justify-between">
                <Avatar name={account.name || account.email} />
                <button
                  className="icon-button -mr-2 -mt-2"
                  onClick={() => edit(account)}
                  aria-label={`管理 ${account.email}`}
                >
                  <MoreHorizontal size={19} />
                </button>
              </div>
              <div className="mt-4">
                <h2 className="truncate text-sm font-semibold">
                  {account.name || account.email}
                </h2>
                <p className="mt-1.5 truncate text-[11px] text-subtle">
                  {account.email}
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="badge-muted">
                  <Folder size={10} />
                  {account.group || '未分组'}
                </span>
                {account.status === 'connected' ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                    <CheckCircle2 size={11} />
                    已连接
                  </span>
                ) : (
                  <span className="badge-amber">
                    {account.status === 'reauthorize'
                      ? '需要重新授权'
                      : '连接异常'}
                  </span>
                )}
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-line-soft pt-4">
                <span className="text-[10px] text-subtle">
                  {account.unread > 0 ? (
                    <>
                      <b className="font-medium text-accent">
                        {account.unread}
                      </b>{' '}
                      封缓存未读
                    </>
                  ) : (
                    '暂无缓存未读'
                  )}
                </span>
                <Link
                  to={`/mail?account=${encodeURIComponent(account.id)}`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-accent"
                >
                  打开邮箱
                  <ArrowRight size={13} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            title={
              accounts.length ? '没有找到匹配的邮箱' : '给你的邮箱一个新家'
            }
            description={
              accounts.length
                ? '试试其他关键词，或切换账号分组。'
                : '连接第一个 Zoho 邮箱，即可在这里统一管理。'
            }
            action={
              !accounts.length ? (
                <button className="btn-primary" onClick={() => openBinding()}>
                  <Plus size={14} />
                  添加邮箱
                </button>
              ) : (
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setSearch('');
                    setGroup('全部分组');
                  }}
                >
                  清除筛选
                </button>
              )
            }
          />
        </div>
      )}
      <div className="mt-5 flex items-center justify-between text-[11px] text-subtle">
        <span>
          共 {filtered.length} 个邮箱
          {filtered.length > 0 &&
            ` · 第 ${currentPage + 1} / ${maxPage + 1} 页`}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="icon-button"
            aria-label="上一页账号"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="下一页账号"
            disabled={currentPage >= maxPage}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      <div className="notice mt-6">
        <ShieldCheck size={17} className="mt-1 shrink-0" />
        <p>
          通过 Zoho 官方授权连接，ZoHome
          不保存邮箱登录密码。每个独立账号需要分别授权；日常切换时无需重复登录。
          <Link
            to="/guide#connect"
            className="ml-2 font-medium underline underline-offset-4"
          >
            查看接入指南
          </Link>
        </p>
      </div>
      <Modal
        open={connect}
        onClose={closeBinding}
        title={bindingAccount ? '更新邮箱授权' : '绑定一个新邮箱'}
      >
        <form
          className="space-y-5 p-6"
          onSubmit={(event) => void startConnect(event)}
        >
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent-muted text-accent">
            <KeyRound size={24} strokeWidth={1.5} />
          </span>
          <div>
            <h3 className="text-base font-semibold">为这个邮箱保存应用配置</h3>
            <p className="mt-2 text-xs leading-6 text-muted">
              填写邮箱及对应的 OAuth 应用信息，再前往 Zoho
              授权。授权成功后，应用配置会与这个邮箱关联保存。
            </p>
          </div>
          {status.mode === 'demo' && (
            <div className="notice">
              当前为演示模式，不会保存真实应用密钥。切换真实模式后，即可在这里填写并绑定邮箱。
            </div>
          )}
          <fieldset
            className="space-y-4"
            disabled={busy || status.mode === 'demo'}
          >
            <label className="block">
              <span className="field-label">要绑定的邮箱</span>
              <input
                className="input"
                type="email"
                required
                maxLength={254}
                value={bindingEmail}
                readOnly={Boolean(bindingAccount)}
                onChange={(event) => setBindingEmail(event.target.value)}
                placeholder="name@zohomail.com"
                autoComplete="off"
              />
              <span className="mt-1.5 block text-[10px] text-subtle">
                请填写此账号的主邮箱地址，授权时会核对。
              </span>
            </label>
            {useSavedCredentials ? (
              <div className="rounded-xl border border-accent-line bg-accent-muted/60 p-4">
                <p className="flex items-center gap-2 text-xs font-medium text-accent">
                  <ShieldCheck size={15} />
                  使用此邮箱已保存的应用配置
                </p>
                <p className="mt-2 text-[11px] leading-6 text-muted">
                  {bindingAccount?.oauthSource === 'legacy'
                    ? '本次使用现有服务端配置完成授权，成功后会与此邮箱关联保存。'
                    : '系统将读取数据库中关联的配置完成授权，无需再次填写密钥。'}
                </p>
                <button
                  className="btn-quiet mt-2 px-0 text-accent"
                  type="button"
                  onClick={() => setUseSavedCredentials(false)}
                >
                  改用新的应用配置
                  <ArrowRight size={12} />
                </button>
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="field-label">Client ID</span>
                  <input
                    className="input font-mono"
                    required
                    maxLength={256}
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder="Zoho 应用的 Client ID"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="block">
                  <span className="field-label">Client Secret</span>
                  <input
                    className="input font-mono"
                    type="password"
                    required
                    maxLength={1024}
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    placeholder="Zoho 应用的 Client Secret"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                {bindingAccount && hasSavedCredentials(bindingAccount) && (
                  <button
                    className="btn-quiet px-0 text-accent"
                    type="button"
                    onClick={() => {
                      setUseSavedCredentials(true);
                      setClientSecret('');
                      setClientId('');
                    }}
                  >
                    使用此邮箱已保存的配置
                  </button>
                )}
              </>
            )}
          </fieldset>
          <div className="rounded-xl bg-surface-muted p-4 text-[11px] leading-6 text-muted">
            <p>
              Client Secret
              会加密保存在服务端。多个邮箱可以填写同一组应用信息，也可以各自使用不同的应用。
            </p>
            <p className="mt-2">
              请在 Zoho
              授权页登录上面填写的邮箱，系统会核对实际授权账号。应用须使用
              Server-based Application，回调地址与使用指南一致。
            </p>
          </div>
          {error && <ErrorNotice message={error} />}
          <div className="flex items-center justify-between border-t pt-5">
            <Link
              to="/guide#connect"
              onClick={(event) => {
                if (busy) event.preventDefault();
                else closeBinding();
              }}
              aria-disabled={busy}
              className="text-xs text-accent hover:underline"
            >
              查看配置与授权步骤
            </Link>
            <button
              className="btn-primary"
              type="submit"
              disabled={busy || status.mode === 'demo'}
            >
              {busy
                ? '正在保存…'
                : useSavedCredentials
                  ? '前往 Zoho 授权'
                  : '保存并前往授权'}
              <ExternalLink size={13} />
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => {
          if (!busy) setEditing(null);
        }}
        title={disconnecting ? '移除邮箱连接' : '管理邮箱账号'}
      >
        <div className="p-6">
          {editing && (
            <>
              <div className="mb-6 flex items-center gap-3">
                <Avatar name={editing.name || editing.email} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {editing.email}
                  </p>
                  <p className="mt-1 text-[10px] text-subtle">
                    最近同步：{dateLabel(editing.lastSyncedAt, true)}
                  </p>
                </div>
              </div>
              {disconnecting ? (
                <div>
                  <p className="text-xs leading-7 text-muted">
                    确定从 ZoHome
                    移除这个账号？这会清除本地连接、缓存和关联的返利网记录。Zoho
                    邮箱及其中的邮件不会被删除。如需彻底撤销授权，可在 Zoho
                    的关联应用中操作。
                  </p>
                  <div className="mt-6 flex justify-end gap-2">
                    <button
                      className="btn-secondary"
                      onClick={() => setDisconnecting(false)}
                      disabled={busy}
                    >
                      返回
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => void disconnect()}
                      disabled={busy}
                    >
                      {busy ? '正在移除…' : '确认移除'}
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  className="space-y-5"
                  onSubmit={(event) => void save(event)}
                >
                  <label className="block">
                    <span className="field-label">显示名称</span>
                    <input
                      className="input"
                      required
                      maxLength={80}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">账号分组</span>
                    <input
                      className="input"
                      maxLength={80}
                      list="account-groups"
                      value={newGroup}
                      onChange={(event) => setNewGroup(event.target.value)}
                      placeholder="例如：工作邮箱、个人生活"
                    />
                    <datalist id="account-groups">
                      {groups.slice(1).map((item) => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                  </label>
                  <div className="rounded-xl border border-line bg-surface-muted p-4">
                    <p className="flex items-center gap-2 text-xs font-medium">
                      <KeyRound size={14} className="text-accent" />
                      OAuth 应用配置
                    </p>
                    <p className="mt-2 text-[11px] leading-6 text-muted">
                      {editing.oauthSource === 'account'
                        ? '已为此邮箱单独保存应用配置，密钥以加密形式存储。'
                        : editing.oauthSource === 'legacy'
                          ? '当前使用旧版服务端配置，可以更换为此邮箱独立保存的应用。'
                          : '为此邮箱填写应用信息并完成授权后，即可独立保存配置。'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-quiet px-0 text-accent"
                        onClick={() => openBinding(editing)}
                      >
                        重新授权此邮箱
                        <ExternalLink size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn-quiet text-accent"
                        onClick={() => openBinding(editing, true)}
                      >
                        更换应用配置
                        <ArrowRight size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t pt-5">
                    <button
                      type="button"
                      className="btn-quiet text-red-500 hover:bg-danger-surface hover:text-danger-ink"
                      onClick={() => setDisconnecting(true)}
                    >
                      <Trash2 size={13} />
                      移除连接
                    </button>
                    <button className="btn-primary" disabled={busy}>
                      {busy ? '保存中…' : '保存修改'}
                    </button>
                  </div>
                </form>
              )}
              {error && (
                <div className="mt-4">
                  <ErrorNotice message={error} />
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

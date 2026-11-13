import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BookOpen,
  Building2,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Fingerprint,
  Home,
  Inbox,
  LockKeyhole,
  LogOut,
  Menu,
  PanelLeftClose,
  Plus,
  ServerOff,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { ErrorNotice, Logo, Spinner } from './components/ui';
import ThemeSwitcher from './components/ThemeSwitcher';
import HomePage from './pages/HomePage';
import MailPage from './pages/MailPage';
import AccountsPage from './pages/AccountsPage';
import GuidePage from './pages/GuidePage';
import RebatesPage from './pages/RebatesPage';
import SettingsPage from './pages/SettingsPage';
import FingerprintBrowsersPage from './pages/FingerprintBrowsersPage';
import WorkspacesPage from './pages/WorkspacesPage';
import { useWorkspace, WorkspaceProvider } from './workspace';
import type { AppStatus, WorkspaceCatalog, WorkspaceSummary } from './types';

function Shell() {
  const { status, workspace, workspaces, switchWorkspace, accounts, error, refresh, reloadStatus } = useWorkspace();
  const location = useLocation();
  const [mobile, setMobile] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  useEffect(() => {
    setMobile(false);
    const anchor = location.hash
      ? document.getElementById(location.hash.slice(1))
      : null;
    if (anchor) anchor.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
  }, [location.pathname, location.hash]);
  useEffect(() => {
    if (mobile) {
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setMobile(false);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [mobile]);
  const navigation = [
    { to: '/', label: '系统首页', icon: Home },
    { to: '/mail', label: '邮件工作台', icon: Inbox },
    { to: '/accounts', label: '邮箱账号', icon: Users },
    { to: '/rebates', label: '返利网', icon: ChartNoAxesCombined },
    { to: '/fingerprint-browsers', label: '指纹浏览器', icon: Fingerprint },
    { to: '/workspaces', label: '工作区管理', icon: Building2 },
    { to: '/settings', label: '系统设置', icon: Settings },
    { to: '/guide', label: '使用指南', icon: BookOpen },
  ];
  const current =
    navigation.find((item) => item.to === location.pathname)?.label ||
    '页面未找到';
  useEffect(() => {
    document.title = `${current} · ${workspace.name} · ZoHome`;
  }, [current, workspace.name]);
  const logout = async () => {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await api('/session', { method: 'DELETE' });
      await reloadStatus();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : '退出失败');
    } finally {
      setLoggingOut(false);
    }
  };
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="fixed inset-0 z-30 bg-slate-950/25 backdrop-blur-xs lg:hidden"
          aria-label="关闭导航菜单"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={`sidebar ${mobile ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible lg:translate-x-0'}`}
      >
        <div className="flex items-center justify-between px-1">
          <Logo />
          <button
            className="icon-button lg:hidden"
            onClick={() => setMobile(false)}
            aria-label="收起菜单"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        <p className="mt-3 px-1 text-[12px] tracking-[0.08em] text-subtle">
          多邮箱，一个家。
        </p>
        <div className="mt-10 px-3.5 text-[12px] font-medium tracking-[0.16em] text-subtle">
          工作空间
        </div>
        <nav aria-label="主导航" className="mt-3 space-y-1.5">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              end={to === '/'}
              key={to}
              to={to}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'nav-active' : ''}`
              }
            >
              <Icon size={17} strokeWidth={1.7} />
              <span className="flex-1">{label}</span>
              {to === '/accounts' && (
                <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[12px] text-subtle">
                  {accounts.length}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="mb-6 rounded-xl border border-accent-line/80 bg-accent-muted/60 px-4 py-4">
            <span className="mb-2 flex items-center gap-2 text-[13px] font-medium text-accent">
              <Sparkles size={14} />
              从容处理每一封邮件
            </span>
            <p className="text-[12px] leading-5 text-accent/70">
              一个工作区，连接多个邮箱。
              <br />
              把时间留给更重要的事。
            </p>
          </div>
          <Link to="/guide#faq" className="nav-item py-2.5">
            <CircleHelp size={16} strokeWidth={1.6} />
            帮助与常见问题
            <ChevronRight size={12} className="ml-auto" />
          </Link>
          <div className="mt-5 flex items-center gap-3 border-t border-line-soft px-1 pt-5">
            <span className="flex size-9 items-center justify-center rounded-full bg-accent-muted text-sm font-semibold text-accent">
              ZH
            </span>
            <div className="flex-1">
              <p className="break-all text-[13px] font-medium">{workspace.name}</p>
              <p className="mt-1 text-[12px] text-subtle">
                {status.user?.username} · {workspace.role === 'owner' ? '所有者' : '成员'}
              </p>
            </div>
            <ShieldCheck size={15} className="text-accent" />
          </div>
        </div>
      </aside>
      <main className="lg:ml-60">
        <header className="topbar h-auto min-h-20 flex-wrap py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="icon-button -ml-2 lg:hidden"
              aria-label="展开菜单"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <label className="min-w-0"><span className="sr-only">切换工作区</span><select className="input max-w-[170px] py-2 text-[13px]" aria-label="切换工作区" value={workspace.id} onChange={(event) => switchWorkspace(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <ChevronRight size={12} className="hidden text-faint sm:block" />
            <span className="hidden text-[13px] font-medium text-muted sm:inline">
              {current}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3.5">
            <ThemeSwitcher />
            <span className={status.mode === 'demo' ? 'badge-amber' : 'badge'}>
              <span className="size-1 rounded-full bg-current" />
              {status.mode === 'demo' ? '演示模式' : '真实邮箱模式'}
            </span>
            <span className="hidden h-5 w-px bg-line sm:block" />
            <Link
              to="/guide"
              className="hidden items-center gap-1.5 text-[13px] text-muted sm:flex"
            >
              <BookOpen size={14} />
              快速上手
            </Link>
            {status.authenticated && (
              <button
                onClick={() => void logout()}
                disabled={loggingOut}
                className="icon-button"
                aria-label="退出登录"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </header>
        {(error || logoutError) && (
          <div className="mx-5 mt-5 md:mx-9">
            <ErrorNotice message={error || logoutError} />
            <button className="btn-quiet" onClick={() => void refresh()}>
              重新加载工作区
            </button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/mail" element={<MailPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/rebates" element={<RebatesPage />} />
          <Route path="/fingerprint-browsers" element={<FingerprintBrowsersPage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route
            path="*"
            element={
              <div className="page-wrap">
                <div className="panel py-20 text-center">
                  <p className="eyebrow">404</p>
                  <h1 className="mt-3 text-xl font-semibold">
                    这个页面还没有归处。
                  </h1>
                  <Link to="/" className="btn-primary mt-6">
                    返回首页
                  </Link>
                </div>
              </div>
            }
          />
        </Routes>
        <footer className="mx-5 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 py-5 text-[12px] text-subtle md:mx-9">
          <span>
            ZoHome © {new Date().getFullYear()} · 给每个邮箱，一个家。
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={11} className="text-accent" />
            Zoho Mail API · Microsoft Graph
            <span className="ml-2 text-faint">v0.1</span>
          </span>
        </footer>
      </main>
    </div>
  );
}

function LoginPage({ onLogin }: { onLogin: () => Promise<void> }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/session', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      await onLogin();
    } catch (error) {
      setError(error instanceof Error ? error.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="fixed top-4 right-4 z-20">
        <ThemeSwitcher />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="panel p-8">
          <span className="mb-5 flex size-11 items-center justify-center rounded-xl bg-accent-muted text-accent">
            <LockKeyhole size={22} strokeWidth={1.6} />
          </span>
          <h1 className="text-xl font-semibold">欢迎回到你的邮箱之家。</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            使用你的账号登录，进入有权访问的工作区。
          </p>
          <form
            className="mt-7 space-y-5"
            onSubmit={(event) => void submit(event)}
          >
            <label className="block">
              <span className="field-label">用户名</span>
              <input className="input" autoComplete="username" required autoFocus maxLength={80} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" />
            </label>
            <label className="block">
              <span className="field-label">密码</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="登录密码"
              />
            </label>
            {error && <ErrorNotice message={error} />}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? '正在验证…' : '进入工作区'}
            </button>
          </form>
          <p className="mt-6 text-[12px] leading-5 text-subtle">
            首次迁移后的管理员用户名为 admin，初始密码沿用原服务端 APP_PASSWORD。其他账号请联系管理员创建。
          </p>
        </div>
        <p className="mt-6 text-center text-[12px] text-subtle">
          通过邮箱官方授权连接 · 服务端加密保存授权
        </p>
      </div>
    </div>
  );
}

function WorkspaceAccess({ status, reloadStatus }: { status: AppStatus; reloadStatus: () => Promise<void> }) {
  const [catalog, setCatalog] = useState<WorkspaceCatalog | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const selected = useRef('');
  selected.current = selectedId;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const storageKey = `zohome:workspace:${status.user?.id || 'default'}`;
  const saveSelection = useCallback((id: string) => {
    setSelectedId(id);
    selected.current = id;
    try { sessionStorage.setItem(storageKey, id); } catch { /* Tab storage can be disabled. */ }
  }, [storageKey]);
  const reloadWorkspaces = useCallback(async (selectId?: string, signal?: AbortSignal) => {
    const result = await api<WorkspaceCatalog>('/workspaces', { signal });
    signal?.throwIfAborted();
    let stored = '';
    try { stored = sessionStorage.getItem(storageKey) || ''; } catch { /* Selection remains in memory. */ }
    const callbackWorkspace = new URLSearchParams(window.location.search).get('workspaceId');
    const preferred = [selectId, selected.current, callbackWorkspace, stored, result.defaultWorkspaceId, status.defaultWorkspaceId];
    const next = preferred.find((id) => id && result.workspaces.some((workspace) => workspace.id === id)) || result.workspaces[0]?.id || '';
    setCatalog(result);
    saveSelection(next);
  }, [saveSelection, status.defaultWorkspaceId, storageKey]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void reloadWorkspaces(undefined, controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '工作区列表读取失败');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadWorkspaces, attempt]);
  const workspace = catalog?.workspaces.find((item) => item.id === selectedId);
  if (loading) return <div className="min-h-screen bg-canvas px-6 py-20"><Spinner label="正在打开你的工作区" /></div>;
  if (workspace && catalog) return <WorkspaceProvider key={workspace.id} status={status} workspace={workspace} workspaces={catalog.workspaces} switchWorkspace={(id) => {
    if (catalog.workspaces.some((item) => item.id === id)) saveSelection(id);
  }} reloadWorkspaces={reloadWorkspaces} reloadStatus={reloadStatus}><Shell /></WorkspaceProvider>;
  return <div className="flex min-h-screen items-center justify-center p-6">
    <div className="w-full max-w-lg">
      <div className="mb-7 flex justify-center"><Logo /></div>
      <div className="panel p-7">
        <h1 className="text-xl font-semibold">{error && !catalog ? '工作区读取失败' : '创建你的第一个工作区'}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{status.user?.username}，工作区独立保存邮箱、浏览器、返利网记录及授权配置。</p>
        {error && <div className="mt-5"><ErrorNotice message={error} /></div>}
        {catalog ? <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); if (creating || !name.trim()) return; setCreating(true); setError(''); void api<WorkspaceSummary>('/workspaces', { method: 'POST', body: JSON.stringify({ name: name.trim() }) }).then((created) => reloadWorkspaces(created.id)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '工作区创建失败')).finally(() => setCreating(false)); }}>
          <label className="block"><span className="field-label">工作区名称</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} disabled={creating} placeholder="例如：我的团队" /></label>
          <button className="btn-primary w-full" disabled={creating || !name.trim()}><Plus size={15} />{creating ? '正在创建…' : '创建并进入'}</button>
        </form> : <button className="btn-primary mt-6" onClick={() => setAttempt((value) => value + 1)}>重新读取</button>}
        <button className="btn-quiet mt-4" onClick={() => void api('/session', { method: 'DELETE' }).then(reloadStatus).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '退出失败'))}><LogOut size={14} />退出登录</button>
      </div>
    </div>
  </div>;
}

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      setStatus(await api<AppStatus>('/status'));
    } catch (error) {
      setError(error instanceof Error ? error.message : '服务未连接');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const checkSession = () => {
      void load();
    };
    window.addEventListener('zohome:unauthorized', checkSession);
    return () =>
      window.removeEventListener('zohome:unauthorized', checkSession);
  }, [load]);
  if (error)
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="fixed top-4 right-4 z-20">
          <ThemeSwitcher />
        </div>
        <div className="panel w-full max-w-md p-8">
          <Logo />
          <ServerOff size={30} className="mt-8 text-brand-500" />
          <h1 className="mt-4 text-xl font-semibold">等待工作区服务连接</h1>
          <p className="mt-3 text-sm leading-7 text-muted">
            请重新启动
            ZoHome，并确认控制台显示服务已启动。若使用源码开发，可以在项目根目录运行{' '}
            <code className="rounded bg-surface-hover px-1.5 py-1">
              npm run dev
            </code>{' '}
            同时启动前后端。
          </p>
          <div className="mt-4">
            <ErrorNotice message={error} />
          </div>
          <button className="btn-primary mt-6" onClick={() => void load()}>
            重新连接
          </button>
        </div>
      </div>
    );
  if (!status)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="fixed top-4 right-4 z-20">
          <ThemeSwitcher />
        </div>
        <Spinner label="正在打开 ZoHome" />
      </div>
    );
  if (!status.authenticated)
    return <LoginPage onLogin={load} />;
  return <WorkspaceAccess key={status.user?.id || status.mode} status={status} reloadStatus={load} />;
}

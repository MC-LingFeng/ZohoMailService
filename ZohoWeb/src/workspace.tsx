import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createWorkspaceApi, type ApiRequest } from './api';
import type { Account, Activity, AppStatus, Overview, WorkspaceSummary } from './types';

interface Workspace {
  status: AppStatus;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  request: ApiRequest;
  switchWorkspace: (id: string) => void;
  reloadWorkspaces: (selectId?: string) => Promise<void>;
  accounts: Account[];
  overview: Overview | null;
  activity: Activity[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
  reloadStatus: () => Promise<void>;
}
const Context = createContext<Workspace | null>(null);
export const useWorkspace = () => {
  const context = useContext(Context);
  if (!context) throw new Error('Workspace context missing');
  return context;
};

export function WorkspaceProvider({
  status,
  workspace,
  workspaces,
  switchWorkspace,
  reloadWorkspaces: reloadCatalog,
  reloadStatus,
  children,
}: {
  status: AppStatus;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  switchWorkspace: (id: string) => void;
  reloadWorkspaces: (selectId?: string, signal?: AbortSignal) => Promise<void>;
  reloadStatus: () => Promise<void>;
  children: ReactNode;
}) {
  const scope = useRef({ active: true, controller: new AbortController() });
  useLayoutEffect(() => {
    scope.current.active = true;
    if (scope.current.controller.signal.aborted) scope.current.controller = new AbortController();
    return () => {
      scope.current.active = false;
      scope.current.controller.abort();
    };
  }, []);
  const request = useMemo(() => createWorkspaceApi(workspace.id, () => {
    if (!scope.current.active) throw new DOMException('工作区已切换', 'AbortError');
    return scope.current.controller.signal;
  }), [workspace.id]);
  const reloadWorkspaces = useCallback(async (selectId?: string) => {
    if (!scope.current.active) throw new DOMException('工作区已切换', 'AbortError');
    await reloadCatalog(selectId, scope.current.controller.signal);
  }, [reloadCatalog]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState('');
  const refresh = useCallback(async () => {
    const lifetime = scope.current.controller.signal;
    if (!scope.current.active) return;
    setError('');
    try {
      const [nextAccounts, nextOverview, nextActivity] = await Promise.all([
        request<Account[]>('/accounts'),
        request<Overview>('/overview'),
        request<Activity[]>('/activity'),
      ]);
      if (lifetime.aborted) return;
      setAccounts(nextAccounts);
      setOverview(nextOverview);
      setActivity(nextActivity);
    } catch (error) {
      if (lifetime.aborted) return;
      setError(error instanceof Error ? error.message : '加载失败');
    } finally {
      if (!lifetime.aborted) setLoading(false);
    }
  }, [request]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (notification) {
      const timer = window.setTimeout(() => setNotification(''), 4500);
      return () => window.clearTimeout(timer);
    }
  }, [notification]);
  return (
    <Context.Provider
      value={{
        status,
        workspace,
        workspaces,
        request,
        switchWorkspace,
        reloadWorkspaces,
        accounts,
        overview,
        activity,
        loading,
        error,
        refresh,
        toast: setNotification,
        reloadStatus,
      }}
    >
      {children}
      {notification && (
        <div
          className="fixed right-5 bottom-6 z-[80] max-w-sm animate-fade-in rounded-xl border border-brand-200 bg-brand-800 px-5 py-3 text-xs leading-6 text-white shadow-xl"
          role="status"
        >
          {notification}
        </div>
      )}
    </Context.Provider>
  );
}

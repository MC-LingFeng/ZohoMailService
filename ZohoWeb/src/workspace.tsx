import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import type { Account, Activity, AppStatus, Overview } from './types';

interface Workspace {
  status: AppStatus;
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
  reloadStatus,
  children,
}: {
  status: AppStatus;
  reloadStatus: () => Promise<void>;
  children: ReactNode;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState('');
  const refresh = useCallback(async () => {
    setError('');
    try {
      const [nextAccounts, nextOverview, nextActivity] = await Promise.all([
        api<Account[]>('/accounts'),
        api<Overview>('/overview'),
        api<Activity[]>('/activity'),
      ]);
      setAccounts(nextAccounts);
      setOverview(nextOverview);
      setActivity(nextActivity);
    } catch (error) {
      setError(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);
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

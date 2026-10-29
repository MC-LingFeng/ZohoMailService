import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'zohome.theme';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';
const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'auto';

function initialMode(): ThemeMode {
  const applied = document.documentElement.dataset.themeMode;
  if (isThemeMode(applied)) return applied;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    // A blocked storage area should not prevent access to the app.
  }
  return 'auto';
}

function systemTheme(): ResolvedTheme {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia(SYSTEM_QUERY).matches
    ? 'dark'
    : 'light';
}

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, updateMode] = useState<ThemeMode>(initialMode);
  const [system, updateSystem] = useState<ResolvedTheme>(systemTheme);
  const resolved = mode === 'auto' ? system : mode;

  const setMode = useCallback((next: ThemeMode) => {
    updateMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Keep the selected mode for this tab when persistence is unavailable.
    }
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#10171c' : '#f7f8fa');
  }, [mode, resolved]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(SYSTEM_QUERY);
    const syncSystem = () => updateSystem(media.matches ? 'dark' : 'light');
    syncSystem();
    media.addEventListener('change', syncSystem);
    return () => media.removeEventListener('change', syncSystem);
  }, []);

  useEffect(() => {
    const syncTabs = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      updateMode(isThemeMode(event.newValue) ? event.newValue : 'auto');
    };
    window.addEventListener('storage', syncTabs);
    return () => window.removeEventListener('storage', syncTabs);
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeProvider is missing');
  return context;
}

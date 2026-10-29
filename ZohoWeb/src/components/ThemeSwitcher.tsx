import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeMode } from '../theme';

const options = [
  { value: 'light', label: 'Light', description: '白天模式', icon: Sun },
  { value: 'dark', label: 'Dark', description: '黑夜模式', icon: Moon },
  { value: 'auto', label: 'Auto', description: '跟随系统', icon: Monitor },
] satisfies {
  value: ThemeMode;
  label: string;
  description: string;
  icon: typeof Sun;
}[];

export default function ThemeSwitcher() {
  const { mode, resolved, setMode } = useTheme();
  return (
    <div className="theme-switcher" role="group" aria-label="页面主题">
      {options.map(({ value, label, description, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className={`theme-option ${mode === value ? 'theme-option-active' : ''}`}
          aria-pressed={mode === value}
          aria-label={`${label} · ${description}`}
          title={`${label} · ${description}${value === 'auto' && mode === 'auto' ? `（系统当前为${resolved === 'dark' ? '黑夜' : '白天'}模式）` : ''}`}
          onClick={() => setMode(value)}
        >
          <Icon size={14} aria-hidden="true" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

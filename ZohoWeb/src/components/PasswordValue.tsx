import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function PasswordValue({ value }: { value: string }) {
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  useEffect(() => setRevealedValue(null), [value]);
  const visible = revealedValue === value;
  if (!value) return <span className="text-subtle">—</span>;
  return (
    <span className="inline-flex max-w-full items-start gap-2">
      <span className="min-w-0 whitespace-pre-wrap break-all font-mono text-[13px] leading-5 text-body">
        {visible ? value : '••••••••'}
      </span>
      <button
        type="button"
        className="icon-button -my-1 shrink-0"
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        onClick={() => setRevealedValue(visible ? null : value)}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </span>
  );
}

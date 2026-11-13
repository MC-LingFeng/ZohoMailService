import { useState } from 'react';
import { copyText } from '../clipboard';
import { useWorkspace } from '../workspace';

export default function BrowserIdCopy({ value }: { value: string }) {
  const { toast } = useWorkspace();
  const [copying, setCopying] = useState(false);

  const copy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      await copyText(value);
      toast('ID 已复制');
    } catch {
      toast('ID 复制失败，请重试或在编辑窗口中手动复制。');
    } finally {
      setCopying(false);
    }
  };

  return <button
    type="button"
    className="block w-[104px] max-w-full truncate rounded py-1 text-left font-mono text-[13px] leading-5 text-accent underline decoration-accent/40 underline-offset-4 hover:bg-accent-muted hover:decoration-accent focus-visible:ring-inset"
    title={value}
    aria-label={`复制浏览器 ID：${value}`}
    disabled={copying}
    onClick={() => void copy()}
  >{value}</button>;
}

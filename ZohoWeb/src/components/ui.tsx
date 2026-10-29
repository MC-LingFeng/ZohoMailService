import { useEffect, useRef, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  House,
  LoaderCircle,
  Mail,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-2.5"
      aria-label="ZoHome 首页"
    >
      <span className="brand-mark">
        <House size={24} strokeWidth={1.5} />
      </span>
      {!compact && (
        <span className="text-[23px] font-semibold tracking-[-1px]">
          Zo<span className="text-accent">Home</span>
          <span className="ml-0.5 text-brand-400">.</span>
        </span>
      )}
    </Link>
  );
}

export function Spinner({ label = '正在加载' }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-12 text-xs text-subtle"
      role="status"
    >
      <LoaderCircle className="animate-spin" size={17} />
      {label}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Mail size={28} strokeWidth={1.2} />
      </span>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-2 max-w-xs text-xs leading-6 text-subtle">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'max-w-2xl' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const bounds = ref.current.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            closeRef.current();
        }
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭弹窗">
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

const avatarColors = [
  'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  'bg-info-surface text-info-ink',
  'bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-200',
  'bg-warning-surface text-warning-ink',
  'bg-rose-50 text-rose-600 dark:bg-rose-900/40 dark:text-rose-200',
  'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200',
];
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  const hash = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl font-semibold ${small ? 'size-8 text-[10px]' : 'size-10 text-xs'} ${avatarColors[hash % avatarColors.length]}`}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
        <h1 className="page-heading">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function InlineLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-hover"
    >
      {children}
      <ArrowRight size={14} />
    </Link>
  );
}

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { copyText } from '../clipboard';
import BrowserIdCopy from './BrowserIdCopy';
import { Ban, CheckCircle2, Copy, X } from 'lucide-react';
import type { FingerprintBrowserOverview, FingerprintBrowserOverviewRegistration, FingerprintBrowserOverviewRow } from '../types';

interface AccountDetails {
  browser: FingerprintBrowserOverviewRow;
  siteName: string;
  registration: FingerprintBrowserOverviewRegistration;
  anchor: HTMLButtonElement;
  pinned: boolean;
}

const statusClass = (banned: boolean) => banned
  ? 'border-rose-400 bg-rose-200 text-rose-900 hover:bg-rose-300 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100 dark:hover:bg-rose-900'
  : 'border-emerald-400 bg-emerald-200 text-emerald-900 hover:bg-emerald-300 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100 dark:hover:bg-emerald-900';


export default function FingerprintBrowserHeatmap({ data }: { data: FingerprintBrowserOverview }) {
  const container = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupId = useId();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<AccountDetails | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; message: string; error: boolean } | null>(null);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => {
      if (popup.current?.contains(document.activeElement)) return;
      setActive((current) => current?.pinned ? current : null);
    }, 200);
  };
  const show = (details: Omit<AccountDetails, 'pinned'>, pinned = false) => {
    cancelHide();
    setActive((current) => {
      if (current?.anchor === details.anchor) return { ...current, pinned: current.pinned || pinned };
      if (current?.pinned && !pinned) return current;
      return { ...details, pinned };
    });
  };

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  useEffect(() => setActive(null), [data, width]);

  useEffect(() => {
    if (active?.pinned) popup.current?.focus({ preventScroll: true });
  }, [active?.anchor, active?.pinned]);

  useLayoutEffect(() => {
    if (!active || !popup.current) {
      setPosition(null);
      return;
    }
    const bounds = active.anchor.getBoundingClientRect();
    const popupWidth = Math.min(380, window.innerWidth - 24);
    const maxHeight = window.innerHeight - 24;
    const height = Math.min(popup.current.scrollHeight, maxHeight);
    const below = window.innerHeight - bounds.bottom - 20;
    const top = below >= height ? bounds.bottom + 8 : bounds.top - height - 8;
    setPosition({
      left: Math.max(12, Math.min(bounds.left, window.innerWidth - popupWidth - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - height - 12)),
      width: popupWidth,
      maxHeight,
    });
  }, [active, feedback]);

  useEffect(() => {
    if (!active) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !active.anchor.contains(event.target) && !popup.current?.contains(event.target)) setActive(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      active.anchor.focus({ preventScroll: true });
      setActive(null);
    };
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      setActive(null);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [active]);

  // Reserve two fixed columns, then group sites to keep their cells readable.
  // Keep ancestors free of overflow containers so headers stick to page scrolling.
  const columns = Math.max(1, Math.floor((width - 64 - 120) / 132));
  const groups = Array.from({ length: Math.ceil(data.siteNames.length / columns) }, (_, index) => data.siteNames.slice(index * columns, (index + 1) * columns));
  const copy = async (value: string, label: string) => {
    if (!active) return;
    const id = active.registration.id;
    try {
      await copyText(value);
      setFeedback({ id, message: `${label}已复制`, error: false });
    } catch {
      setFeedback({ id, message: '复制失败，请选中内容手动复制。', error: true });
    }
  };

  return <>
    <div className="px-3 py-4 sm:px-5">
      <div ref={container} className="min-w-0 space-y-5">
        {groups.map((sites, group) => <div key={sites[0]} className="relative" role="region" aria-label={`浏览器与返利网热力图第 ${group + 1} 组`}><table className="heatmap-table data-table w-full table-fixed border-separate border-spacing-0 text-left">
          <caption className="sr-only">浏览器与返利网账号热力图{groups.length > 1 ? `，第 ${group + 1} 组，共 ${groups.length} 组` : ''}。绿色为正常账号，红色为已封号，灰色为未关联。</caption>
          <colgroup><col style={{ width: 64 }} /><col style={{ width: 120 }} />{sites.map((siteName) => <col key={siteName} />)}</colgroup>
          <thead><tr>
            <th scope="col" className="browser-serial-cell rounded-tl-lg border border-line bg-surface-muted px-2 py-3">序号</th>
            <th scope="col" className="browser-id-cell border-y border-r border-line bg-surface-muted px-2 py-3">ID</th>
            {sites.map((siteName, index) => <th key={siteName} scope="col" className={`break-all border-y border-r border-line bg-surface-muted px-2 py-3 text-center font-semibold text-ink ${index === sites.length - 1 ? 'rounded-tr-lg' : ''}`}>{siteName}</th>)}
          </tr></thead>
          <tbody>{data.rows.map((browser, row) => {
            const bySite = new Map(browser.sites.map((site) => [site.siteName, site.registrations]));
            const emailCount = new Set(browser.sites.flatMap((site) => site.registrations.map((registration) => registration.accountEmail))).size;
            return <tr key={browser.id}>
              <th scope="row" className={`browser-serial-cell border-x border-b border-line bg-surface-muted px-2 py-3 align-top font-normal ${row === data.rows.length - 1 ? 'rounded-bl-lg' : ''}`}>
                <p className="truncate font-mono font-semibold leading-5 text-ink" title={browser.serialNumber}>{browser.serialNumber}</p>
                <p className="mt-1 truncate text-[12px] leading-5 text-muted" title={browser.windowName}>{browser.windowName}</p>
              </th>
              <td className="browser-id-cell border-b border-r border-line bg-surface-muted px-2 py-3 align-top">
                <BrowserIdCopy value={browser.browserId} />
                <p className="mt-1 whitespace-nowrap text-[12px] text-subtle">{emailCount} 个邮箱</p>
              </td>
              {sites.map((siteName, column) => {
                const registrations = bySite.get(siteName) || [];
                return <td key={siteName} className={`border-b border-r border-line p-1.5 align-top sm:p-2 ${row === data.rows.length - 1 && column === sites.length - 1 ? 'rounded-br-lg' : ''}`}>
                  {registrations.length ? <div className="grid gap-1.5">
                    {registrations.map((registration, index) => <button
                      key={registration.id}
                      type="button"
                      className={`flex min-h-12 w-full min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[13px] font-medium leading-5 transition-colors ${statusClass(registration.banned)}`}
                      aria-label={`${browser.serialNumber}-${browser.browserId}，${siteName}，${registration.accountEmail}，${registration.banned ? '已封号' : '正常'}${registration.offerName ? `，Offer：${registration.offerName}` : ''}`}
                      aria-haspopup="dialog"
                      aria-expanded={active?.browser.id === browser.id && active.registration.id === registration.id}
                      aria-controls={active?.browser.id === browser.id && active.registration.id === registration.id ? popupId : undefined}
                      data-registration-id={registration.id}
                      onMouseEnter={(event) => show({ browser, siteName, registration, anchor: event.currentTarget })}
                      onMouseLeave={scheduleHide}
                      onFocus={(event) => show({ browser, siteName, registration, anchor: event.currentTarget })}
                      onBlur={scheduleHide}
                      onClick={(event) => show({ browser, siteName, registration, anchor: event.currentTarget }, true)}
                    >
                      {/* {registration.banned ? <Ban size={12} className="shrink-0" aria-hidden="true" /> : <CheckCircle2 size={12} className="shrink-0" aria-hidden="true" />} */}
                      <span className="min-w-0 break-all">
                        <div>{registration?.offerName}</div>
                        {registrations.length > 1 && <span className="block text-[12px] font-normal opacity-75">账号 {index + 1}</span>}
                        <div>{registration?.accountEmail}</div>
                        </span>
                    </button>)}
                  </div> : <div className="flex min-h-12 items-center justify-center rounded-md border border-dashed border-line bg-surface-muted text-[12px] text-subtle" aria-label={`${siteName} 未关联邮箱`}>—</div>}
                </td>;
              })}
            </tr>;
          })}</tbody>
        </table></div>)}
      </div>
    </div>
    {active && createPortal(<div
      ref={popup}
      id={popupId}
      role="dialog"
      tabIndex={-1}
      aria-label={`${active.siteName}账号详情`}
      className="fixed z-[110] overflow-y-auto rounded-xl border border-line bg-surface p-4 text-sm text-body shadow-xl"
      style={position || { left: 12, top: 12, width: Math.min(380, window.innerWidth - 24), visibility: 'hidden' }}
      onMouseEnter={cancelHide}
      onMouseLeave={scheduleHide}
      onFocusCapture={cancelHide}
      onBlurCapture={scheduleHide}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all text-sm font-semibold text-ink">{active.siteName}</p>
          <p className="mt-1 break-all font-mono text-[12px] text-muted">窗口 {active.browser.serialNumber}-{active.browser.browserId}</p>
        </div>
        <button type="button" className="icon-button -mr-2 -mt-2" aria-label="关闭账号详情" onClick={() => { active.anchor.focus({ preventScroll: true }); setActive(null); }}><X size={15} /></button>
      </div>
      <span className={`mt-3 inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[12px] ${statusClass(active.registration.banned)}`}>
        {active.registration.banned ? <Ban size={11} /> : <CheckCircle2 size={11} />}{active.registration.banned ? '已封号' : '正常 / 未封号'}
      </span>
      <dl className="mt-4 space-y-3">
        <div><dt className="text-[12px] text-muted">Offer</dt><dd className="mt-1 whitespace-pre-wrap break-all leading-5 text-ink">{active.registration.offerName || '未填写 Offer'}</dd></div>
        {active.registration.domain && <div><dt className="text-[12px] text-muted">域名</dt><dd className="mt-1 break-all text-[13px]">{active.registration.domain}</dd></div>}
        <div><dt className="text-[12px] text-muted">邮箱</dt><dd className="mt-1 flex items-start gap-2">
          <span className="min-w-0 flex-1 select-text whitespace-pre-wrap break-all font-mono text-[13px] leading-6 text-ink">{active.registration.accountEmail || '—'}</span>
          <button type="button" className="btn-quiet shrink-0 py-1 text-[12px]" aria-label="复制邮箱" disabled={!active.registration.accountEmail} onClick={() => void copy(active.registration.accountEmail, '邮箱')}><Copy size={12} />复制</button>
        </dd></div>
        <div><dt className="text-[12px] text-muted">密码</dt><dd className="mt-1 flex items-start gap-2">
          <span className="min-w-0 flex-1 select-text whitespace-pre-wrap break-all font-mono text-[13px] leading-6 text-ink">{active.registration.loginPassword || '未填写密码'}</span>
          <button type="button" className="btn-quiet shrink-0 py-1 text-[12px]" aria-label="复制密码" disabled={!active.registration.loginPassword} onClick={() => void copy(active.registration.loginPassword, '密码')}><Copy size={12} />复制</button>
        </dd></div>
      </dl>
      <div className="mt-4 border-t border-line-soft pt-3">
        <button type="button" className="btn-secondary w-full" disabled={!active.registration.accountEmail || !active.registration.loginPassword} onClick={() => void copy(`${active.registration.accountEmail}\n${active.registration.loginPassword}`, '邮箱和密码')}><Copy size={13} />复制邮箱和密码</button>
        <p className={`mt-2 min-h-5 text-[12px] leading-5 ${feedback?.id === active.registration.id && feedback.error ? 'text-danger-ink' : 'text-muted'}`} role="status" aria-live="polite">{feedback?.id === active.registration.id ? feedback.message : '悬停查看详情，点击色块可固定详情。'}</p>
      </div>
    </div>, document.body)}
  </>;
}

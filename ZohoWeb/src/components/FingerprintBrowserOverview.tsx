import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useWorkspace } from '../workspace';
import type { FingerprintBrowserOverview as OverviewData } from '../types';
import FingerprintBrowserHeatmap from './FingerprintBrowserHeatmap';
import { EmptyState, ErrorNotice, Spinner } from './ui';

export default function FingerprintBrowserOverview({ revision }: { revision: number }) {
  const { request: api } = useWorkspace();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api<OverviewData>('/fingerprint-browsers/overview', { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '浏览器与返利网总览加载失败');
        setLoading(false);
      });
    return () => controller.abort();
  }, [revision, reload]);

  const visible = useMemo(() => {
    if (!data) return { rows: [], siteNames: [] };
    const term = search.trim().toLocaleLowerCase();
    if (!term) return data;
    const matches = (value: string) => value.toLocaleLowerCase().includes(term);
    const hasSiteMatch = data.siteNames.some(matches);
    const matchesRegistration = (registration: OverviewData['rows'][number]['sites'][number]['registrations'][number]) =>
      [registration.accountEmail, registration.offerName].some(matches);
    const matchesBrowser = (row: OverviewData['rows'][number]) =>
      [row.serialNumber, row.browserId, row.windowName].some(matches);
    const rows = data.rows.filter((row) => hasSiteMatch || matchesBrowser(row) || row.sites.some((site) =>
      site.registrations.some(matchesRegistration),
    ));
    const hasBrowserMatch = rows.some(matchesBrowser);
    const siteNames = data.siteNames.filter((siteName) => hasBrowserMatch || matches(siteName) || rows.some((row) =>
      row.sites.some((site) => site.siteName === siteName && site.registrations.some(matchesRegistration)),
    ));
    return { rows, siteNames };
  }, [data, search]);

  return (
    <section className="panel mb-7 min-w-0" aria-labelledby="fingerprint-overview-heading">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
        <div>
          <h2 id="fingerprint-overview-heading" className="text-sm font-semibold text-ink">浏览器与返利网热力图</h2>
          <p className="mt-1.5 text-[11px] leading-6 text-muted">按窗口和返利网查看邮箱分布。悬停色块查看 Offer、邮箱和密码，点击色块可固定详情并复制。</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-subtle">
          {data && <span className="tabular-nums">{data.rows.length} 个浏览器 · {data.siteNames.length} 个返利网</span>}
          <button type="button" className="icon-button" aria-label="刷新浏览器与返利网总览" disabled={loading} onClick={() => setReload((value) => value + 1)}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3">
        <div className="search-field min-w-0 w-full sm:max-w-lg">
          <Search size={14} aria-hidden="true" />
          <input aria-label="搜索浏览器与返利网总览" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索序号、ID、窗口、返利网、邮箱或 Offer…" />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[10px] text-muted" aria-label="热力图图例">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950" />正常</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-rose-300 bg-rose-100 dark:border-rose-700 dark:bg-rose-950" />已封号</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-dashed border-line bg-surface-muted" />未关联</span>
        </div>
      </div>
      {loading ? <Spinner label="正在加载浏览器与返利网总览" />
        : error ? <div className="space-y-3 p-5"><ErrorNotice message={error} /><button type="button" className="btn-secondary" onClick={() => setReload((value) => value + 1)}>重新加载总览</button></div>
          : !data?.rows.length ? <EmptyState title="还没有指纹浏览器" description="在下方新增或导入浏览器，再关联返利网记录或邮箱，即可在这里查看。" />
            : !data.siteNames.length ? <EmptyState title="暂无返利网记录" description="在返利网页面添加登录邮箱、密码并关联浏览器，即可生成总览。" />
              : !visible.rows.length || !visible.siteNames.length ? <EmptyState title="没有匹配的总览信息" description="调整浏览器、返利网或邮箱关键词后再试。" action={<button type="button" className="btn-secondary" onClick={() => setSearch('')}>清空总览搜索</button>} />
                : <>
                  <FingerprintBrowserHeatmap data={visible} />
                  <p className="border-t border-line-soft px-5 py-3 text-[10px] leading-5 text-subtle">每个色块对应一条返利网账号记录，同一邮箱的多个 Offer 分别展示。返利网较多时自动分组排布，全部展开，无需在图内滚动。总览不受下方分页与搜索影响。</p>
                </>}
    </section>
  );
}

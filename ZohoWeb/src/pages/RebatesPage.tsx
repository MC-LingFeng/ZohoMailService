import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatConversion, formatConversionApprox } from '../rebates';
import {
  EmptyState,
  ErrorNotice,
  Modal,
  PageTitle,
  Spinner,
} from '../components/ui';
import type {
  Account,
  RebateCostRefresh,
  RebateInput,
  RebateList,
  RebateOptions,
  RebateRecord,
} from '../types';
import { useWorkspace } from '../workspace';

const RebateOverview = lazy(() => import('../components/RebateOverview'));

const pageSize = 20;
const amount = (value: number) =>
  new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function AccountSelect({
  accounts,
  value,
  onChange,
  required = false,
  disabled = false,
}: {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const matching = useMemo(
    () =>
      accounts.filter((account) =>
        `${account.email} ${account.name} ${account.group}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    [accounts, search],
  );
  const choices = matching.slice(0, 100);
  const selected = accounts.find((account) => account.id === value);
  if (selected && !choices.some((account) => account.id === selected.id))
    choices.unshift(selected);
  return (
    <div>
      <label className="field-label" htmlFor={`${id}-select`}>
        {required ? '关联邮箱 *' : '按邮箱筛选'}
      </label>
      <div className="search-field mb-2">
        <Search size={14} aria-hidden="true" />
        <input
          aria-label={required ? '搜索要关联的邮箱' : '搜索筛选邮箱'}
          placeholder="搜索邮箱、名称或分组…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={disabled}
        />
      </div>
      <select
        id={`${id}-select`}
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
      >
        <option value="">{required ? '请选择邮箱' : '全部邮箱'}</option>
        {choices.map((account) => (
          <option key={account.id} value={account.id}>
            {account.email} · {account.name}
          </option>
        ))}
      </select>
      {matching.length > 100 && (
        <p className="mt-1.5 text-[10px] text-subtle">
          匹配 {matching.length} 个，显示前 100 个；继续输入可缩小范围。
        </p>
      )}
      {search && matching.length === 0 && (
        <p className="mt-1.5 text-[10px] text-subtle">
          没有匹配的邮箱{selected ? '，当前选择已保留' : ''}。
        </p>
      )}
    </div>
  );
}

function SavedValueField({
  label,
  value,
  onChange,
  options,
  placeholder,
  maxLength,
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  maxLength: number;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [candidate, setCandidate] = useState('');
  const matching = useMemo(
    () =>
      options.filter((option) =>
        option.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [options, search],
  );
  const choose = () => {
    if (!candidate || disabled) return;
    onChange(candidate);
    setOpen(false);
    setSearch('');
    setCandidate('');
    inputRef.current?.focus();
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label
          className="text-xs font-medium text-body"
          htmlFor={`${id}-input`}
        >
          {label}
          {required ? ' *' : ''}
        </label>
        <button
          type="button"
          className="btn-quiet px-1 py-0 text-[10px]"
          aria-expanded={open}
          aria-controls={`${id}-choices`}
          onClick={() => setOpen((current) => !current)}
          disabled={disabled || options.length === 0}
        >
          {open ? '收起已用值' : `选择已用（${options.length}）`}
        </button>
      </div>
      <input
        ref={inputRef}
        id={`${id}-input`}
        className="input"
        value={value}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      {open && (
        <div
          id={`${id}-choices`}
          className="mt-2 rounded-lg border border-line bg-surface-muted p-2"
        >
          <div className="search-field mb-2">
            <Search size={13} aria-hidden="true" />
            <input
              aria-label={`搜索已用${label}`}
              placeholder={`搜索已用${label}…`}
              value={search}
              onChange={(event) => {
                const nextSearch = event.target.value;
                setSearch(nextSearch);
                if (
                  !candidate
                    .toLowerCase()
                    .includes(nextSearch.trim().toLowerCase())
                )
                  setCandidate('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
              disabled={disabled}
            />
          </div>
          <select
            className="input py-1"
            size={5}
            value={candidate}
            aria-label={`选择已用${label}`}
            onChange={(event) => setCandidate(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                choose();
              }
            }}
            disabled={disabled}
          >
            <option value="" disabled>
              {matching.length
                ? '选择一项填入，或继续手动填写'
                : '没有匹配项，可直接手动填写'}
            </option>
            {matching.slice(0, 80).map((option) => (
              <option value={option} key={option}>
                {option}
              </option>
            ))}
          </select>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="btn-secondary py-1.5"
              disabled={disabled || !candidate}
              onClick={choose}
            >
              填入所选
            </button>
          </div>
          {matching.length > 80 && (
            <p className="mt-1.5 text-[10px] text-subtle">
              匹配 {matching.length} 项，显示前 80 项；输入可缩小范围。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function approximateConversion(
  cost: number,
  revenue: number,
  normalized = true,
) {
  const approximation = formatConversionApprox(cost, revenue);
  return approximation === '—'
    ? '≈ —'
    : `≈ ${normalized ? '1:' : ''}${approximation}`;
}
interface EditorFields extends Omit<RebateInput, 'totalRevenue' | 'totalCost'> {
  totalRevenue: string;
  totalCost: string;
}
const blankFields = (accountId: string): EditorFields => ({
  accountId,
  siteName: '',
  domain: '',
  registeredAt: localDate(),
  offerName: '',
  totalRevenue: '0',
  totalCost: '0',
  settled: false,
  settlementCycle: '',
  banned: false,
  ip: '',
});

export default function RebatesPage() {
  const { accounts, loading: accountsLoading, toast } = useWorkspace();
  const [filters, setFilters] = useState({
    search: '',
    accountId: '',
    settled: 'all',
    banned: 'all',
    page: 1,
  });
  const [data, setData] = useState<RebateList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [options, setOptions] = useState<RebateOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [editing, setEditing] = useState<RebateRecord | null>(null);
  const [fields, setFields] = useState<EditorFields>(() => blankFields(''));
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<RebateRecord | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [refreshingCosts, setRefreshingCosts] = useState(false);
  const costsRefreshLock = useRef(false);
  const [costRefreshResult, setCostRefreshResult] = useState<RebateCostRefresh | null>(null);
  const [costRefreshError, setCostRefreshError] = useState('');
  const query = new URLSearchParams({
    search: filters.search.trim(),
    accountId: filters.accountId,
    settled: filters.settled,
    banned: filters.banned,
    page: String(filters.page),
    pageSize: String(pageSize),
  }).toString();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    setData(null);
    const timer = window.setTimeout(() => {
      void api<RebateList>(`/rebates?${query}`, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
          if (filters.page > lastPage) {
            setFilters((current) => ({ ...current, page: lastPage }));
            return;
          }
          setData(result);
          setLoading(false);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setLoadError(
            error instanceof Error ? error.message : '返利网记录加载失败',
          );
          setLoading(false);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, revision, filters.page]);

  useEffect(() => {
    if (!editorOpen) return;
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError('');
    setOptions(null);
    void api<RebateOptions>('/rebates/options', { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setOptions(result);
        setOptionsLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOptionsError(
          error instanceof Error ? error.message : '已用信息加载失败',
        );
        setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [editorOpen, editorEpoch, optionsRevision]);

  const changeFilter = (
    key: 'search' | 'accountId' | 'settled' | 'banned',
    value: string,
  ) => {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  };
  const openEditor = (record?: RebateRecord) => {
    if (costsRefreshLock.current) return;
    setEditing(record || null);
    setFormError('');
    setOptions(null);
    setOptionsError('');
    setOptionsLoading(true);
    setEditorEpoch((value) => value + 1);
    setFields(
      record
        ? {
            accountId: record.accountId,
            siteName: record.siteName,
            domain: record.domain,
            registeredAt: record.registeredAt,
            offerName: record.offerName,
            totalRevenue: String(record.totalRevenue),
            totalCost: String(record.totalCost),
            settled: record.settled,
            settlementCycle: record.settlementCycle,
            banned: record.banned,
            ip: record.ip,
          }
        : blankFields(filters.accountId),
    );
    setEditorOpen(true);
  };
  const setField = <K extends keyof EditorFields>(
    key: K,
    value: EditorFields[K],
  ) => setFields((current) => ({ ...current, [key]: value }));
  const closeEditor = () => {
    if (!busy) setEditorOpen(false);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || costsRefreshLock.current) return;
    setBusy(true);
    setFormError('');
    const payload: RebateInput = {
      ...fields,
      siteName: fields.siteName.trim(),
      domain: fields.domain.trim(),
      offerName: fields.offerName.trim(),
      settlementCycle: fields.settlementCycle.trim(),
      ip: fields.ip.trim(),
      totalRevenue: Number(fields.totalRevenue),
      totalCost: Number(fields.totalCost),
    };
    try {
      await api<RebateRecord>(
        editing ? `/rebates/${encodeURIComponent(editing.id)}` : '/rebates',
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      setEditorOpen(false);
      setCostRefreshResult(null);
      toast(editing ? '返利网记录已更新。' : '返利网记录已添加。');
      setRevision((value) => value + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deleting || busy || costsRefreshLock.current) return;
    setBusy(true);
    setDeleteError('');
    try {
      await api(`/rebates/${encodeURIComponent(deleting.id)}`, {
        method: 'DELETE',
      });
      setDeleting(null);
      setCostRefreshResult(null);
      toast('返利网记录已删除。');
      setRevision((value) => value + 1);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : '删除失败，请重试',
      );
    } finally {
      setBusy(false);
    }
  };
  const refreshCosts = async () => {
    if (costsRefreshLock.current || busy || editorOpen || deleting) return;
    costsRefreshLock.current = true;
    setRefreshingCosts(true);
    setCostRefreshResult(null);
    setCostRefreshError('');
    try {
      const result = await api<RebateCostRefresh>('/rebates/refresh-costs', {
        method: 'POST',
      });
      setCostRefreshResult(result);
      setRevision((value) => value + 1);
    } catch (error) {
      setCostRefreshError(
        error instanceof Error ? error.message : '成本刷新失败，请重试',
      );
    } finally {
      costsRefreshLock.current = false;
      setRefreshingCosts(false);
    }
  };
  const hasFilters = Boolean(
    filters.search ||
      filters.accountId ||
      filters.settled !== 'all' ||
      filters.banned !== 'all',
  );
  const pageCount = Math.max(1, Math.ceil((data?.total || 0) / pageSize));

  return (
    <div className="page-wrap">
      <PageTitle
        eyebrow="返利管理"
        title="返利网"
        description="按邮箱管理返利网与 Offer，逐项对比收益、成本和转化。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-secondary"
              onClick={() => void refreshCosts()}
              disabled={refreshingCosts || busy || editorOpen || Boolean(deleting)}
              aria-describedby="cost-refresh-description"
              title="按广告系列名称匹配所有 Offer，同名消费汇总后按邮箱平均分配，并将美元成本保存"
            >
              <RefreshCw size={15} className={refreshingCosts ? 'animate-spin' : undefined} />
              {refreshingCosts ? '正在刷新…' : '刷新预算'}
            </button>
            <button
              className="btn-primary"
              onClick={() => openEditor()}
              disabled={accountsLoading || accounts.length === 0 || refreshingCosts}
            >
              <Plus size={15} />
              新增记录
            </button>
          </div>
        }
      />

      <p id="cost-refresh-description" className="mb-4 text-[11px] leading-6 text-muted">
        刷新预算会按广告系列名称匹配全部 Offer，汇总同名广告系列的累计实际消费（美元 USD），按关联邮箱平均分配后覆盖并保存成本；同一邮箱有多条同名 Offer 记录时再均分，不受当前筛选或分页影响。
      </p>
      {refreshingCosts && (
        <p className="mb-4 text-xs text-muted" role="status">
          正在读取 Google Ads 消费并保存成本，请稍候…
        </p>
      )}
      {costRefreshError && (
        <div className="mb-4">
          <ErrorNotice message={`成本刷新失败：${costRefreshError}`} />
        </div>
      )}
      {costRefreshResult && (
        <div className="panel mb-5 p-4 text-xs leading-6 text-body" role="status">
          <p>
            {costRefreshResult.issues.length ? '成本刷新已完成，部分 Offer 未更新。' : '成本刷新已完成。'}
            {' '}已更新 {costRefreshResult.updatedOffers} / {costRefreshResult.totalOffers} 个 Offer、
            {costRefreshResult.updatedRecords} 条记录，单位为美元（USD）。
          </p>
          <p className="text-[11px] text-muted">
            刷新时间：{new Date(costRefreshResult.refreshedAt).toLocaleString('zh-CN', { hour12: false })}
          </p>
          {costRefreshResult.issues.length > 0 && (
            <details className="mt-2" open>
              <summary className="cursor-pointer text-warning-ink">
                {costRefreshResult.issues.length} 项未更新，原成本已保留
              </summary>
              <ul className="mt-2 max-h-60 list-disc space-y-1 overflow-y-auto pl-5">
                {costRefreshResult.issues.map((issue, index) => (
                  <li key={`${issue.offerName}-${index}`} className="break-words">
                    <b className="font-medium">{issue.offerName || '未填写 Offer 名称'}</b>：{issue.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <p>
          当前筛选 ·{' '}
          <b className="font-medium text-ink">
            {loading || !data ? '—' : data.summary.recordCount}
          </b>{' '}
          条记录 ·{' '}
          <b className="font-medium text-ink">
            {loading || !data ? '—' : data.summary.accountCount}
          </b>{' '}
          个邮箱
        </p>
        <p>图表统计全部筛选结果；成本单位为 USD，收益请使用美元。</p>
      </div>
      {loadError ? (
        <div className="panel mb-6 p-5">
          <ErrorNotice message={loadError} />
          <button
            className="btn-secondary mt-4"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={14} />
            重新加载
          </button>
        </div>
      ) : (
        <Suspense fallback={<div className="panel mb-5"><Spinner label="正在加载对比图表" /></div>}>
          <RebateOverview data={data} loading={loading} />
        </Suspense>
      )}
      <p className="mb-2 text-[11px] leading-6 text-subtle">
        转化按“成本:收益”自动约分，例如 20:400 显示 1:20，并显示归一至成本为 1
        后的近似值；图中转化倍数为收益 ÷ 成本，越高表示每份成本对应的收益越多；成本为 0 时倍数为 —。整体转化按汇总金额计算。
      </p>
      <p className="mb-7 text-[11px] leading-6 text-muted">
        已封户记录仅计成本，不计收益；明细保留录入金额。
      </p>

      <section
        className="panel overflow-hidden"
        aria-labelledby="rebate-records-heading"
      >
        <div className="border-b border-line-soft p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 id="rebate-records-heading" className="section-title">
              邮箱注册记录
            </h2>
            {hasFilters && (
              <button
                className="btn-quiet"
                onClick={() =>
                  setFilters({
                    search: '',
                    accountId: '',
                    settled: 'all',
                    banned: 'all',
                    page: 1,
                  })
                }
              >
                清除筛选
              </button>
            )}
          </div>
          <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-[1.2fr_1.3fr_0.7fr_0.7fr]">
            <div>
              <label className="field-label" htmlFor="rebate-search">
                搜索记录
              </label>
              <div className="search-field">
                <Search size={15} aria-hidden="true" />
                <input
                  id="rebate-search"
                  placeholder="返利网、域名、Offer、邮箱或分组…"
                  value={filters.search}
                  maxLength={200}
                  onChange={(event) =>
                    changeFilter('search', event.target.value)
                  }
                />
              </div>
            </div>
            <AccountSelect
              accounts={accounts}
              value={filters.accountId}
              onChange={(value) => changeFilter('accountId', value)}
            />
            <label>
              <span className="field-label">是否结款</span>
              <select
                className="input"
                value={filters.settled}
                onChange={(event) =>
                  changeFilter('settled', event.target.value)
                }
              >
                <option value="all">全部结款状态</option>
                <option value="yes">已结款</option>
                <option value="no">未结款</option>
              </select>
            </label>
            <label>
              <span className="field-label">是否封户</span>
              <select
                className="input"
                value={filters.banned}
                onChange={(event) => changeFilter('banned', event.target.value)}
              >
                <option value="all">全部账户状态</option>
                <option value="no">未封户</option>
                <option value="yes">已封户</option>
              </select>
            </label>
          </div>
        </div>
        {loading ? (
          <Spinner label="正在加载注册记录" />
        ) : loadError ? (
          <div className="p-6 text-center text-xs leading-6 text-muted">
            记录暂时无法加载，请使用上方的“重新加载”重试。
          </div>
        ) : !accountsLoading && accounts.length === 0 ? (
          <EmptyState
            title="先连接一个邮箱"
            description="返利网记录需要关联邮箱。连接后即可记录它注册的返利网、Offer 和收支。"
            action={
              <Link className="btn-primary" to="/accounts">
                前往邮箱账号
              </Link>
            }
          />
        ) : data?.records.length === 0 ? (
          <EmptyState
            title={hasFilters ? '没有符合条件的记录' : '开始记录第一个返利网'}
            description={
              hasFilters
                ? '试试其他邮箱或搜索词，或清除结款和封户状态筛选。'
                : '选择关联邮箱，填写返利网与 Offer 信息，收益和成本默认从 0 开始。'
            }
            action={
              hasFilters ? (
                <button
                  className="btn-secondary"
                  onClick={() =>
                    setFilters({
                      search: '',
                      accountId: '',
                      settled: 'all',
                      banned: 'all',
                      page: 1,
                    })
                  }
                >
                  清除筛选
                </button>
              ) : (
                <button className="btn-primary" onClick={() => openEditor()} disabled={refreshingCosts}>
                  <Plus size={14} />
                  新增记录
                </button>
              )
            }
          />
        ) : (
          <>
            <p className="border-b border-line-soft px-5 py-2 text-[10px] text-subtle">
              左右滚动可查看全部信息；每条记录对应一个邮箱、返利网与 Offer。
            </p>
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="返利网注册明细表，可左右滚动"
            >
              <table className="w-full min-w-[1680px] text-left text-[11px]">
                <caption className="sr-only">
                  各邮箱注册的返利网、Offer、收支、结款、封户及 IP 信息
                </caption>
                <thead className="bg-surface-muted text-[10px] font-medium text-muted">
                  <tr>
                    {[
                      '所属邮箱',
                      '返利网 / 域名',
                      '创建时间',
                      'Offer 名称',
                      '总收益',
                      '总成本（USD）',
                      '转化',
                      '是否结款',
                      '结款周期',
                      '是否封户',
                      'IP',
                      '操作',
                    ].map((heading, index) => (
                      <th
                        key={heading}
                        scope="col"
                        className={`whitespace-nowrap bg-surface-muted px-4 py-3.5 font-medium ${index === 0 ? 'sm:sticky sm:left-0 sm:z-10' : index === 11 ? 'sticky right-0 z-20 border-l border-line-soft' : ''}`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {data?.records.map((record) => (
                    <tr
                      key={record.id}
                      className="group align-top hover:bg-surface-muted"
                    >
                      <td className="min-w-56 max-w-56 bg-surface px-4 py-4 break-words group-hover:bg-surface-muted sm:sticky sm:left-0 sm:z-10">
                        <p className="font-medium text-ink">
                          {record.accountName}
                        </p>
                        <p className="mt-1 break-all text-muted">
                          {record.accountEmail}
                        </p>
                        <span className="mt-2 inline-block text-[10px] text-subtle">
                          {record.accountGroup || '未分组'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <p className="max-w-52 break-words font-medium text-ink">
                          {record.siteName}
                        </p>
                        <p className="mt-1 max-w-52 break-all text-muted">
                          {record.domain}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 tabular-nums text-body">
                        {record.registeredAt}
                      </td>
                      <td className="max-w-48 break-words px-4 py-4 text-body">
                        {record.offerName || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-medium tabular-nums text-accent">
                        {amount(record.totalRevenue)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 tabular-nums text-body">
                        {amount(record.totalCost)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 tabular-nums text-body">
                        {formatConversion(
                          record.totalCost,
                          record.totalRevenue,
                        )}
                        <span className="mt-1 block text-[10px] text-subtle">
                          {approximateConversion(
                            record.totalCost,
                            record.totalRevenue,
                            false,
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={record.settled ? 'badge' : 'badge-amber'}
                        >
                          {record.settled ? '已结款' : '未结款'}
                        </span>
                      </td>
                      <td className="max-w-36 break-words px-4 py-4 text-body">
                        {record.settlementCycle || '—'}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={
                            record.banned
                              ? 'inline-flex whitespace-nowrap rounded-md bg-danger-surface px-2 py-1 text-[10px] font-medium text-danger-ink'
                              : 'badge-muted'
                          }
                        >
                          {record.banned ? '已封户' : '未封户'}
                        </span>
                      </td>
                      <td className="max-w-40 break-all px-4 py-4 font-mono text-[10px] text-muted">
                        {record.ip || '—'}
                      </td>
                      <td className="sticky right-0 z-20 border-l border-line-soft bg-surface px-4 py-3 group-hover:bg-surface-muted">
                        <div className="flex items-center gap-1">
                          <button
                            className="icon-button"
                            onClick={() => openEditor(record)}
                            aria-label={`编辑 ${record.accountEmail} 的 ${record.siteName}`}
                            title="编辑记录"
                            disabled={refreshingCosts}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button hover:text-danger-ink"
                            onClick={() => {
                              if (costsRefreshLock.current) return;
                              setDeleteError('');
                              setDeleting(record);
                            }}
                            aria-label={`删除 ${record.accountEmail} 的 ${record.siteName}`}
                            title="删除记录"
                            disabled={refreshingCosts}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-5 py-4 text-[11px] text-muted">
              <p>
                共 {data?.total || 0} 条 · 第 {filters.page} / {pageCount} 页
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="btn-secondary"
                  disabled={filters.page <= 1}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      page: current.page - 1,
                    }))
                  }
                >
                  <ChevronLeft size={14} />
                  上一页
                </button>
                <button
                  className="btn-secondary"
                  disabled={filters.page >= pageCount}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      page: current.page + 1,
                    }))
                  }
                >
                  下一页
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <Modal
        open={editorOpen}
        onClose={closeEditor}
        title={editing ? '编辑返利网记录' : '新增返利网记录'}
        wide
      >
        <form onSubmit={(event) => void save(event)}>
          <fieldset
            disabled={busy}
            className="max-h-[68vh] space-y-5 overflow-y-auto px-6 py-5"
          >
            <AccountSelect
              key={`account-${editorEpoch}`}
              accounts={accounts}
              value={fields.accountId}
              onChange={(value) => setField('accountId', value)}
              required
              disabled={busy}
            />
            {optionsLoading && (
              <p className="text-[10px] text-subtle" role="status">
                正在读取已保存的返利网名称、域名和 Offer…
              </p>
            )}
            {optionsError && (
              <div className="space-y-2">
                <ErrorNotice message={`已用信息加载失败：${optionsError}`} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] text-subtle">
                    仍可手动填写，不影响保存记录。
                  </p>
                  <button
                    type="button"
                    className="btn-quiet"
                    disabled={busy}
                    onClick={() => setOptionsRevision((value) => value + 1)}
                  >
                    <RefreshCw size={12} />
                    重新读取
                  </button>
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <SavedValueField
                key={`site-${editorEpoch}`}
                label="返利网名称"
                value={fields.siteName}
                onChange={(value) => setField('siteName', value)}
                options={options?.siteNames || []}
                placeholder="例如：返利网 A"
                maxLength={120}
                required
                disabled={busy}
              />
              <SavedValueField
                key={`domain-${editorEpoch}`}
                label="域名"
                value={fields.domain}
                onChange={(value) => setField('domain', value)}
                options={options?.domains || []}
                placeholder="例如：example.com"
                maxLength={253}
                required
                disabled={busy}
              />
              <label>
                <span className="field-label">返利网创建时间 *</span>
                <input
                  className="input"
                  type="date"
                  required
                  value={fields.registeredAt}
                  onChange={(event) =>
                    setField('registeredAt', event.target.value)
                  }
                />
              </label>
              <SavedValueField
                key={`offer-${editorEpoch}`}
                label="Offer 名称"
                value={fields.offerName}
                onChange={(value) => setField('offerName', value)}
                options={options?.offerNames || []}
                placeholder="例如：新用户注册奖励"
                maxLength={200}
                disabled={busy}
              />
              <label>
                <span className="field-label">返利网总收益</span>
                <input
                  className="input tabular-nums"
                  type="number"
                  required
                  min="0"
                  max="1000000000000"
                  step="0.01"
                  value={fields.totalRevenue}
                  onChange={(event) =>
                    setField('totalRevenue', event.target.value)
                  }
                />
              </label>
              <label>
                <span className="field-label">返利网总成本（USD）</span>
                <input
                  className="input tabular-nums"
                  type="number"
                  required
                  min="0"
                  max="1000000000000"
                  step="0.01"
                  value={fields.totalCost}
                  onChange={(event) =>
                    setField('totalCost', event.target.value)
                  }
                />
              </label>
              <label>
                <span className="field-label">是否结款</span>
                <select
                  className="input"
                  value={fields.settled ? 'yes' : 'no'}
                  onChange={(event) =>
                    setField('settled', event.target.value === 'yes')
                  }
                >
                  <option value="no">未结款</option>
                  <option value="yes">已结款</option>
                </select>
              </label>
              <label>
                <span className="field-label">结款周期</span>
                <input
                  className="input"
                  maxLength={100}
                  placeholder="例如：周结 / 月结 / Net 30"
                  value={fields.settlementCycle}
                  onChange={(event) =>
                    setField('settlementCycle', event.target.value)
                  }
                />
              </label>
              <label>
                <span className="field-label">是否封户</span>
                <select
                  className="input"
                  value={fields.banned ? 'yes' : 'no'}
                  onChange={(event) =>
                    setField('banned', event.target.value === 'yes')
                  }
                >
                  <option value="no">未封户</option>
                  <option value="yes">已封户</option>
                </select>
              </label>
              <label>
                <span className="field-label">IP 地址</span>
                <input
                  className="input font-mono"
                  maxLength={45}
                  placeholder="IPv4 或 IPv6，可留空"
                  value={fields.ip}
                  onChange={(event) => setField('ip', event.target.value)}
                />
              </label>
            </div>
            <div className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-xs leading-6 text-muted">
              <span>
                转化（按录入金额）{' '}
                <b className="ml-2 font-semibold tabular-nums text-ink">
                  {formatConversion(
                    Number(fields.totalCost),
                    Number(fields.totalRevenue),
                  )}
                </b>
              </span>
              <p className="mt-1 break-all text-[11px] tabular-nums text-muted">
                {approximateConversion(
                  Number(fields.totalCost),
                  Number(fields.totalRevenue),
                )}
              </p>
              <p className="mt-1 text-[10px] text-subtle">
                按成本:收益自动约分，例如 20:400 显示 1:20。成本单位为 USD，收益请使用美元。
              </p>
            </div>
            {formError && <ErrorNotice message={formError} />}
          </fieldset>
          <div className="flex items-center justify-end gap-3 border-t border-line-soft px-6 py-4">
            <button
              type="button"
              className="btn-secondary"
              onClick={closeEditor}
              disabled={busy}
            >
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? '正在保存…' : '保存记录'}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(deleting)}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
        title="删除返利网记录"
      >
        <div className="px-6 py-5">
          <p className="text-xs leading-7 text-muted">
            确认删除{' '}
            <b className="font-medium text-ink">{deleting?.accountEmail}</b> 的{' '}
            <b className="font-medium text-ink">{deleting?.siteName}</b>{' '}
            记录？该记录的收益与成本也会从统计中移除。
          </p>
          <p className="mt-2 text-[11px] text-subtle">删除后无法恢复。</p>
          {deleteError && (
            <div className="mt-4">
              <ErrorNotice message={deleteError} />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-line-soft px-6 py-4">
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => setDeleting(null)}
          >
            取消
          </button>
          <button
            className="btn-danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? '正在删除…' : '确认删除'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

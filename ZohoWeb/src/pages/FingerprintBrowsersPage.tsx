import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, FileSpreadsheet, Pencil, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { EmptyState, ErrorNotice, Modal, PageTitle, Spinner } from '../components/ui';
import FingerprintBrowserOverview from '../components/FingerprintBrowserOverview';
import BrowserIdCopy from '../components/BrowserIdCopy';
import { useWorkspace } from '../workspace';
import type {
  FingerprintBrowserAccount,
  FingerprintBrowserInput,
  FingerprintBrowserRecord,
  FingerprintBrowserOptions,
  FingerprintBrowserList,
  FingerprintBrowserImportPreview,
  FingerprintBrowserImportResult,
} from '../types';

const pageSize = 20;
const maximumFileSize = 5 * 1024 * 1024;
const blankFields = (): FingerprintBrowserInput => ({ serialNumber: '', browserId: '', windowName: '', proxyInfo: '', accountIds: [] });
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function EmailDetails({ account }: { account: FingerprintBrowserAccount }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const details = [...new Map(account.rebates.map((rebate) => [JSON.stringify([rebate.offerName, rebate.siteName, rebate.domain]), rebate])).values()];
  const cancelHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  const show = () => {
    cancelHide();
    if (!button.current) return;
    const bounds = button.current.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    const below = window.innerHeight - bounds.bottom - 20;
    const above = bounds.top - 20;
    const useBelow = below >= Math.min(240, above);
    const maxHeight = Math.min(320, Math.max(100, useBelow ? below : above));
    setPosition({ left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)), top: useBelow ? bounds.bottom + 8 : Math.max(12, bounds.top - maxHeight - 8), width, maxHeight });
  };
  const hide = () => { cancelHide(); hideTimer.current = setTimeout(() => setPosition(null), 120); };
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
  const title = details.length
    ? details.map((rebate) => `Offer：${rebate.offerName || '未填写'}；返利网：${rebate.siteName}${rebate.domain ? `（${rebate.domain}）` : ''}`).join('\n')
    : '尚无返利网记录';
  return (
    <>
      <button ref={button} type="button" className="rounded text-left text-[13px] text-accent underline decoration-accent/25 underline-offset-4 hover:decoration-accent" title={title} aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onKeyDown={(event) => { if (event.key === 'Escape') setPosition(null); }}>
        {account.email}{account.unknown && <span className="ml-1 text-[12px] text-subtle">未知</span>}
      </button>
      {position && createPortal(
        <div id={id} role="tooltip" className="fixed z-[100] overflow-y-auto rounded-xl border border-line bg-surface p-4 text-sm text-body shadow-xl" style={position} onMouseEnter={cancelHide} onMouseLeave={hide}>
          <p className="break-all font-medium text-ink">{account.email}</p>
          <p className="mt-1 text-[12px] text-subtle">关联的 Offer 与返利网</p>
          {details.length ? <div className="mt-3 space-y-3">{details.map((rebate) => <div key={rebate.id} className="border-t border-line-soft pt-2 leading-5">
            <p className="break-words"><span className="text-subtle">Offer：</span>{rebate.offerName || '未填写'}</p>
            <p className="break-words"><span className="text-subtle">返利网：</span>{rebate.siteName}</p>
            {rebate.domain && <p className="break-all text-[12px] text-muted">{rebate.domain}</p>}
          </div>)}</div> : <p className="mt-3 text-muted">尚无返利网记录。</p>}
        </div>, document.body,
      )}
    </>
  );
}

async function fileContent(file: File) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('请选择 .xlsx 格式的 Excel 文件。');
  if (!file.size || file.size > maximumFileSize) throw new Error('Excel 文件不能为空，且不能超过 5 MB。');
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';
      if (result) resolve(result);
      else reject(new Error('文件读取失败，请重新选择。'));
    };
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择。'));
    reader.onabort = () => reject(new Error('文件读取已取消。'));
    reader.readAsDataURL(file);
  });
}

export default function FingerprintBrowsersPage() {
  const { toast, request: api } = useWorkspace();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<FingerprintBrowserList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [options, setOptions] = useState<FingerprintBrowserOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FingerprintBrowserRecord | null>(null);
  const [fields, setFields] = useState<FingerprintBrowserInput>(blankFields);
  const [accountSearch, setAccountSearch] = useState('');
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<FingerprintBrowserRecord | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [busy, setBusy] = useState(false);
  const mutationLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importFile, setImportFile] = useState<{ fileName: string; content: string } | null>(null);
  const [preview, setPreview] = useState<FingerprintBrowserImportPreview | null>(null);
  const [importError, setImportError] = useState('');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const query = new URLSearchParams({ search: search.trim(), page: String(page), pageSize: String(pageSize) }).toString();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    const timer = window.setTimeout(() => {
      void api<FingerprintBrowserList>(`/fingerprint-browsers?${query}`, { signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
        if (page > lastPage) { setPage(lastPage); return; }
        setData(result);
        setLoading(false);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) { setLoadError(message(error, '指纹浏览器加载失败')); setLoading(false); }
      });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, revision, page]);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError('');
    void api<FingerprintBrowserOptions>('/fingerprint-browsers/options', { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) { setOptions(result); setOptionsLoading(false); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) { setOptionsError(message(error, '关联邮箱加载失败')); setOptionsLoading(false); }
    });
    return () => controller.abort();
  }, [revision, editorOpen]);

  const accountChoices = useMemo(() => {
    const term = accountSearch.trim().toLowerCase();
    return (options?.accounts || []).filter((account) => `${account.email} ${account.name} ${account.group} ${account.unknown ? '未知' : ''}`.toLowerCase().includes(term));
  }, [options, accountSearch]);
  const missingAccountIds = options && !optionsLoading && !optionsError
    ? fields.accountIds.filter((id) => !options.accounts.some((account) => account.id === id))
    : [];
  const setField = <K extends keyof FingerprintBrowserInput>(key: K, value: FingerprintBrowserInput[K]) => setFields((current) => ({ ...current, [key]: value }));
  const openEditor = (record?: FingerprintBrowserRecord) => {
    if (mutationLock.current) return;
    setEditing(record || null);
    setFields(record ? { serialNumber: record.serialNumber, browserId: record.browserId, windowName: record.windowName, proxyInfo: record.proxyInfo, accountIds: [...record.accountIds] } : blankFields());
    setAccountSearch('');
    setFormError('');
    setEditorOpen(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (mutationLock.current || optionsLoading || optionsError) return;
    mutationLock.current = true;
    setBusy(true);
    setFormError('');
    try {
      await api(editing ? `/fingerprint-browsers/${encodeURIComponent(editing.id)}` : '/fingerprint-browsers', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...fields, serialNumber: fields.serialNumber.trim(), browserId: fields.browserId.trim(), windowName: fields.windowName.trim(), proxyInfo: fields.proxyInfo.trim() }),
      });
      setEditorOpen(false);
      setRevision((value) => value + 1);
      toast(editing ? '指纹浏览器信息已更新。' : '指纹浏览器已添加。');
    } catch (error) { setFormError(message(error, '保存失败，请重试')); }
    finally { mutationLock.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (!deleting || mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setDeleteError('');
    try {
      await api(`/fingerprint-browsers/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
      setDeleting(null);
      setRevision((value) => value + 1);
      toast('指纹浏览器已删除，返利网记录已保留。');
    } catch (error) { setDeleteError(message(error, '删除失败，请重试')); }
    finally { mutationLock.current = false; setBusy(false); }
  };
  const chooseFile = async (file: File) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setImportOpen(true);
    setPreviewing(true);
    setPreview(null);
    setImportFile(null);
    setReplaceConfirmed(false);
    setImportError('');
    try {
      const payload = { fileName: file.name, content: await fileContent(file) };
      const [result, freshOptions] = await Promise.all([
        api<FingerprintBrowserImportPreview>('/fingerprint-browsers/import-preview', { method: 'POST', body: JSON.stringify(payload) }),
        api<FingerprintBrowserOptions>('/fingerprint-browsers/options'),
      ]);
      setOptions(freshOptions);
      setImportFile(payload);
      setPreview(result);
    } catch (error) { setImportError(message(error, '导入预览失败，请检查 Excel 文件')); }
    finally { mutationLock.current = false; setPreviewing(false); }
  };
  const replaceAll = async () => {
    if (!preview || !importFile || !replaceConfirmed || mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setImportError('');
    try {
      const result = await api<FingerprintBrowserImportResult>('/fingerprint-browsers/import', {
        method: 'POST', body: JSON.stringify({ ...importFile, confirmReplace: true }),
      });
      setImportOpen(false);
      setImportFile(null);
      setPreview(null);
      setSearch('');
      setPage(1);
      setRevision((value) => value + 1);
      toast(`已导入 ${result.imported} 个指纹浏览器，完成全部替换。${result.unlinkedRebates ? ` ${result.unlinkedRebates} 条返利网记录已解除浏览器关联。` : ''}`);
    } catch (error) { setImportError(message(error, '导入失败，原有数据未替换')); }
    finally { mutationLock.current = false; setBusy(false); }
  };
  const closeImport = () => { if (!busy && !previewing) { setImportOpen(false); setImportFile(null); setPreview(null); } };
  const maximumPage = Math.max(1, Math.ceil((data?.total || 0) / pageSize));

  return (
    <div className="page-wrap !max-w-none">
      <div className="mx-auto max-w-[1480px]">
        <PageTitle eyebrow="Browser management" title="指纹浏览器" description="管理浏览器窗口、代理与关联邮箱，在返利网记录中选择对应的 ID 和序号。" action={
          <div className="flex flex-wrap gap-2">
            <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label="选择指纹浏览器 Excel 文件" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void chooseFile(file); }} />
            <button className="btn-secondary" disabled={busy || previewing} onClick={() => fileInput.current?.click()}><Upload size={15} />导入 Excel</button>
            <button className="btn-primary" disabled={busy || previewing} onClick={() => openEditor()}><Plus size={15} />新增指纹浏览器</button>
          </div>
        } />
      </div>
      <FingerprintBrowserOverview revision={revision} />
      <div className="panel mx-auto max-w-[1480px] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div className="search-field w-full sm:max-w-sm"><Search size={15} /><input aria-label="搜索指纹浏览器" placeholder="搜索序号、ID、窗口名称、代理或邮箱…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
          <div className="flex items-center gap-3 text-sm text-muted"><span>共 <b className="font-medium tabular-nums text-ink">{data?.total ?? '—'}</b> 个</span><button className="icon-button" aria-label="刷新指纹浏览器" disabled={loading || busy || previewing} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button></div>
        </div>
        {loadError ? <div className="space-y-4 p-5"><ErrorNotice message={loadError} /><button className="btn-secondary" onClick={() => setRevision((value) => value + 1)}>重新加载</button></div>
          : loading ? <Spinner label="正在加载指纹浏览器" />
            : !data?.records.length ? <EmptyState title={search ? '没有匹配的指纹浏览器' : '还没有指纹浏览器'} description={search ? '调整关键词后再试。' : '新增浏览器信息，或导入窗口 Excel，集中管理窗口和邮箱关联。'} action={!search && <button className="btn-primary" onClick={() => openEditor()}><Plus size={15} />新增指纹浏览器</button>} />
              : <>
                <div className="overflow-x-auto" role="region" aria-label="指纹浏览器明细" tabIndex={0}><table className="data-table w-full min-w-[950px] table-fixed border-separate border-spacing-0 text-left text-sm [&_td]:border-b [&_td]:border-line-soft [&_th]:border-b [&_th]:border-line-soft"><colgroup><col style={{ width: 64 }} /><col style={{ width: 120 }} /><col style={{ width: 180 }} /><col style={{ width: 240 }} /><col /><col style={{ width: 128 }} /></colgroup><thead className="border-b border-line-soft bg-surface-muted text-[13px] text-muted"><tr>{['序号', 'ID', '窗口名称', '代理信息', '关联邮箱', '操作'].map((label) => <th key={label} className={`whitespace-nowrap bg-surface-muted py-3.5 font-medium ${label === '序号' ? 'browser-serial-cell !z-20 px-2' : label === 'ID' ? 'browser-id-cell !z-20 px-2' : 'px-5'}`}>{label}</th>)}</tr></thead><tbody className="divide-y divide-line-soft">{data.records.map((record) => <tr key={record.id} className="group align-top transition-colors hover:bg-surface-muted/70">
                  <td className="browser-serial-cell bg-surface px-2 py-4 group-hover:bg-surface-muted font-mono text-[13px] text-ink"><span className="block truncate" title={record.serialNumber}>{record.serialNumber}</span></td>
                  <td className="browser-id-cell bg-surface px-2 py-3 group-hover:bg-surface-muted"><BrowserIdCopy value={record.browserId} /></td>
                  <td className="px-5 py-4 font-medium text-ink"><span className="block truncate" title={record.windowName}>{record.windowName}</span></td>
                  <td className="max-w-[18rem] whitespace-pre-wrap break-all px-5 py-4 font-mono text-[13px] leading-5 text-muted">{record.proxyInfo || '—'}</td>
                  <td className="px-5 py-4">{record.accounts.length ? <div className="flex min-w-[170px] flex-col items-start gap-2">{record.accounts.map((account) => <EmailDetails key={account.id} account={account} />)}</div> : <span className="text-subtle">未关联</span>}</td>
                  <td className="whitespace-nowrap px-5 py-3.5"><div className="flex items-center gap-1"><button className="icon-button" title="编辑" aria-label={`编辑指纹浏览器 ${record.windowName}`} disabled={busy || previewing} onClick={() => openEditor(record)}><Pencil size={14} /></button><button className="icon-button hover:bg-danger-surface hover:text-danger-ink" title="删除" aria-label={`删除指纹浏览器 ${record.windowName}`} disabled={busy || previewing} onClick={() => { setDeleting(record); setDeleteError(''); }}><Trash2 size={14} /></button></div></td>
                </tr>)}</tbody></table></div>
                <div className="flex items-center justify-between gap-3 border-t border-line-soft px-5 py-4 text-[13px] text-muted"><span>第 {data.page} / {maximumPage} 页，每页 {pageSize} 个</span><div className="flex gap-2"><button className="icon-button" aria-label="上一页" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><button className="icon-button" aria-label="下一页" disabled={page >= maximumPage} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div></div>
              </>}
      </div>
      <p className="mx-auto mt-3 max-w-[1480px] text-[13px] leading-6 text-subtle">ID 悬停可查看完整值，点击或按 Enter 可复制。窗口名称保持单行，悬停可查看全名。将鼠标放到关联邮箱上可查看 Offer 和返利网；键盘聚焦邮箱也可查看。Excel 导入会全部替换现有浏览器信息，提交前会显示预览并要求确认。</p>

      <Modal open={editorOpen} onClose={() => { if (!busy) setEditorOpen(false); }} title={editing ? '编辑指纹浏览器' : '新增指纹浏览器'} wide>
        <form onSubmit={(event) => void save(event)}>
          <fieldset disabled={busy} className="space-y-5 px-6 py-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label><span className="field-label">序号 *</span><input className="input font-mono" required maxLength={100} value={fields.serialNumber} onChange={(event) => setField('serialNumber', event.target.value)} placeholder="例如：001" /></label>
              <label><span className="field-label">ID *</span><input className="input font-mono" required maxLength={128} value={fields.browserId} onChange={(event) => setField('browserId', event.target.value)} placeholder="填写浏览器窗口的 ID" /></label>
              <label className="sm:col-span-2"><span className="field-label">窗口名称 *</span><input className="input" required maxLength={200} value={fields.windowName} onChange={(event) => setField('windowName', event.target.value)} placeholder="填写窗口名称" /></label>
              <label className="sm:col-span-2"><span className="field-label">代理信息</span><textarea className="input min-h-20 resize-y font-mono" maxLength={4000} value={fields.proxyInfo} onChange={(event) => setField('proxyInfo', event.target.value)} placeholder="代理地址、端口或备注，可留空" /></label>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2"><span className="field-label mb-0">关联邮箱（可选）</span><span className="text-[12px] text-subtle">已选择 {fields.accountIds.length} 个</span></div>
              {optionsLoading ? <Spinner label="正在加载返利网邮箱" /> : optionsError ? <div className="space-y-3"><ErrorNotice message={optionsError} /><button type="button" className="btn-secondary" onClick={() => setRevision((value) => value + 1)}>重新加载邮箱</button></div> : <>
                <div className="search-field mb-2"><Search size={14} /><input aria-label="搜索可关联邮箱" placeholder="搜索邮箱、名称或分组…" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} /></div>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-line px-3 py-1">{accountChoices.length ? accountChoices.slice(0, 100).map((account) => <label key={account.id} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0"><input type="checkbox" className="size-3.5 shrink-0 accent-accent" checked={fields.accountIds.includes(account.id)} onChange={(event) => setField('accountIds', event.target.checked ? [...fields.accountIds, account.id] : fields.accountIds.filter((value) => value !== account.id))} /><span className="min-w-0 flex-1 break-all text-sm text-body">{account.email}</span><span className="shrink-0 text-[12px] text-subtle">{account.unknown ? '未知' : account.group || '已绑定'}</span></label>) : <p className="py-4 text-center text-sm text-subtle">{accountSearch ? '没有匹配的邮箱' : '暂无可关联的邮箱'}</p>}</div>
                {accountChoices.length > 100 && <p className="mt-2 text-[12px] text-subtle">匹配 {accountChoices.length} 个，显示前 100 个；继续搜索可缩小范围。</p>}
                {missingAccountIds.length > 0 && <div className="mt-3 space-y-2 rounded-lg border border-warning-line bg-warning-surface p-3 text-[13px] text-warning-ink"><p>以下邮箱已不在返利网邮箱列表中，请移除后保存：</p>{missingAccountIds.map((id) => <div key={id} className="flex items-center justify-between gap-3"><span className="min-w-0 break-all">{editing?.accounts.find((account) => account.id === id)?.email || '已失效邮箱'}</span><button type="button" className="shrink-0 underline underline-offset-2" onClick={() => setField('accountIds', fields.accountIds.filter((value) => value !== id))}>移除</button></div>)}</div>}
              </>}
              <p className="mt-2 text-[12px] leading-5 text-subtle">邮箱与返利网页面共用，包含“未知”邮箱。在返利网记录中选择此浏览器后，对应邮箱也会自动展示。</p>
            </div>
            {formError && <ErrorNotice message={formError} />}
          </fieldset>
          <div className="flex justify-end gap-3 border-t border-line-soft px-6 py-4"><button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditorOpen(false)}>取消</button><button type="submit" className="btn-primary" disabled={busy || optionsLoading || Boolean(optionsError) || missingAccountIds.length > 0}>{busy ? '正在保存…' : '保存信息'}</button></div>
        </form>
      </Modal>

      <Modal open={Boolean(deleting)} onClose={() => { if (!busy) setDeleting(null); }} title="删除指纹浏览器">
        <div className="space-y-3 px-6 py-5 text-sm leading-7 text-muted"><p>确认删除 <b className="break-all font-medium text-ink">{deleting?.windowName}</b>（序号 {deleting?.serialNumber}）？</p><p>相关返利网记录会保留，并解除与此浏览器的关联。删除后无法恢复。</p>{deleteError && <ErrorNotice message={deleteError} />}</div>
        <div className="flex justify-end gap-3 border-t border-line-soft px-6 py-4"><button className="btn-secondary" disabled={busy} onClick={() => setDeleting(null)}>取消</button><button className="btn-danger" disabled={busy} onClick={() => void remove()}>{busy ? '正在删除…' : '确认删除'}</button></div>
      </Modal>

      <Modal open={importOpen} onClose={closeImport} title="导入指纹浏览器 Excel" wide>
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-3 rounded-xl border border-warning-line bg-warning-surface p-4 text-sm leading-6 text-warning-ink"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><div><b className="font-semibold">导入后将全部替换现有指纹浏览器信息。</b><p>Excel 中没有的浏览器会被删除，其返利网记录会保留并解除浏览器关联。相同 ID 的浏览器继续保留关联；请先核对预览。</p></div></div>
          {previewing ? <Spinner label="正在读取 Excel 并生成预览，不会修改现有数据" /> : <>
            {importFile && <p className="flex items-center gap-2 break-all text-sm text-muted"><FileSpreadsheet size={16} className="shrink-0 text-accent" />{importFile.fileName}</p>}
            {preview && <>
              <p className="text-sm text-body">当前共有 <b className="tabular-nums">{options?.browsers.length ?? '—'}</b> 个浏览器，本次导入 <b className="tabular-nums text-accent">{preview.count}</b> 个。</p>
              <div className="max-h-64 overflow-auto rounded-lg border border-line"><table className="data-table w-full min-w-[470px] text-left"><thead className="sticky top-0 bg-surface-muted text-muted"><tr>{['序号', 'ID', '窗口名称', '代理信息'].map((label) => <th key={label} className="px-3 py-2.5 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-line-soft">{preview.records.slice(0, 50).map((record, index) => <tr key={`${record.browserId}-${index}`} className="align-top"><td className="px-3 py-2.5 font-mono">{record.serialNumber}</td><td className="max-w-36 break-all px-3 py-2.5 font-mono">{record.browserId}</td><td className="max-w-40 break-words px-3 py-2.5">{record.windowName}</td><td className="max-w-48 whitespace-pre-wrap break-all px-3 py-2.5 text-muted">{record.proxyInfo || '—'}</td></tr>)}</tbody></table></div>
              {preview.records.length > 50 && <p className="text-[12px] text-subtle">预览显示前 50 行，确认后将导入全部 {preview.count} 行。</p>}
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-3 text-sm leading-6 text-body"><input type="checkbox" className="mt-1 size-3.5 shrink-0 accent-accent" checked={replaceConfirmed} disabled={busy} onChange={(event) => setReplaceConfirmed(event.target.checked)} /><span>我已核对预览，确认全部替换现有指纹浏览器信息。</span></label>
            </>}
            {importError && <ErrorNotice message={importError} />}
          </>}
          <p className="text-[12px] leading-5 text-subtle">兼容“导出窗口”模板，读取“序号、ID、窗口名称、代理信息”列，跳过说明行及其他工作表；仅支持 .xlsx，文件不超过 5 MB。</p>
        </div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-line-soft px-6 py-4"><button className="btn-secondary" disabled={busy || previewing} onClick={closeImport}>取消</button><button className="btn-secondary" disabled={busy || previewing} onClick={() => fileInput.current?.click()}>重新选择文件</button><button className="btn-danger" disabled={busy || previewing || !preview?.count || !replaceConfirmed} onClick={() => void replaceAll()}>{busy ? '正在替换…' : '确认导入并全部替换'}</button></div>
      </Modal>
    </div>
  );
}

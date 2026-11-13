import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Inbox,
  Mail,
  Paperclip,
  PenLine,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { Link, useSearchParams } from 'react-router-dom';
import { dateLabel } from '../api';
import {
  Avatar,
  EmptyState,
  ErrorNotice,
  PageTitle,
  Spinner,
} from '../components/ui';
import ComposeModal from '../components/ComposeModal';
import MailAccountTree from '../components/MailAccountTree';
import { useWorkspace } from '../workspace';
import type { Folder, MailDetail, MailFolder, MailList, MailMessage } from '../types';

const fallbackFolders: MailFolder[] = [
  { id: 'inbox', name: '收件箱', path: '/Inbox', type: 'inbox' },
  { id: 'spam', name: '垃圾邮件', path: '/Spam', type: 'spam' },
  { id: 'sent', name: '已发送', path: '/Sent', type: 'sent' },
];
const folderIcons = { inbox: Inbox, spam: ShieldAlert, sent: Send, other: FolderOpen };
const LIMIT = 30;

export default function MailPage() {
  const { accounts, loading: accountsLoading, refresh, toast, request: api } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('account');
  const selectedId =
    accounts.find((item) => item.id === requestedId)?.id ||
    accounts[0]?.id ||
    '';
  const account = accounts.find((item) => item.id === selectedId);
  const [version, setVersion] = useState(0);
  const [folderState, setFolderState] = useState<{
    accountId: string;
    requestKey: string;
    items: MailFolder[];
    loading: boolean;
    error: string;
  }>({ accountId: '', requestKey: '', items: [], loading: false, error: '' });
  const [folderSelection, setFolderSelection] = useState<{ accountId: string; id: string; type?: Folder }>({ accountId: '', id: '' });
  const [folderRevision, setFolderRevision] = useState(0);
  const folderLoadKey = `${selectedId}:${version}:${folderRevision}`;
  const currentFolders = folderState.accountId === selectedId ? folderState : undefined;
  const folderLoading = Boolean(selectedId && (!currentFolders || currentFolders.loading || currentFolders.requestKey !== folderLoadKey));
  const folders = currentFolders?.items.length ? currentFolders.items : fallbackFolders;
  const activeFolder = (folderSelection.accountId === selectedId
    ? folders.find((item) => item.id === folderSelection.id)
      || (folderSelection.type !== 'other' ? folders.find((item) => item.type === folderSelection.type) : undefined) : undefined)
    || folders.find((item) => item.type === 'inbox') || folders[0];
  const folder: Folder = activeFolder.type;
  // Before the server folder list is available, use the compatible default routes without an ID.
  const folderId = currentFolders?.items.length ? activeFolder.id : '';
  const folderScope = `${selectedId}:${folder}:${folderId}`;
  const [search, setSearch] = useState('');
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [pagination, setPagination] = useState({ scope: '', start: 1 });
  const start = pagination.scope === folderScope ? pagination.start : 1;
  const setStart = (value: number) => setPagination({ scope: folderScope, start: value });
  const [hasMore, setHasMore] = useState(false);
  const [cached, setCached] = useState(false);
  const [compose, setCompose] = useState(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const currentScope = useRef(folderScope);
  currentScope.current = folderScope;
  useEffect(() => {
    if (params.get('compose')) {
      setCompose(true);
      const next = new URLSearchParams(params);
      next.delete('compose');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);
  useEffect(() => {
    setSelected(null);
    setDetail(null);
    setDetailError('');
    setError('');
    setSearch('');
    detailRequest.current++;
  }, [folderScope]);
  useEffect(() => {
    if (!selectedId || !account) return;
    const controller = new AbortController();
    setFolderState((current) => ({
      accountId: selectedId,
      requestKey: folderLoadKey,
      items: current.accountId === selectedId ? current.items : [],
      loading: true,
      error: '',
    }));
    void api<MailFolder[]>(`/accounts/${encodeURIComponent(selectedId)}/folders`, { signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(items) || !items.length || items.some((item) =>
          !item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' ||
          typeof item.path !== 'string' || !['inbox', 'spam', 'sent', 'other'].includes(item.type)))
          throw new Error('邮箱返回的文件夹列表无效');
        setFolderState({ accountId: selectedId, requestKey: folderLoadKey, items: [...new Map(items.map((item) => [item.id, item])).values()], loading: false, error: '' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFolderState((current) => ({
          accountId: selectedId,
          requestKey: folderLoadKey,
          items: current.accountId === selectedId ? current.items : [],
          loading: false,
          error: error instanceof Error ? error.message : '文件夹加载失败',
        }));
      });
    return () => controller.abort();
  }, [selectedId, !!account, folderLoadKey]);
  useEffect(() => {
    const request = ++listRequest.current;
    if (!selectedId || !account) {
      setMessages([]);
      setLoading(false);
      return;
    }
    if (folderLoading) {
      setLoading(true);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setSelected(null);
    setDetail(null);
    detailRequest.current++;
    api<MailList>(
      `/accounts/${encodeURIComponent(selectedId)}/messages?${new URLSearchParams({ folder,
        ...(folderId ? { folderId } : {}), start: String(start), limit: String(LIMIT) })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted && request === listRequest.current) {
          setMessages(result.messages);
          setHasMore(result.hasMore);
          setCached(result.cached);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && request === listRequest.current) {
          setMessages([]);
          setHasMore(false);
          setError(error instanceof Error ? error.message : '邮件加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && request === listRequest.current) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [selectedId, !!account, folder, folderId, folderLoading, start, version]);
  const visible = useMemo(
    () =>
      messages.filter((message) =>
        `${message.subject} ${message.from} ${message.fromName} ${message.preview}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [messages, search],
  );
  const openMessage = async (message: MailMessage) => {
    const request = ++detailRequest.current;
    setSelected(message);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const value = await api<MailDetail>(
        `/accounts/${encodeURIComponent(message.accountId)}/messages/${encodeURIComponent(message.id)}?folderId=${encodeURIComponent(message.folderId)}`,
      );
      if (request === detailRequest.current) {
        setDetail(value);
        void refresh();
        setMessages((items) =>
          items.map((item) =>
            item.id === message.id ? { ...item, isRead: value.isRead } : item,
          ),
        );
      }
    } catch (error) {
      if (request === detailRequest.current)
        setDetailError(error instanceof Error ? error.message : '正文加载失败');
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };
  const sync = async () => {
    if (!selectedId || syncing || folderLoading) return;
    const scope = folderScope;
    setSyncing(true);
    setError('');
    try {
      await api(`/accounts/${encodeURIComponent(selectedId)}/sync?${new URLSearchParams({ folder, ...(folderId ? { folderId } : {}) })}`, {
        method: 'POST',
      });
      if (currentScope.current !== scope) return;
      setStart(1);
      setVersion((value) => value + 1);
      await refresh();
      toast(`已刷新${activeFolder.name}，正在获取邮件列表。`);
    } catch (error) {
      setError(error instanceof Error ? error.message : '刷新失败');
    } finally {
      setSyncing(false);
    }
  };
  const selectAccount = (id: string) => {
    if (syncing || id === selectedId) return;
    listRequest.current++;
    detailRequest.current++;
    setFolderSelection({ accountId: id, id: '', type: 'inbox' });
    setMessages([]);
    setSelected(null);
    setDetail(null);
    setDetailError('');
    setSearch('');
    setLoading(true);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('account', id);
      return next;
    });
  };
  const sanitized = useMemo(
    () =>
      detail?.format === 'html'
        ? DOMPurify.sanitize(detail.content, {
            FORBID_TAGS: [
              'img',
              'style',
              'form',
              'input',
              'button',
              'iframe',
              'object',
              'embed',
              'link',
              'video',
              'audio',
              'svg',
              'math',
            ],
            FORBID_ATTR: ['style', 'srcset', 'background', 'color', 'bgcolor'],
            ADD_ATTR: ['rel'],
          })
        : '',
    [detail],
  );
  return (
    <div className="page-wrap">
      <PageTitle
        eyebrow="Mail workspace"
        title="重要消息，尽在眼前。"
        description="选择一个邮箱，安静地处理当下的每一封邮件。"
        action={
          <button
            className="btn-primary"
            disabled={!accounts.some((item) => item.status === 'connected')}
            onClick={() => setCompose(true)}
          >
            <PenLine size={14} />
            写邮件
          </button>
        }
      />
      {accountsLoading ? (
        <Spinner />
      ) : !accounts.length ? (
        <div className="panel">
          <EmptyState
            title="从连接一个邮箱开始"
            description="添加 Zoho 或 Outlook 账号后，就可以查看收件箱、垃圾邮件并发送邮件。"
            action={
              <Link to="/accounts" className="btn-primary">
                前往添加邮箱
                <ArrowUpRight size={14} />
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)] xl:items-stretch 2xl:grid-cols-[280px_minmax(0,1fr)]">
            <MailAccountTree
              accounts={accounts}
              selectedId={selectedId}
              disabled={syncing}
              onSelect={selectAccount}
            />
            <div className="min-w-0">
              <div className="panel mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={account?.name || account?.email || '邮箱'}
                    small
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {account?.name || account?.email}
                    </p>
                    <p className="mt-1 truncate text-[12px] text-subtle">
                      {account?.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden text-[12px] text-subtle md:inline">
                    仅刷新当前邮箱
                  </span>
                  <button
                    className="btn-secondary py-2"
                    onClick={() => void sync()}
                    disabled={syncing || loading || folderLoading || !account}
                  >
                    <RefreshCw
                      size={13}
                      className={syncing ? 'animate-spin' : ''}
                    />
                    {syncing ? '刷新中…' : '刷新邮件'}
                  </button>
                </div>
              </div>
              <section className="panel overflow-hidden">
                <div className="border-b px-2">
                  <div className="flex overflow-x-auto" role="tablist" aria-label="邮箱文件夹">
                    {folders.map((item) => {
                      const Icon = folderIcons[item.type];
                      return (
                        <button
                          key={item.id}
                          role="tab"
                          aria-selected={activeFolder.id === item.id}
                          title={item.path || item.name}
                          className={`tab shrink-0 whitespace-nowrap ${activeFolder.id === item.id ? 'tab-active' : ''}`}
                          disabled={folderLoading || syncing}
                          onClick={() => {
                            if (activeFolder.id === item.id) return;
                            listRequest.current++;
                            detailRequest.current++;
                            setFolderSelection({ accountId: selectedId, id: item.id, type: item.type });
                          }}
                        >
                          <Icon size={14} />
                          {item.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="px-2 pb-2 text-[12px] text-subtle" role={folderLoading ? 'status' : undefined}>
                    {folderLoading ? '正在读取邮箱文件夹…' : `${folders.length} 个文件夹 · 可左右滚动切换`}
                    <span className="ml-3 hidden sm:inline">{cached ? '缓存内容' : '最近获取'} · {dateLabel(account?.lastSyncedAt || null, true)}</span>
                  </p>
                </div>
                {currentFolders?.error && (
                  <div className="space-y-2 border-b border-line-soft p-4">
                    <ErrorNotice message={`文件夹列表加载失败：${currentFolders.error}`} />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
                      <p>{currentFolders.items.length ? '暂时显示上次读取的文件夹列表。' : '暂时保留收件箱、垃圾邮件和已发送；通知等其他文件夹需重试加载。'}</p>
                      <button className="btn-secondary py-1.5" disabled={folderLoading || syncing} onClick={() => setFolderRevision((value) => value + 1)}>重试加载文件夹</button>
                    </div>
                  </div>
                )}
                {error && (
                  <div className="p-4">
                    <ErrorNotice message={error} />
                    {start > 1 && (
                      <button
                        className="btn-secondary mt-3"
                        disabled={loading || syncing}
                        onClick={() => setStart(1)}
                      >
                        回到第一页
                      </button>
                    )}
                  </div>
                )}
                <div className="grid min-h-[590px] lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]">
                  <div
                    className={`flex flex-col border-r border-line/70 ${selected ? 'hidden lg:flex' : 'flex'}`}
                  >
                    <div className="border-b border-line-soft p-3">
                      <div className="search-field border-line-soft bg-surface-muted">
                        <Search size={14} />
                        <input
                          aria-label="筛选当前页邮件"
                          placeholder="筛选当前页邮件…"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="max-h-[620px] min-h-96 flex-1 overflow-y-auto">
                      {loading ? (
                        <Spinner label="正在获取邮件" />
                      ) : visible.length ? (
                        visible.map((message) => (
                          <button
                            key={message.id}
                            className={`relative flex w-full gap-3 border-b border-line-soft px-4 py-5 text-left transition-colors hover:bg-surface-muted ${selected?.id === message.id ? 'bg-accent-muted/80' : ''}`}
                            onClick={() => void openMessage(message)}
                          >
                            {selected?.id === message.id && (
                              <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-600" />
                            )}
                            <Avatar
                              name={
                                folder === 'sent'
                                  ? message.to
                                  : message.fromName || message.from
                              }
                              small
                            />
                            <span className="block min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span
                                  className={`truncate text-[13px] ${message.isRead ? 'text-body' : 'font-semibold text-ink'}`}
                                >
                                  {folder === 'sent'
                                    ? message.to
                                    : message.fromName || message.from}
                                </span>
                                <time className="shrink-0 text-[12px] text-subtle">
                                  {dateLabel(message.receivedAt)}
                                </time>
                              </span>
                              <span
                                className={`mt-2 block truncate text-sm ${message.isRead ? 'text-body' : 'font-semibold'}`}
                              >
                                {message.subject || '（无主题）'}
                              </span>
                              <span className="mt-1.5 block truncate text-[12px] leading-5 text-subtle">
                                {message.preview || '打开查看邮件内容'}
                              </span>
                              <span className="mt-2 flex h-3 items-center gap-2">
                                {!message.isRead && (
                                  <span
                                    className="size-1.5 rounded-full bg-brand-500"
                                    aria-label="未读"
                                  />
                                )}
                                {message.hasAttachment && (
                                  <Paperclip
                                    size={11}
                                    className="text-subtle"
                                  />
                                )}
                              </span>
                            </span>
                          </button>
                        ))
                      ) : (
                        <EmptyState
                          title={search ? '没有匹配的邮件' : '这里暂时没有邮件'}
                          description={
                            search
                              ? '筛选仅作用于当前页，试试其他关键词。'
                              : '可以刷新当前邮箱，或切换其他文件夹。'
                          }
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t px-4 py-3 text-[12px] text-subtle">
                      <span>
                        {messages.length
                          ? `第 ${start}–${start + messages.length - 1} 封`
                          : '0 封邮件'}
                      </span>
                      <div className="flex gap-1">
                        <button
                          className="icon-button size-7"
                          aria-label="上一页邮件"
                          disabled={start === 1 || loading}
                          onClick={() => setStart(Math.max(1, start - LIMIT))}
                        >
                          <ChevronLeft size={15} />
                        </button>
                        <button
                          className="icon-button size-7"
                          aria-label="下一页邮件"
                          disabled={!hasMore || loading}
                          onClick={() => setStart(start + LIMIT)}
                        >
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div
                    className={`min-w-0 bg-surface ${!selected ? 'hidden lg:block' : ''}`}
                  >
                    {!selected ? (
                      <div className="flex h-full min-h-[590px] items-center justify-center bg-surface-muted/30">
                        <EmptyState
                          title="留一点空间，专注阅读。"
                          description="从左侧选择一封邮件，在这里查看完整内容。"
                        />
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
                          <button
                            className="btn-quiet lg:invisible"
                            onClick={() => {
                              setSelected(null);
                              detailRequest.current++;
                            }}
                          >
                            <ArrowLeft size={14} />
                            返回列表
                          </button>
                          <span className="badge-muted">
                            {activeFolder.name}
                          </span>
                        </div>
                        {detailLoading ? (
                          <Spinner label="正在加载正文" />
                        ) : detailError ? (
                          <div className="p-6">
                            <ErrorNotice message={detailError} />
                            <button
                              className="btn-secondary mt-4"
                              onClick={() => void openMessage(selected)}
                            >
                              重新加载正文
                            </button>
                          </div>
                        ) : (
                          detail && (
                            <div className="p-6 md:p-8">
                              <h2 className="text-xl leading-relaxed font-semibold break-words">
                                {detail.subject || '（无主题）'}
                              </h2>
                              <div className="my-6 flex items-start gap-3 border-b border-line-soft pb-6">
                                <Avatar name={detail.fromName || detail.from} />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium break-all">
                                    {detail.fromName || detail.from}
                                  </p>
                                  <p className="mt-1 text-[12px] leading-5 break-all text-subtle">
                                    {detail.from}
                                    <br />
                                    发送至 {detail.to}
                                  </p>
                                </div>
                                <time className="shrink-0 text-[12px] text-subtle">
                                  {dateLabel(detail.receivedAt, true)}
                                </time>
                              </div>
                              {folder === 'spam' && (
                                <div className="mb-5 rounded-lg border border-warning-line bg-warning-surface p-3 text-[13px] leading-6 text-warning-ink">
                                  这封邮件位于垃圾邮件中，请谨慎核对其中的链接和内容。
                                </div>
                              )}
                              {detail.format === 'html' ? (
                                <div
                                  className="email-content overflow-x-auto"
                                  dangerouslySetInnerHTML={{
                                    __html: sanitized,
                                  }}
                                />
                              ) : (
                                <div className="email-content whitespace-pre-wrap">
                                  {detail.content}
                                </div>
                              )}
                              {detail.hasAttachment && (
                                <p className="mt-8 flex items-center gap-2 rounded-lg bg-surface-muted p-3 text-[12px] text-muted">
                                  <Paperclip size={13} />
                                  此邮件包含附件，可前往对应邮箱的网页版下载。
                                </p>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-[12px] leading-5 text-subtle">
            <Mail size={12} />
            邮件按账号分页加载；页面不同时轮询全部邮箱。邮件中的远程图片默认不加载。
          </p>
        </>
      )}
      <ComposeModal
        open={compose}
        initialAccountId={account?.id}
        onClose={() => {
          setCompose(false);
          setVersion((value) => value + 1);
        }}
      />
    </div>
  );
}

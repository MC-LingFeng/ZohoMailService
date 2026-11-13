import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Send, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '../workspace';
import { ErrorNotice, Modal } from './ui';

export default function ComposeModal({
  open,
  onClose,
  initialAccountId,
}: {
  open: boolean;
  onClose: () => void;
  initialAccountId?: string;
}) {
  const { accounts, status, toast, refresh, request: api } = useWorkspace();
  const [accountId, setAccountId] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const available = accounts.filter(
    (account) => account.status === 'connected',
  );
  const sender = available.find((account) => account.id === accountId);
  useEffect(() => {
    if (open) {
      setAccountId(
        available.some((account) => account.id === initialAccountId)
          ? initialAccountId!
          : available[0]?.id || '',
      );
      setReview(false);
      setError('');
    }
    // Keep a draft if the dialog is closed before sending.
  }, [open, initialAccountId]);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!review) {
      setReview(true);
      return;
    }
    if (!sender || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ messageId: string; demo: boolean }>(
        `/accounts/${encodeURIComponent(accountId)}/send`,
        { method: 'POST', body: JSON.stringify({ to, subject, content }) },
      );
      toast(
        result.demo
          ? '演示邮件已保存到已发送，不会向外部投递。'
          : '邮件已提交至 Zoho 发送。',
      );
      setTo('');
      setSubject('');
      setContent('');
      onClose();
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : '发送失败');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={review ? '确认邮件信息' : '写一封新邮件'}
      wide
    >
      <form onSubmit={(event) => void send(event)} className="space-y-5 p-6">
        {status.mode === 'demo' && (
          <div className="notice">
            <ShieldCheck size={18} className="mt-0.5 shrink-0" />
            <span>演示模式 · 邮件只会保存到演示数据，不会实际投递。</span>
          </div>
        )}
        {!review ? (
          <>
            <label className="block">
              <span className="field-label">发件邮箱</span>
              <select
                className="input"
                required
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                <option value="" disabled>
                  请选择发件账号
                </option>
                {available.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">收件人</span>
              <input
                className="input"
                type="email"
                required
                maxLength={254}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="name@example.com"
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="field-label">主题</span>
              <input
                className="input"
                required
                maxLength={300}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="给这封邮件写一个主题"
              />
            </label>
            <label className="block">
              <span className="field-label">正文</span>
              <textarea
                className="input min-h-52 resize-y"
                required
                maxLength={100000}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="你好，"
              />
            </label>
          </>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-[56px_1fr] gap-x-4 gap-y-3 text-sm">
              <dt className="text-subtle">发件人</dt>
              <dd className="break-all font-medium text-accent">
                {sender?.email || '请返回选择账号'}
              </dd>
              <dt className="text-subtle">收件人</dt>
              <dd className="break-all">{to}</dd>
              <dt className="text-subtle">主题</dt>
              <dd className="break-words">{subject}</dd>
            </dl>
            <div className="max-h-64 overflow-auto rounded-xl bg-surface-muted p-4 text-sm leading-7 whitespace-pre-wrap">
              {content}
            </div>
          </div>
        )}
        {error && <ErrorNotice message={error} />}
        <div className="flex items-center justify-between border-t pt-5">
          <span className="text-[12px] text-subtle">
            {review ? '请核对发件账号与收件人' : '通过当前选中的邮箱发送'}
          </span>
          <div className="flex gap-2">
            {review && (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setReview(false)}
              >
                <ArrowLeft size={14} />
                返回编辑
              </button>
            )}
            <button
              className="btn-primary"
              type="submit"
              disabled={busy || !sender}
            >
              <Send size={14} />
              {busy
                ? '正在发送…'
                : review
                  ? status.mode === 'demo'
                    ? '模拟发送'
                    : '确认发送'
                  : '预览并发送'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

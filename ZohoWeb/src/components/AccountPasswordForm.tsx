import { useState, type FormEvent } from 'react';
import { KeyRound, Save } from 'lucide-react';
import { useWorkspace } from '../workspace';
import { ErrorNotice } from './ui';

export default function AccountPasswordForm() {
  const { status, request: api, reloadStatus } = useWorkspace();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmation) { setError('两次输入的新密码不一致。'); return; }
    setBusy(true);
    setError('');
    try {
      await api('/me/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, password }) });
      setCurrentPassword('');
      setPassword('');
      setConfirmation('');
      await reloadStatus();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '密码修改失败'); }
    finally { setBusy(false); }
  };
  return <section className="panel mt-6 p-5 md:p-6">
    <h2 className="section-title flex items-center gap-2"><KeyRound size={17} />账号密码</h2>
    <p className="mt-2 text-[13px] leading-6 text-muted">当前账号：{status.user?.username}。修改密码后，所有设备上的登录会话都会失效，请使用新密码重新登录。</p>
    <form className="mt-5 space-y-4" onSubmit={(event) => void save(event)}>
      {error && <ErrorNotice message={error} />}
      <div className="grid gap-4 md:grid-cols-3">
        <label><span className="field-label">当前密码</span><input className="input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={256} required disabled={busy} /></label>
        <label><span className="field-label">新密码（至少 12 位）</span><input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={256} required disabled={busy} /></label>
        <label><span className="field-label">再次输入新密码</span><input className="input" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={12} maxLength={256} required disabled={busy} /></label>
      </div>
      <button className="btn-primary" disabled={busy || !currentPassword || password.length < 12 || !confirmation}><Save size={14} />{busy ? '正在修改…' : '修改密码并重新登录'}</button>
    </form>
  </section>;
}

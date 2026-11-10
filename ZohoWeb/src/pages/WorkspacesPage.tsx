import { useEffect, useState, type FormEvent } from 'react';
import { Building2, Plus, RefreshCw, Save, Trash2, UserPlus } from 'lucide-react';
import { EmptyState, ErrorNotice, PageTitle, Spinner } from '../components/ui';
import type { WorkspaceMember, WorkspaceSummary } from '../types';
import { useWorkspace } from '../workspace';

export default function WorkspacesPage() {
  const { workspace, status, reloadWorkspaces, request: api, toast } = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const [newName, setNewName] = useState('');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [memberRevision, setMemberRevision] = useState(0);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('member');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [membersError, setMembersError] = useState('');
  const isOwner = workspace.role === 'owner';
  const memberPath = `/workspaces/${encodeURIComponent(workspace.id)}/members`;

  useEffect(() => setName(workspace.name), [workspace.name]);
  useEffect(() => {
    if (!isOwner) {
      setMembers([]);
      setMembersError('');
      setMembersLoading(false);
      return;
    }
    const controller = new AbortController();
    setMembersLoading(true);
    setMembersError('');
    void api<{ members: WorkspaceMember[] } | WorkspaceMember[]>(memberPath, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setMembers(Array.isArray(result) ? result : result.members);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setMembersError(reason instanceof Error ? reason.message : '成员读取失败');
    }).finally(() => { if (!controller.signal.aborted) setMembersLoading(false); });
    return () => controller.abort();
  }, [api, isOwner, memberPath, memberRevision]);

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent, operation: () => Promise<void>) => { event.preventDefault(); void run(operation); };

  return <div className="page-wrap">
    <PageTitle eyebrow="Workspaces" title="工作区管理" description="每个工作区独立保存邮箱、浏览器、返利网记录和配置；只有工作区成员可以访问。" />
    {error && <div className="mb-5"><ErrorNotice message={error} /></div>}
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <section className="panel p-5 md:p-6">
        <h2 className="section-title flex items-center gap-2"><Building2 size={17} />当前工作区</h2>
        <p className="mt-2 text-[11px] text-muted">你的角色：{isOwner ? '所有者' : '成员'}</p>
        <form className="mt-5 space-y-4" onSubmit={(event) => submit(event, async () => {
          await api(`/workspaces/${encodeURIComponent(workspace.id)}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
          await reloadWorkspaces();
          toast('工作区名称已更新。');
        })}>
          <label className="block"><span className="field-label">工作区名称</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={!isOwner || busy} /></label>
          {isOwner && <button className="btn-primary" disabled={busy || !name.trim() || name.trim() === workspace.name}><Save size={14} />保存名称</button>}
        </form>
      </section>
      <section className="panel p-5 md:p-6">
        <h2 className="section-title flex items-center gap-2"><Plus size={17} />新建工作区</h2>
        <p className="mt-2 text-[11px] leading-6 text-muted">新工作区从空白开始，你将成为该工作区的所有者。</p>
        <form className="mt-4 space-y-4" onSubmit={(event) => submit(event, async () => {
          const created = await api<WorkspaceSummary>('/workspaces', { method: 'POST', body: JSON.stringify({ name: newName.trim() }) });
          await reloadWorkspaces(created.id);
        })}>
          <label className="block"><span className="field-label">新工作区名称</span><input className="input" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={80} required disabled={busy} placeholder="例如：团队 A" /></label>
          <button className="btn-primary" disabled={busy || !newName.trim()}><Plus size={14} />创建并进入</button>
        </form>
      </section>
      {isOwner && <section className="panel overflow-hidden xl:col-span-2">
        <div className="flex items-center justify-between gap-4 border-b border-line-soft p-5 md:px-6"><h2 className="section-title">工作区成员</h2><button type="button" className="icon-button" aria-label="刷新工作区成员" disabled={membersLoading || busy} onClick={() => setMemberRevision((value) => value + 1)}><RefreshCw size={15} /></button></div>
        {membersError && <div className="p-5"><ErrorNotice message={membersError} /></div>}
        {membersLoading ? <Spinner label="正在读取成员" /> : !members.length ? <EmptyState title="暂无成员" description="所有者可以添加已创建的平台账号。" /> : <ul className="divide-y divide-line-soft">{members.map((member) => <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-6">
          <p className="min-w-0 break-all text-xs font-medium">{member.username}{member.userId === status.user?.id && <span className="ml-2 text-[10px] font-normal text-muted">你</span>}</p>
          <div className="flex items-center gap-2">{isOwner ? <select className="input w-auto py-2" aria-label={`${member.username}的工作区角色`} value={member.role} disabled={busy} onChange={(event) => { const nextRole = event.target.value; void run(async () => { await api(`${memberPath}/${encodeURIComponent(member.userId)}`, { method: 'PATCH', body: JSON.stringify({ role: nextRole }) }); await reloadWorkspaces(); setMemberRevision((value) => value + 1); }); }}><option value="member">成员</option><option value="owner">所有者</option></select> : <span className="badge-muted">{member.role === 'owner' ? '所有者' : '成员'}</span>}
            {isOwner && <button type="button" className="icon-button hover:text-danger-ink" aria-label={`移除成员 ${member.username}`} disabled={busy} onClick={() => void run(async () => { await api(`${memberPath}/${encodeURIComponent(member.userId)}`, { method: 'DELETE' }); await reloadWorkspaces(); setMemberRevision((value) => value + 1); })}><Trash2 size={14} /></button>}
          </div>
        </li>)}</ul>}
        {isOwner && <form className="flex flex-wrap items-end gap-3 border-t border-line-soft p-5 md:p-6" onSubmit={(event) => submit(event, async () => { await api(memberPath, { method: 'POST', body: JSON.stringify({ username: username.trim(), role }) }); setUsername(''); setMemberRevision((value) => value + 1); toast('成员已添加。'); })}>
          <label className="min-w-0 flex-1"><span className="field-label">添加已有账号</span><input className="input" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={80} required disabled={busy} autoComplete="off" placeholder="输入用户名" /></label>
          <label><span className="field-label">角色</span><select className="input" value={role} onChange={(event) => setRole(event.target.value as 'owner' | 'member')} disabled={busy}><option value="member">成员</option><option value="owner">所有者</option></select></label>
          <button className="btn-primary" disabled={busy || !username.trim()}><UserPlus size={14} />添加成员</button>
        </form>}
      </section>}
      {status.user?.isPlatformAdmin && <section className="panel p-5 md:p-6 xl:col-span-2">
        <h2 className="section-title">创建平台账号</h2>
        <p className="mt-2 text-[11px] leading-6 text-muted">新账号创建后，可将其添加为当前工作区成员。账号不会自动获得其他工作区的访问权限。</p>
        <form className="mt-5 grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => submit(event, async () => { await api('/users', { method: 'POST', body: JSON.stringify({ username: newUsername.trim(), password: newPassword }) }); setUsername(newUsername.trim()); setNewUsername(''); setNewPassword(''); toast('平台账号已创建，可在上方添加为成员。'); })}>
          <label><span className="field-label">用户名</span><input className="input" value={newUsername} onChange={(event) => setNewUsername(event.target.value)} required maxLength={80} autoComplete="off" disabled={busy} /></label>
          <label><span className="field-label">初始密码（至少 12 位）</span><input className="input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={12} maxLength={256} autoComplete="new-password" disabled={busy} /></label>
          <button className="btn-primary" disabled={busy || !newUsername.trim() || newPassword.length < 12}><UserPlus size={14} />创建账号</button>
        </form>
      </section>}
    </div>
  </div>;
}

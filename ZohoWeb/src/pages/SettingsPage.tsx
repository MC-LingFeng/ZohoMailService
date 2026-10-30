import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FileSliders, KeyRound, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { api } from '../api';
import { ErrorNotice, PageTitle, Spinner } from '../components/ui';
import type { AppSettings, SettingsField } from '../types';
import { useWorkspace } from '../workspace';

function fieldValue(field: SettingsField, changes: Record<string, string>) {
  return Object.hasOwn(changes, field.key) ? changes[field.key] : field.value ?? '';
}

function ConfigurationField({ field, changes, disabled, onChange }: {
  field: SettingsField;
  changes: Record<string, string>;
  disabled: boolean;
  onChange: (field: SettingsField, value: string) => void;
}) {
  const id = `setting-${field.key}`;
  const value = fieldValue(field, changes);
  const readOnly = disabled || field.readOnly;
  const numeric = field.key === 'PORT' || field.key === 'ZOHO_MIN_REQUEST_INTERVAL_MS';
  const multiline = !field.secret && (field.value?.includes('\n') || value.includes('\n'));
  return (
    <div className="min-w-0">
      <label className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium text-body" htmlFor={id}>
        {field.label}
        {field.secret && <KeyRound size={12} className="text-subtle" aria-hidden="true" />}
        {field.readOnly && <span className="text-[10px] font-normal text-subtle">只读</span>}
      </label>
      <p className="mb-2 break-all font-mono text-[10px] text-subtle">{field.key}</p>
      {field.key === 'APP_MODE' ? (
        <select id={id} className="input" value={value} disabled={readOnly} onChange={(event) => onChange(field, event.target.value)}>
          <option value="demo">演示模式</option>
          <option value="live">真实邮箱模式</option>
        </select>
      ) : multiline ? (
        <textarea id={id} className="input min-h-28 resize-y" value={value} disabled={readOnly} spellCheck={false} onChange={(event) => onChange(field, event.target.value)} />
      ) : (
        <input
          id={id}
          className="input"
          type={field.secret ? 'password' : numeric ? 'number' : 'text'}
          value={value}
          disabled={readOnly}
          autoComplete={field.secret ? 'new-password' : 'off'}
          spellCheck={false}
          min={numeric ? field.key === 'PORT' ? 1 : 2100 : undefined}
          max={field.key === 'PORT' ? 65535 : undefined}
          step={numeric ? 1 : undefined}
          placeholder={field.secret ? field.configured ? '已配置，留空保留原值' : '未配置，按需填写' : '未设置'}
          onChange={(event) => onChange(field, event.target.value)}
        />
      )}
      {field.comment && field.comment !== field.label && (
        <p className="mt-2 whitespace-pre-line break-words text-[10px] leading-5 text-subtle">{field.comment}</p>
      )}
      {field.reason && <p className="mt-2 text-[10px] leading-5 text-muted">{field.reason}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { toast } = useWorkspace();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  const changeCount = Object.keys(changes).length;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api<AppSettings>('/settings', { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setSettings(result);
        setChanges({});
        setSaved(false);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : '配置读取失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  const change = useCallback((field: SettingsField, value: string) => {
    setSaved(false);
    setChanges((current) => {
      const next = { ...current };
      if (field.secret ? value === '' : value === (field.value ?? ''))
        delete next[field.key];
      else return { ...current, [field.key]: value };
      return next;
    });
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || saving || changeCount === 0) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const result = await api<AppSettings>('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ revision: settings.revision, values: changes }),
      });
      setSettings(result);
      setChanges({});
      setSaved(true);
      toast('设置已保存，重启 ZoHome 后生效。');
    } catch (error) {
      setError(error instanceof Error ? error.message : '设置保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-wrap">
      <PageTitle
        eyebrow="工作区配置"
        title="系统设置"
        description="配置项自动读取自环境文件，字段名称使用文件中的注释。"
        action={
          <button className="btn-secondary" disabled={loading || saving} onClick={() => setRevision((current) => current + 1)}>
            <RefreshCw size={14} />
            重新读取
          </button>
        }
      />
      {loading ? <div className="panel"><Spinner label="正在读取配置" /></div> : (
        <form onSubmit={(event) => void save(event)} className="panel overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line-soft p-5 md:p-6">
            <div className="flex min-w-0 items-start gap-3">
              <span className="rounded-lg bg-accent-muted p-2.5 text-accent"><FileSliders size={18} aria-hidden="true" /></span>
              <div className="min-w-0">
                <h2 className="section-title">环境配置</h2>
                {settings && <p className="mt-1.5 break-all text-[11px] text-muted">{settings.fileName} · {settings.fields.length} 项配置</p>}
              </div>
            </div>
            <p className="max-w-sm text-[11px] leading-6 text-muted">保存后重启 ZoHome 生效。密码和密钥留空会保留原值。</p>
          </div>
          {error && <div className="px-5 pt-5 md:px-6"><ErrorNotice message={error} /></div>}
          {(settings?.restartRequired || saved) && (
            <div className="mx-5 mt-5 flex items-start gap-3 rounded-xl border border-warning-line bg-warning-surface p-4 text-xs leading-6 text-warning-ink md:mx-6" role="status">
              <RotateCcw size={16} className="mt-1 shrink-0" aria-hidden="true" />
              <p>配置已保存，请重启 ZoHome 使修改生效。修改工作区密码后，下次登录请使用新密码。</p>
            </div>
          )}
          {settings && settings.fields.length > 0 ? (
            <div className="grid gap-x-8 gap-y-7 p-5 md:grid-cols-2 md:p-6">
              {settings.fields.map((field) => <ConfigurationField key={field.key} field={field} changes={changes} disabled={saving} onChange={change} />)}
            </div>
          ) : (
            <p className="px-6 py-12 text-center text-xs text-subtle">{settings ? '配置文件中没有可编辑的配置项。' : '暂时无法读取配置，请重新读取。'}</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line-soft px-5 py-4 md:px-6">
            <p className="text-[11px] text-muted">{changeCount ? `已修改 ${changeCount} 项配置` : '没有未保存的修改'}</p>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary" disabled={!changeCount || saving} onClick={() => { setChanges({}); setSaved(false); }}>撤销修改</button>
              <button type="submit" className="btn-primary" disabled={!settings || changeCount === 0 || saving}>
                <Save size={14} />
                {saving ? '正在保存…' : '保存设置'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

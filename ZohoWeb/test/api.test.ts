import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createWorkspaceApi } from '../src/api.ts';

test('workspace requests keep their original workspace and cannot override it through caller headers', async (context) => {
  const seen: Array<{ path: string; workspace: string | null; custom: string | null }> = [];
  context.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    seen.push({ path, workspace: headers.get('X-Workspace-Id'), custom: headers.get('X-Custom') });
    return Response.json({ ok: true });
  });
  const first = createWorkspaceApi('workspace-a', new AbortController().signal);
  const second = createWorkspaceApi('workspace-b', new AbortController().signal);
  await first('/accounts', { headers: new Headers({ 'X-Workspace-Id': 'workspace-b', 'X-Custom': 'preserved' }) });
  await second('/accounts');
  await first('/rebates');
  await api('/workspaces');
  assert.deepEqual(seen, [
    { path: '/api/accounts', workspace: 'workspace-a', custom: 'preserved' },
    { path: '/api/accounts', workspace: 'workspace-b', custom: null },
    { path: '/api/rebates', workspace: 'workspace-a', custom: null },
    { path: '/api/workspaces', workspace: null, custom: null },
  ]);
});

test('switching workspaces suppresses a stale response even if fetch ignores cancellation', async (context) => {
  let complete!: (response: Response) => void;
  let calls = 0;
  context.mock.method(globalThis, 'fetch', () => {
    calls++;
    return new Promise<Response>((resolve) => { complete = resolve; });
  });
  const lifetime = new AbortController();
  const request = createWorkspaceApi('workspace-a', lifetime.signal);
  const pending = request('/accounts');
  lifetime.abort();
  complete(Response.json({ privateData: 'old workspace' }));
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(request('/rebates', { method: 'POST', body: '{}' }), { name: 'AbortError' });
  assert.equal(calls, 1, 'a delayed old-workspace handler must not issue another request');
});

test('caller cancellation and ended provider lifetimes both prevent requests', async (context) => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}); });
  const lifetime = new AbortController();
  const caller = new AbortController();
  caller.abort();
  const request = createWorkspaceApi('workspace-a', lifetime.signal);
  await assert.rejects(request('/accounts', { signal: caller.signal }), { name: 'AbortError' });
  const unmounted = createWorkspaceApi('workspace-a', () => { throw new DOMException('工作区已切换', 'AbortError'); });
  await assert.rejects(unmounted('/fingerprint-browsers/import', { method: 'POST', body: '{}' }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('a cancelled unauthorized response cannot log out the new workspace', async (context) => {
  let complete!: (response: Response) => void;
  context.mock.method(globalThis, 'fetch', () => new Promise<Response>((resolve) => { complete = resolve; }));
  const lifetime = new AbortController();
  const pending = createWorkspaceApi('workspace-a', lifetime.signal)('/accounts');
  lifetime.abort();
  complete(Response.json({ message: '旧会话失效' }, { status: 401 }));
  await assert.rejects(pending, { name: 'AbortError' });
});

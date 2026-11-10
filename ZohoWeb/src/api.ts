export class ApiError extends Error {
  public status: number;
  constructor(
    message: string,
    status: number,
  ) {
    super(message);
    this.status = status;
  }
}

export type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

async function request<T>(path: string, init: RequestInit, workspaceId?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (workspaceId) headers.set('X-Workspace-Id', workspaceId);
  init.signal?.throwIfAborted();
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
  const body = await response.json().catch(() => ({}));
  init.signal?.throwIfAborted();
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event('zohome:unauthorized'));
    const message = Array.isArray(body.message)
      ? body.message.join('；')
      : body.message;
    throw new ApiError(message || '请求未完成，请稍后重试。', response.status);
  }
  return body as T;
}

export const api: ApiRequest = (path, init = {}) => request(path, init);

export function createWorkspaceApi(workspaceId: string, lifetime: AbortSignal | (() => AbortSignal)): ApiRequest {
  return async (path, init = {}) => {
    const workspaceSignal = typeof lifetime === 'function' ? lifetime() : lifetime;
    const signal = init.signal ? AbortSignal.any([workspaceSignal, init.signal]) : workspaceSignal;
    return request(path, { ...init, signal }, workspaceId);
  };
}

export function dateLabel(value: string | null, includeTime = false) {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    ...(includeTime
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : {}),
  }).format(date);
}

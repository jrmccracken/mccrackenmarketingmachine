export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Calls the portal API. The session lives in HttpOnly cookies, so nothing sensitive is stored in the browser. */
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'x-mcc-request': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth') && path !== '/me') {
    window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  }
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong. Please try again.');
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const patch = <T = any>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const del = <T = any>(path: string, body: unknown = {}) => api<T>('DELETE', path, body);

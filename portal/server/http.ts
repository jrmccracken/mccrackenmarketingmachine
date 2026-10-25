export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const fail = (status: number, message: string): never => { throw new HttpError(status, message); };

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

export async function readJson<T = Record<string, unknown>>(req: Request, limit = 64 * 1024): Promise<T> {
  const text = await req.text();
  if (text.length > limit) fail(413, 'Request too large');
  if (!text) return {} as T;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(400, 'Expected a JSON object');
    return v as T;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return fail(400, 'Invalid JSON');
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, opts: { maxAge: number; secure: boolean; sameSite?: 'Lax' | 'Strict' }): string {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${opts.sameSite || 'Lax'}`, `Max-Age=${opts.maxAge}`, opts.secure ? 'Secure' : '']
    .filter(Boolean).join('; ');
}

export function clientIp(req: Request): string {
  return req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

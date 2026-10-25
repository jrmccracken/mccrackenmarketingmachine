import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from './env.ts';
import { cookie, fail, parseCookies } from './http.ts';
import { anonClient, serviceClient, userClient } from './supabase.ts';

export interface Profile { id: string; name: string; email: string; role: 'admin' | 'client' }
export interface Session { profile: Profile; db: SupabaseClient; accessToken: string; setCookies: string[] }

const REFRESH_MAX_AGE = 60 * 60 * 24 * 14; // two weeks of inactivity signs you out

function names() {
  const secure = config().siteUrl.startsWith('https://');
  // __Host- cookies must be Secure, host-only and Path=/, which stops subdomains setting or reading them.
  return { secure, at: secure ? '__Host-mcc_at' : 'mcc_at', rt: secure ? '__Host-mcc_rt' : 'mcc_rt' };
}

export function sessionCookies(accessToken: string, refreshToken: string, expiresIn: number): string[] {
  const n = names();
  return [
    cookie(n.at, accessToken, { maxAge: Math.max(60, expiresIn), secure: n.secure }),
    cookie(n.rt, refreshToken, { maxAge: REFRESH_MAX_AGE, secure: n.secure }),
  ];
}

export function clearCookies(): string[] {
  const n = names();
  return [cookie(n.at, '', { maxAge: 0, secure: n.secure }), cookie(n.rt, '', { maxAge: 0, secure: n.secure })];
}

export function tokensFrom(req: Request) {
  const n = names();
  const c = parseCookies(req);
  return { accessToken: c[n.at] || '', refreshToken: c[n.rt] || '' };
}

/** Resolves the signed-in user from the session cookies, refreshing the access token when needed. */
export async function getSession(req: Request): Promise<Session | null> {
  let { accessToken, refreshToken } = tokensFrom(req);
  const setCookies: string[] = [];
  const service = serviceClient();
  let userId: string | null = null;

  if (accessToken) {
    const { data, error } = await service.auth.getUser(accessToken);
    if (!error && data.user) userId = data.user.id;
  }
  if (!userId && refreshToken) {
    const { data, error } = await anonClient().auth.refreshSession({ refresh_token: refreshToken });
    if (!error && data.session && data.user) {
      accessToken = data.session.access_token;
      userId = data.user.id;
      setCookies.push(...sessionCookies(data.session.access_token, data.session.refresh_token, data.session.expires_in));
    }
  }
  if (!userId) return null;

  const { data: profile } = await service.from('profiles').select('id, name, email, role').eq('id', userId).maybeSingle();
  if (!profile) return null;
  return { profile: profile as Profile, db: userClient(accessToken), accessToken, setCookies };
}

export async function requireSession(req: Request): Promise<Session> {
  return (await getSession(req)) || fail(401, 'Please sign in');
}

export async function requireAdmin(req: Request): Promise<Session> {
  const s = await requireSession(req);
  if (s.profile.role !== 'admin') fail(403, 'Only the administrator can do this');
  return s;
}

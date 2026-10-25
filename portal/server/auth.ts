import { createHash } from 'node:crypto';
import { config } from './env.ts';
import { clientIp, fail, json, readJson } from './http.ts';
import { clearCookies, getSession, sessionCookies } from './session.ts';
import { signInEmail, sendEmail } from './email.ts';
import { anonClient, serviceClient } from './supabase.ts';
import { email as emailField, text } from './validate.ts';

export const GENERIC_LOGIN_MESSAGE = "If that email address has access to the Marketing Control Centre, we've sent it a sign-in link. It expires in 15 minutes.";
const MIN_RESPONSE_MS = 700;
const PER_EMAIL_PER_HOUR = 5;
const PER_IP_PER_HOUR = 30;

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Only paths inside the portal are accepted as a post-login destination. */
export function safeNext(v: unknown): string {
  return typeof v === 'string' && /^\/(?!\/)[\w\-/?=&#.%]*$/.test(v) && !v.startsWith('/api') ? v : '/';
}

/** Creates the administrator's account on first use. ADMIN_EMAIL is set in Netlify, never by a visitor. */
export async function ensureAdmin(): Promise<void> {
  const { adminEmail } = config();
  const service = serviceClient();
  const { data: existing } = await service.from('profiles').select('id, role').eq('email', adminEmail).maybeSingle();
  if (existing) {
    if (existing.role !== 'admin') await service.from('profiles').update({ role: 'admin' }).eq('id', existing.id);
    return;
  }
  const id = await ensureAuthUser(adminEmail);
  await service.from('profiles').upsert({ id, email: adminEmail, name: 'James McCracken', role: 'admin' });
}

/** Returns the Supabase Auth user id for an email address, creating the user if needed (signups stay disabled). */
export async function ensureAuthUser(address: string): Promise<string> {
  const service = serviceClient();
  const { data: profile } = await service.from('profiles').select('id').eq('email', address).maybeSingle();
  if (profile) return profile.id;
  const { data, error } = await service.auth.admin.createUser({ email: address, email_confirm: true });
  if (data?.user) return data.user.id;
  // Already exists in Auth without a profile (for example after a failed invite): find it.
  if (error) {
    for (let page = 1; page < 50; page++) {
      const { data: list } = await service.auth.admin.listUsers({ page, perPage: 200 });
      const found = list?.users.find((u) => u.email?.toLowerCase() === address);
      if (found) return found.id;
      if (!list || list.users.length < 200) break;
    }
  }
  throw new Error(`Could not create a sign-in account: ${error?.message || 'unknown error'}`);
}

/** May this email address sign in? The administrator, or a member of at least one active workspace. */
export async function mayRequestLink(address: string): Promise<{ allowed: boolean; firstTime: boolean }> {
  const service = serviceClient();
  if (address === config().adminEmail) {
    await ensureAdmin();
    return { allowed: true, firstTime: false };
  }
  const { data: profile } = await service.from('profiles').select('id, role, last_login_at').eq('email', address).maybeSingle();
  if (!profile) return { allowed: false, firstTime: false };
  if (profile.role === 'admin') return { allowed: true, firstTime: false };
  const { data: memberships } = await service.from('workspace_members')
    .select('invitation_status, workspaces!inner(status)')
    .eq('user_id', profile.id).neq('invitation_status', 'revoked').eq('workspaces.status', 'active');
  return { allowed: !!memberships?.length, firstTime: !profile.last_login_at };
}

/** Creates a one-time sign-in link without Supabase sending its own email. */
export async function createSignInLink(address: string, next = '/'): Promise<string> {
  const { data, error } = await serviceClient().auth.admin.generateLink({ type: 'magiclink', email: address });
  if (error || !data?.properties?.hashed_token) throw new Error(`Could not create a sign-in link: ${error?.message || 'no token'}`);
  const url = new URL('/auth/confirm', config().siteUrl);
  url.searchParams.set('token', data.properties.hashed_token);
  if (next !== '/') url.searchParams.set('next', next);
  return url.toString();
}

async function throttled(address: string, ip: string): Promise<boolean> {
  const service = serviceClient();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const emailHash = hash(`email:${address}`), ipHash = hash(`ip:${ip}`);
  const [{ count: byEmail }, { count: byIp }] = await Promise.all([
    service.from('login_requests').select('id', { count: 'exact', head: true }).eq('email_hash', emailHash).gte('created_at', since),
    service.from('login_requests').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since),
  ]);
  await service.from('login_requests').insert({ email_hash: emailHash, ip_hash: ipHash });
  // Keep the table small.
  await service.from('login_requests').delete().lt('created_at', new Date(Date.now() - 86400_000).toISOString());
  return (byEmail ?? 0) >= PER_EMAIL_PER_HOUR || (byIp ?? 0) >= PER_IP_PER_HOUR;
}

/** POST /api/auth/login — always gives the same answer, whether or not the address has access. */
export async function requestLogin(req: Request): Promise<Response> {
  const started = Date.now();
  const body = await readJson(req);
  let address: string;
  try { address = emailField(body.email); } catch (err) { return json({ error: 'Enter a valid email address' }, 400); }
  try {
    if (!(await throttled(address, clientIp(req)))) {
      const { allowed, firstTime } = await mayRequestLink(address);
      if (allowed) await sendEmail(signInEmail(address, await createSignInLink(address, safeNext(body.next)), firstTime));
    }
  } catch (err) {
    console.error('[login]', (err as Error).message);
  }
  const wait = MIN_RESPONSE_MS - (Date.now() - started);
  if (wait > 0) await sleep(wait);
  return json({ ok: true, message: GENERIC_LOGIN_MESSAGE });
}

/** POST /api/auth/confirm — exchanges a one-time link token for a session held in HttpOnly cookies. */
export async function confirmLogin(req: Request): Promise<Response> {
  const body = await readJson(req);
  const token = text(body.token, 'Sign-in link', { max: 200, min: 1 })!;
  const { data, error } = await anonClient().auth.verifyOtp({ token_hash: token, type: 'magiclink' });
  if (error || !data.session || !data.user) {
    return json({ error: 'This sign-in link has expired or has already been used. Request a new one below.' }, 400);
  }
  const service = serviceClient();
  const address = (data.user.email || '').toLowerCase();
  const { allowed } = await mayRequestLink(address);
  if (!allowed) {
    await service.auth.admin.signOut(data.session.access_token).catch(() => {});
    return json({ error: 'This sign-in link has expired or has already been used. Request a new one below.' }, 400);
  }
  const now = new Date().toISOString();
  await service.from('profiles').update({ last_login_at: now }).eq('id', data.user.id);
  await service.from('workspace_members').update({ invitation_status: 'accepted', accepted_at: now })
    .eq('user_id', data.user.id).in('invitation_status', ['pending', 'invited']);
  return json({ ok: true, next: safeNext(body.next) }, 200,
    sessionCookies(data.session.access_token, data.session.refresh_token, data.session.expires_in).map((c) => ['set-cookie', c] as [string, string]));
}

/** POST /api/auth/logout — revokes the session's refresh tokens and clears the cookies. */
export async function logout(req: Request): Promise<Response> {
  const session = await getSession(req);
  if (session) await serviceClient().auth.admin.signOut(session.accessToken, 'local').catch(() => {});
  return json({ ok: true }, 200, clearCookies().map((c) => ['set-cookie', c] as [string, string]));
}

export { getSession };

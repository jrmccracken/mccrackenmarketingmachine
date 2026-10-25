/**
 * Test harness. Runs against the local Supabase stack (`npm run db:start`), calling the same
 * request handler Netlify uses. Emails are captured in memory: nothing is ever sent.
 */
import { execFileSync } from 'node:child_process';

function localSupabase(): Record<string, string> {
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return Object.fromEntries(out.split('\n').map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l)).filter(Boolean).map((m) => [m![1], m![2]]));
}

const sb = localSupabase();
if (!sb.API_URL) throw new Error('Local Supabase is not running. Start it with: npm run db:start');
Object.assign(process.env, {
  NODE_ENV: 'test', EMAIL_MODE: 'capture', SUPABASE_URL: sb.API_URL, SUPABASE_ANON_KEY: sb.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: sb.SERVICE_ROLE_KEY,
  ADMIN_EMAIL: 'james@mccrackenmarketing.co.uk', SITE_URL: 'http://localhost:8888', RESEND_API_KEY: '', RESEND_FROM_EMAIL: '',
});
export const DB_URL = sb.DB_URL;

const { handle } = await import('../server/router.ts');
const { capturedEmails } = await import('../server/email.ts');
export { handle, capturedEmails };

export function sql(query: string): string {
  return execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', query], { encoding: 'utf8' }).trim();
}

/** Empties every portal table and Supabase Auth user. Local database only. */
export function resetData() {
  if (!/127\.0\.0\.1|localhost/.test(DB_URL)) throw new Error('Refusing to reset a non-local database');
  sql(`truncate public.workspaces, public.profiles, public.notifications, public.reminder_log, public.login_requests, public.activity restart identity cascade;
       delete from auth.users;`);
  capturedEmails.length = 0;
}

/** A browser-like client that keeps cookies between requests. */
export class Browser {
  cookies = new Map<string, string>();
  constructor(public ip = '10.0.0.' + Math.floor(Math.random() * 250 + 1)) {}

  async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; data: any; headers: Headers }> {
    const headers = new Headers({ 'x-mcc-request': '1', 'x-nf-client-connection-ip': this.ip, ...extra });
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '));
    if (body !== undefined) headers.set('content-type', 'application/json');
    const res = await handle(new Request(`http://localhost:8888/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }));
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split('; ');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = decodeURIComponent(pair.slice(i + 1));
      if (attrs.includes('Max-Age=0') || !value) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  }
  get = (p: string) => this.request('GET', p);
  post = (p: string, b: unknown = {}) => this.request('POST', p, b);
  patch = (p: string, b: unknown) => this.request('PATCH', p, b);
  del = (p: string, b: unknown = {}) => this.request('DELETE', p, b);
}

export function linkFor(email: string): string {
  const mail = [...capturedEmails].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`No email captured for ${email}`);
  const m = /(http:\/\/localhost:8888\/auth\/confirm\?[^\s"<]+)/.exec(mail.text);
  if (!m) throw new Error('No sign-in link in the email');
  return m[1].replace(/&amp;/g, '&');
}

/** Signs in through the real magic-link flow and returns a browser holding the session cookies. */
export async function signIn(email: string): Promise<Browser> {
  const b = new Browser();
  const before = capturedEmails.length;
  const r = await b.post('/auth/login', { email });
  if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.data)}`);
  if (capturedEmails.length === before) throw new Error(`No sign-in email sent to ${email}`);
  const url = new URL(linkFor(email));
  const c = await b.post('/auth/confirm', { token: url.searchParams.get('token'), next: url.searchParams.get('next') || '/' });
  if (c.status !== 200) throw new Error(`confirm failed: ${JSON.stringify(c.data)}`);
  return b;
}

/** Admin creates a workspace with one client contact (no invitation email). Returns ids. */
export async function makeWorkspace(admin: Browser, name: string, clientEmail: string) {
  const r = await admin.post('/admin/workspaces', { name, contact_name: `${name} Contact`, contact_email: clientEmail, send_invite: false });
  if (r.status !== 201) throw new Error(`create workspace failed: ${JSON.stringify(r.data)}`);
  const ws = r.data.workspace.id as string;
  const full = await admin.get(`/workspaces/${ws}`);
  return { ws, data: full.data };
}

export const ADMIN = 'james@mccrackenmarketing.co.uk';

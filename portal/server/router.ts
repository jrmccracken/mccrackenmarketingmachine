import { config } from './env.ts';
import { HttpError, json, readJson } from './http.ts';
import { confirmLogin, logout, requestLogin } from './auth.ts';
import { getSession, requireAdmin, requireSession, type Session } from './session.ts';
import { addComment, addLink, completeUpload, createRecord, downloadEvidence, getWorkspace, removeRecord, startUpload, updateRecord } from './workspace.ts';
import { addMember, createWorkspace, deleteWorkspace, inviteMember, listNotifications, markNotificationsRead, overview, removeMember, updateWorkspace } from './admin.ts';
import { sendWeeklyReminders } from './jobs.ts';
import { isUuid } from './validate.ts';

type Handler = (req: Request, p: Record<string, string>) => Promise<Response>;
const routes: [string, RegExp, string[], Handler][] = [];
function route(method: string, pattern: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push([method, re, keys, handler]);
}

/** Wraps a handler that needs a signed-in user, passing refreshed cookies back. */
const authed = (fn: (s: Session, req: Request, p: Record<string, string>) => Promise<Response>, admin = false): Handler =>
  async (req, p) => {
    for (const [k, v] of Object.entries(p)) if (/(^id$|Id$|^ws$)/.test(k) && !isUuid(v)) throw new HttpError(404, 'Not found');
    const s = admin ? await requireAdmin(req) : await requireSession(req);
    const res = await fn(s, req, p);
    for (const c of s.setCookies) res.headers.append('set-cookie', c);
    return res;
  };

// Sign-in
route('POST', '/api/auth/login', (req) => requestLogin(req));
route('POST', '/api/auth/confirm', (req) => confirmLogin(req));
route('POST', '/api/auth/logout', (req) => logout(req));
route('GET', '/api/me', async (req) => {
  const s = await getSession(req);
  if (!s) return json({ user: null });
  const { data: workspaces } = await s.db.from('workspaces').select('id, name, status').order('name');
  const { count } = await s.db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  const res = json({ user: s.profile, workspaces, unread: count || 0 });
  for (const c of s.setCookies) res.headers.append('set-cookie', c);
  return res;
});

// Notifications
route('GET', '/api/notifications', authed((s) => listNotifications(s)));
route('POST', '/api/notifications/read', authed((s, req) => markNotificationsRead(s, req)));

// Administrator
route('GET', '/api/admin/overview', authed((s) => overview(s), true));
route('POST', '/api/admin/workspaces', authed((s, req) => createWorkspace(s, req), true));
route('PATCH', '/api/admin/workspaces/:ws', authed((s, req, p) => updateWorkspace(s, p.ws, req), true));
route('DELETE', '/api/admin/workspaces/:ws', authed((s, req, p) => deleteWorkspace(s, p.ws, req), true));
route('POST', '/api/admin/workspaces/:ws/members', authed((s, req, p) => addMember(s, p.ws, req), true));
route('DELETE', '/api/admin/workspaces/:ws/members/:userId', authed((s, _r, p) => removeMember(s, p.ws, p.userId), true));
route('POST', '/api/admin/workspaces/:ws/members/:userId/invite', authed((s, _r, p) => inviteMember(s, p.ws, p.userId), true));
// Manual reminder run: administrator session required. Dry run unless {"send": true, "confirm": "SEND"}.
route('POST', '/api/admin/reminders/run', authed(async (_s, req) => {
  const body = await readJson(req);
  const live = body.send === true && body.confirm === 'SEND';
  return json(await sendWeeklyReminders({ dryRun: !live, ignoreClock: true }));
}, true));

// Workspace (row level security limits clients to their own workspace)
route('GET', '/api/workspaces/:ws', authed((s, _r, p) => getWorkspace(s, p.ws)));
route('POST', '/api/workspaces/:ws/comments', authed((s, req, p) => addComment(s, p.ws, req)));
route('DELETE', '/api/workspaces/:ws/comments/:id', authed((s, _r, p) => removeRecord(s, p.ws, 'comments', p.id)));
route('POST', '/api/workspaces/:ws/evidence/link', authed((s, req, p) => addLink(s, p.ws, req)));
route('POST', '/api/workspaces/:ws/evidence/upload', authed((s, req, p) => startUpload(s, p.ws, req)));
route('POST', '/api/workspaces/:ws/evidence/:id/complete', authed((s, _r, p) => completeUpload(s, p.ws, p.id)));
route('GET', '/api/workspaces/:ws/evidence/:id/download', authed((s, _r, p) => downloadEvidence(s, p.ws, p.id)));
route('DELETE', '/api/workspaces/:ws/evidence/:id', authed((s, _r, p) => removeRecord(s, p.ws, 'evidence', p.id)));
route('POST', '/api/workspaces/:ws/:kind', authed((s, req, p) => createRecord(s, p.ws, p.kind, req)));
route('PATCH', '/api/workspaces/:ws/:kind/:id', authed((s, req, p) => updateRecord(s, p.ws, p.kind, p.id, req)));
route('DELETE', '/api/workspaces/:ws/:kind/:id', authed((s, _r, p) => removeRecord(s, p.ws, p.kind, p.id)));

/** Rejects cross-site writes: same-origin only, plus a custom header a cross-site form can't send. */
function checkCsrf(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers.get('x-mcc-request') !== '1') throw new HttpError(403, 'Request blocked');
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(config().siteUrl).origin) throw new HttpError(403, 'Request blocked');
}

export async function handle(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  try {
    checkCsrf(req);
    for (const [method, re, keys, handler] of routes) {
      const m = re.exec(pathname);
      if (!m || method !== req.method) continue;
      return await handler(req, Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])));
    }
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error('[api]', req.method, pathname, err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

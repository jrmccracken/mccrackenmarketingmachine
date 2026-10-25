import { config } from './env.ts';
import { fail, json, readJson } from './http.ts';
import type { Session } from './session.ts';
import { serviceClient } from './supabase.ts';
import { sendEmail, signInEmail } from './email.ts';
import { createSignInLink, ensureAuthUser } from './auth.ts';
import { requireWorkspace } from './workspace.ts';
import { date, email as emailField, oneOf, text, uuid } from './validate.ts';

const today = () => new Date().toISOString().slice(0, 10);

/** GET /api/admin/overview — everything the administrator's dashboard needs, read through RLS as the admin. */
export async function overview(s: Session): Promise<Response> {
  const [ws, checklist, actions, activity, notifications, members] = await Promise.all([
    s.db.from('workspaces').select('id, name, status, start_date, created_at, updated_at').order('name'),
    s.db.from('checklist_items').select('id, workspace_id, category, item, status, owner_type, due_date').is('deleted_at', null),
    s.db.from('actions').select('id, workspace_id, action, owner_type, priority, status, due_date').is('deleted_at', null).neq('status', 'done'),
    s.db.from('activity').select('id, workspace_id, description, action_type, created_at, actor_role').eq('actor_role', 'client').order('created_at', { ascending: false }).limit(30),
    s.db.from('notifications').select('id, workspace_id, type, title, link, created_at, read_at').is('read_at', null).order('created_at', { ascending: false }).limit(50),
    s.db.from('workspace_members').select('workspace_id, invitation_status, profile:profiles(name, email, last_login_at)'),
  ]);
  for (const r of [ws, checklist, actions, activity, notifications, members]) if (r.error) throw r.error;
  const t = today();
  const names = Object.fromEntries((ws.data || []).map((w) => [w.id, w.name]));
  const workspaces = (ws.data || []).map((w) => {
    const items = (checklist.data || []).filter((c) => c.workspace_id === w.id && c.status !== 'not_applicable');
    const done = items.filter((c) => c.status === 'done').length;
    const open = (actions.data || []).filter((a) => a.workspace_id === w.id);
    const people = (members.data || []).filter((m: any) => m.workspace_id === w.id && m.invitation_status !== 'revoked');
    return {
      ...w,
      progress: items.length ? Math.round((done / items.length) * 100) : 0,
      checklist_total: items.length, checklist_done: done,
      missing_access: items.filter((c) => c.owner_type === 'client' && c.status !== 'done').length,
      open_actions: open.length,
      overdue_actions: open.filter((a) => a.due_date && a.due_date < t).length,
      members: people.map((m: any) => ({ name: m.profile?.name, email: m.profile?.email, status: m.invitation_status, last_login_at: m.profile?.last_login_at })),
    };
  });
  const active = new Set(workspaces.filter((w) => w.status === 'active').map((w) => w.id));
  return json({
    workspaces,
    overdue: (actions.data || []).filter((a) => a.due_date && a.due_date < t && active.has(a.workspace_id)).map((a) => ({ ...a, workspace: names[a.workspace_id] })),
    missing: (checklist.data || []).filter((c) => c.owner_type === 'client' && !['done', 'not_applicable'].includes(c.status) && active.has(c.workspace_id))
      .map((c) => ({ ...c, workspace: names[c.workspace_id] })),
    activity: (activity.data || []).map((a) => ({ ...a, workspace: names[a.workspace_id] })),
    notifications: notifications.data,
  });
}

/** POST /api/admin/workspaces — creates a workspace, its first client contact and the standard checklist. */
export async function createWorkspace(s: Session, req: Request): Promise<Response> {
  const body = await readJson(req);
  const name = text(body.name, 'Client or business name', { max: 200, min: 1 })!;
  const start_date = date(body.start_date, 'Start date') ?? null;
  const contactEmail = body.contact_email ? emailField(body.contact_email, 'Client email address') : null;
  const contactName = text(body.contact_name, 'Client name', { max: 200 }) || '';
  if (contactEmail === config().adminEmail) fail(400, 'Use a client email address, not the administrator address');

  const { data: workspace, error } = await s.db.from('workspaces').insert({ name, start_date }).select().single();
  if (error) throw error;
  const { error: seedError } = await s.db.rpc('seed_checklist', { ws: workspace.id });
  if (seedError) throw seedError;
  let invited = false;
  if (contactEmail) {
    const userId = await addMemberRecord(s, workspace.id, contactEmail, contactName);
    if (body.send_invite === true) { await sendInvite(workspace.id, userId); invited = true; }
  }
  return json({ workspace, invited }, 201);
}

/** PATCH /api/admin/workspaces/:id — rename, change start date, suspend, archive or reactivate. */
export async function updateWorkspace(s: Session, ws: string, req: Request): Promise<Response> {
  await requireWorkspace(s, ws);
  const body = await readJson(req);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = text(body.name, 'Name', { max: 200, min: 1 });
  if (body.start_date !== undefined) patch.start_date = date(body.start_date, 'Start date');
  if (body.status !== undefined) {
    patch.status = oneOf(body.status, 'Status', ['active', 'suspended', 'archived'] as const);
    patch.archived_at = patch.status === 'archived' ? new Date().toISOString() : null;
  }
  if (!Object.keys(patch).length) fail(400, 'Nothing to update');
  const { data, error } = await s.db.from('workspaces').update(patch).eq('id', ws).select().single();
  if (error) throw error;
  return json(data);
}

/**
 * DELETE /api/admin/workspaces/:id — permanent deletion. Only allowed once the workspace is archived,
 * and only when the exact workspace name is typed as confirmation. Removes stored files too.
 */
export async function deleteWorkspace(s: Session, ws: string, req: Request): Promise<Response> {
  const workspace = await requireWorkspace(s, ws);
  const body = await readJson(req);
  if (workspace.status !== 'archived') fail(400, 'Archive the workspace before deleting it permanently');
  if (typeof body.confirm_name !== 'string' || body.confirm_name.trim() !== workspace.name) fail(400, 'Type the workspace name exactly to confirm permanent deletion');
  const service = serviceClient();
  const { data: files } = await service.from('evidence').select('storage_path').eq('workspace_id', ws).eq('kind', 'file');
  const paths = (files || []).map((f) => f.storage_path).filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) await service.storage.from('evidence').remove(paths.slice(i, i + 100));
  const { error } = await service.from('workspaces').delete().eq('id', ws);
  if (error) throw error;
  console.log(`[audit] workspace ${ws} ("${workspace.name}") permanently deleted by ${s.profile.email}`);
  return json({ ok: true });
}

async function addMemberRecord(s: Session, ws: string, address: string, name: string): Promise<string> {
  const service = serviceClient();
  const userId = await ensureAuthUser(address);
  const { data: existing } = await service.from('profiles').select('id, role, name').eq('id', userId).maybeSingle();
  if (existing?.role === 'admin') fail(400, 'The administrator already has access to every workspace');
  if (!existing) {
    const { error } = await service.from('profiles').insert({ id: userId, email: address, name, role: 'client' });
    if (error) throw error;
  } else if (name && !existing.name) {
    await service.from('profiles').update({ name }).eq('id', userId);
  }
  const { data: member } = await s.db.from('workspace_members').select('invitation_status').eq('workspace_id', ws).eq('user_id', userId).maybeSingle();
  if (!member) {
    const { error } = await s.db.from('workspace_members').insert({ workspace_id: ws, user_id: userId, role: 'client', invitation_status: 'pending' });
    if (error) throw error;
  } else if (member.invitation_status === 'revoked') {
    const { error } = await s.db.from('workspace_members').update({ invitation_status: 'pending' }).eq('workspace_id', ws).eq('user_id', userId);
    if (error) throw error;
  } else {
    fail(409, 'That person is already a member of this workspace');
  }
  return userId;
}

/** POST /api/admin/workspaces/:id/members */
export async function addMember(s: Session, ws: string, req: Request): Promise<Response> {
  const workspace = await requireWorkspace(s, ws);
  const body = await readJson(req);
  const address = emailField(body.email);
  if (address === config().adminEmail) fail(400, 'The administrator already has access to every workspace');
  const userId = await addMemberRecord(s, ws, address, text(body.name, 'Name', { max: 200 }) || '');
  let invited = false;
  if (body.send_invite === true && workspace.status === 'active') { await sendInvite(ws, userId); invited = true; }
  return json({ user_id: userId, invited }, 201);
}

/** DELETE /api/admin/workspaces/:id/members/:userId — revokes access; the record stays for the audit trail. */
export async function removeMember(s: Session, ws: string, userId: string): Promise<Response> {
  await requireWorkspace(s, ws);
  const { data, error } = await s.db.from('workspace_members').update({ invitation_status: 'revoked' }).eq('workspace_id', ws).eq('user_id', uuid(userId, 'user')).select('user_id').maybeSingle();
  if (error) throw error;
  if (!data) fail(404, 'Member not found');
  return json({ ok: true });
}

/** POST /api/admin/workspaces/:id/members/:userId/invite — sends or resends the invitation email. */
export async function inviteMember(s: Session, ws: string, userId: string): Promise<Response> {
  const workspace = await requireWorkspace(s, ws);
  if (workspace.status !== 'active') fail(400, 'Reactivate the workspace before sending invitations');
  const { data: member } = await s.db.from('workspace_members').select('invitation_status').eq('workspace_id', ws).eq('user_id', uuid(userId, 'user')).maybeSingle();
  if (!member || member.invitation_status === 'revoked') fail(404, 'Member not found');
  await sendInvite(ws, userId);
  return json({ ok: true });
}

async function sendInvite(ws: string, userId: string): Promise<void> {
  const service = serviceClient();
  const { data: profile } = await service.from('profiles').select('email, last_login_at').eq('id', userId).single();
  if (!profile) fail(404, 'Member not found');
  const url = await createSignInLink(profile!.email, `/workspaces/${ws}`);
  await sendEmail(signInEmail(profile!.email, url, !profile!.last_login_at));
  const { data: m } = await service.from('workspace_members').select('invitation_status').eq('workspace_id', ws).eq('user_id', userId).single();
  await service.from('workspace_members').update({
    invited_at: new Date().toISOString(),
    invitation_status: m?.invitation_status === 'accepted' ? 'accepted' : 'invited',
  }).eq('workspace_id', ws).eq('user_id', userId);
}

// ---------------------------------------------------------------- notifications (any signed-in user)

export async function listNotifications(s: Session): Promise<Response> {
  const { data, error } = await s.db.from('notifications').select('id, workspace_id, type, title, link, created_at, read_at')
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return json(data);
}

export async function markNotificationsRead(s: Session, req: Request): Promise<Response> {
  const body = await readJson(req);
  let q = s.db.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (body.all !== true) {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 200) fail(400, 'Choose notifications to mark as read');
    q = q.in('id', (body.ids as unknown[]).map((id) => uuid(id, 'notification')));
  }
  const { data, error } = await q.select('id');
  if (error) throw error;
  return json({ updated: data?.length || 0 });
}

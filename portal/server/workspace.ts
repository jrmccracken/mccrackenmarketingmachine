import { randomUUID } from 'node:crypto';
import { config } from './env.ts';
import { fail, json, readJson } from './http.ts';
import type { Session } from './session.ts';
import { serviceClient } from './supabase.ts';
import { actionAssignedEmail, sendEmail } from './email.ts';
import { bool, checkUpload, contentMatches, date, httpsUrl, MAX_UPLOAD_BYTES, oneOf, safeFileName, text, uuid } from './validate.ts';

type Validator = (v: unknown) => unknown;
interface Spec { table: string; label: string; admin: Record<string, Validator>; client: string[]; required: string[] }

const PRIORITY = ['high', 'medium', 'low'] as const;
const optUuid = (label: string) => (v: unknown) => (v === null || v === '' ? null : uuid(v, label));

export const SPECS: Record<string, Spec> = {
  checklist: {
    table: 'checklist_items', label: 'Checklist item', required: ['category', 'item'], client: ['status', 'notes'],
    admin: {
      category: (v) => text(v, 'Category', { max: 100, min: 1 }),
      item: (v) => text(v, 'Item', { max: 500, min: 1 }),
      status: (v) => oneOf(v, 'Status', ['not_started', 'in_progress', 'done', 'not_applicable'] as const),
      owner_type: (v) => oneOf(v, 'Owner', ['client', 'mccracken'] as const),
      assignee_id: optUuid('assignee'),
      client_editable: (v) => bool(v, 'Client can update'),
      due_date: (v) => date(v, 'Due date'),
      notes: (v) => text(v, 'Notes', { max: 5000 }),
      sort_order: (v) => (Number.isInteger(v) ? v : fail(400, 'Order must be a whole number')),
    },
  },
  actions: {
    table: 'actions', label: 'Action', required: ['action'], client: ['status', 'notes'],
    admin: {
      action: (v) => text(v, 'Action', { max: 500, min: 1 }),
      owner_type: (v) => oneOf(v, 'Owner', ['client', 'mccracken'] as const),
      owner_id: optUuid('owner'),
      priority: (v) => oneOf(v, 'Priority', PRIORITY),
      important: (v) => bool(v, 'Important'),
      status: (v) => oneOf(v, 'Status', ['not_started', 'in_progress', 'blocked', 'done'] as const),
      due_date: (v) => date(v, 'Due date'),
      notes: (v) => text(v, 'Notes', { max: 5000 }),
    },
  },
  interviews: {
    table: 'interviews', label: 'Interview', required: ['stakeholder_name'], client: [],
    admin: {
      stakeholder_name: (v) => text(v, 'Stakeholder name', { max: 200, min: 1 }),
      stakeholder_role: (v) => text(v, 'Role', { max: 200 }),
      status: (v) => oneOf(v, 'Status', ['to_schedule', 'scheduled', 'completed', 'cancelled'] as const),
      planned_date: (v) => date(v, 'Planned date'),
      completed_date: (v) => date(v, 'Completed date'),
      notes: (v) => text(v, 'Notes', { max: 10000 }),
    },
  },
  findings: {
    table: 'findings', label: 'Finding', required: ['title'], client: [],
    admin: {
      title: (v) => text(v, 'Title', { max: 300, min: 1 }),
      category: (v) => text(v, 'Category', { max: 100 }),
      summary: (v) => text(v, 'Summary', { max: 10000 }),
      evidence: (v) => text(v, 'Evidence', { max: 10000 }),
      priority: (v) => oneOf(v, 'Priority', PRIORITY),
      status: (v) => oneOf(v, 'Status', ['draft', 'shared', 'agreed', 'in_progress', 'closed'] as const),
    },
  },
};

function pick(body: Record<string, unknown>, spec: Spec, isAdmin: boolean): Record<string, unknown> {
  const allowed = isAdmin ? Object.keys(spec.admin) : spec.client;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      if (spec.admin[key] || key === 'workspace_id' || key === 'id' || key === 'deleted_at') fail(403, `You can't change ${key.replace(/_/g, ' ')} here`);
      continue;
    }
    const v = spec.admin[key](body[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Throws 404 unless the signed-in user can see the workspace (checked by row level security). */
export async function requireWorkspace(s: Session, ws: string) {
  const { data, error } = await s.db.from('workspaces').select('id, name, status, start_date, created_at, updated_at, archived_at').eq('id', ws).maybeSingle();
  if (error) throw error;
  return data || fail(404, 'Workspace not found');
}

const errorMessage = (err: { code?: string; message: string }) =>
  err.code === '42501' ? fail(403, err.message.includes('only') || err.message.includes('Only') ? err.message : "You don't have permission to do that") : fail(400, err.message);

// ---------------------------------------------------------------- read

export async function getWorkspace(s: Session, ws: string): Promise<Response> {
  const workspace = await requireWorkspace(s, ws);
  const isAdmin = s.profile.role === 'admin';
  const q = (t: string, cols = '*') => s.db.from(t).select(cols).eq('workspace_id', ws);
  const [members, checklist, actions, interviews, findings, evidence, comments, activity] = await Promise.all([
    q('workspace_members', 'user_id, role, invitation_status, invited_at, accepted_at, profile:profiles(id, name, email, last_login_at)'),
    q('checklist_items').order('sort_order').order('created_at'),
    q('actions').order('due_date', { ascending: true, nullsFirst: false }).order('created_at'),
    q('interviews').order('planned_date', { ascending: true, nullsFirst: false }),
    q('findings').order('created_at', { ascending: false }),
    q('evidence', 'id, display_name, kind, external_url, file_type, file_size, upload_status, uploaded_by, created_at, deleted_at, uploader:profiles(name, email)').order('created_at', { ascending: false }),
    q('comments', 'id, record_type, record_id, body, created_at, deleted_at, author_id, author:profiles(name, email, role)').order('created_at'),
    q('activity', 'id, action_type, description, record_type, record_id, created_at, actor_role').order('created_at', { ascending: false }).limit(100),
  ]);
  for (const r of [members, checklist, actions, interviews, findings, evidence, comments, activity]) if (r.error) throw r.error;
  return json({
    workspace, isAdmin, me: s.profile,
    members: isAdmin ? members.data : (members.data || []).filter((m: any) => m.invitation_status !== 'revoked'),
    checklist: checklist.data, actions: actions.data, interviews: interviews.data, findings: findings.data,
    evidence: (evidence.data || []).filter((e: any) => isAdmin || e.upload_status === 'ready'),
    comments: comments.data, activity: activity.data,
  });
}

// ---------------------------------------------------------------- create / update / remove

export async function createRecord(s: Session, ws: string, kind: string, req: Request): Promise<Response> {
  const spec = SPECS[kind] || fail(404, 'Not found');
  if (s.profile.role !== 'admin') fail(403, `Only McCracken Marketing can add ${spec.label.toLowerCase()}s`);
  await requireWorkspace(s, ws);
  const values = pick(await readJson(req), spec, true);
  for (const r of spec.required) if (!values[r]) fail(400, `${r.replace(/_/g, ' ')} is required`);
  const { data, error } = await s.db.from(spec.table).insert({ ...values, workspace_id: ws }).select().single();
  if (error) errorMessage(error);
  if (kind === 'actions') await notifyImportantAction(ws, data);
  return json(data, 201);
}

export async function updateRecord(s: Session, ws: string, kind: string, id: string, req: Request): Promise<Response> {
  const spec = SPECS[kind] || fail(404, 'Not found');
  const isAdmin = s.profile.role === 'admin';
  await requireWorkspace(s, ws);
  const values = pick(await readJson(req), spec, isAdmin);
  if (!Object.keys(values).length) fail(400, 'Nothing to update');
  const { data, error } = await s.db.from(spec.table).update(values).eq('id', id).eq('workspace_id', ws).select().maybeSingle();
  if (error) errorMessage(error);
  // Row level security hides rows the user may not change, so "no row" means not found or not permitted.
  if (!data) fail(404, `${spec.label} not found, or you can't change it`);
  if (kind === 'actions' && isAdmin) await notifyImportantAction(ws, data);
  return json(data);
}

export async function removeRecord(s: Session, ws: string, kind: string, id: string): Promise<Response> {
  const spec = SPECS[kind] || (kind === 'evidence' ? { table: 'evidence', label: 'Evidence' } as Spec : kind === 'comments' ? { table: 'comments', label: 'Comment' } as Spec : fail(404, 'Not found'));
  if (s.profile.role !== 'admin') fail(403, 'Only McCracken Marketing can remove items');
  await requireWorkspace(s, ws);
  // Soft delete: the record stays in the database and the activity history.
  const { data, error } = await s.db.from(spec.table).update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('workspace_id', ws).is('deleted_at', null).select('id').maybeSingle();
  if (error) errorMessage(error);
  if (!data) fail(404, `${spec.label} not found`);
  return json({ ok: true });
}

/** Emails the client contacts once when an important action is assigned to them. */
export async function notifyImportantAction(ws: string, action: any): Promise<void> {
  if (!action || action.owner_type !== 'client' || !action.important || action.status === 'done' || action.deleted_at) return;
  const service = serviceClient();
  const { data: workspace } = await service.from('workspaces').select('name, status').eq('id', ws).single();
  if (workspace?.status !== 'active') return;
  const { data: members } = await service.from('workspace_members').select('user_id, profile:profiles(email, role)')
    .eq('workspace_id', ws).in('invitation_status', ['invited', 'accepted']);
  const link = `/workspaces/${ws}?tab=actions#action-${action.id}`;
  for (const m of (members || []) as any[]) {
    if (action.owner_id && action.owner_id !== m.user_id) continue;
    const { data: created } = await service.from('notifications').upsert(
      { recipient_id: m.user_id, workspace_id: ws, type: 'action_assigned', title: `New action: ${action.action.slice(0, 120)}`, link, dedupe_key: `action-assigned:${action.id}` },
      { onConflict: 'recipient_id,dedupe_key', ignoreDuplicates: true }).select('id');
    if (!created?.length) continue; // already told about this action
    try {
      await sendEmail(actionAssignedEmail(m.profile.email, workspace.name, config().siteUrl + link));
      await service.from('notifications').update({ emailed_at: new Date().toISOString() }).eq('id', created[0].id);
    } catch (err) { console.error('[action email]', (err as Error).message); }
  }
}

// ---------------------------------------------------------------- comments

export async function addComment(s: Session, ws: string, req: Request): Promise<Response> {
  await requireWorkspace(s, ws);
  const body = await readJson(req);
  const record_type = oneOf(body.record_type ?? 'workspace', 'Record type', ['workspace', 'checklist', 'action', 'finding', 'interview', 'evidence'] as const)!;
  const record_id = record_type === 'workspace' ? null : uuid(body.record_id, 'record');
  const comment = text(body.body, 'Comment', { max: 5000, min: 1 });
  const { data, error } = await s.db.from('comments').insert({ workspace_id: ws, record_type, record_id, body: comment, author_id: s.profile.id })
    .select('id, record_type, record_id, body, created_at, author_id').single();
  if (error) errorMessage(error);
  return json(data, 201);
}

// ---------------------------------------------------------------- evidence

export async function addLink(s: Session, ws: string, req: Request): Promise<Response> {
  await requireWorkspace(s, ws);
  const body = await readJson(req);
  const url = httpsUrl(body.url);
  const display_name = text(body.display_name, 'Name', { max: 200 }) || new URL(url).hostname;
  const { data, error } = await s.db.from('evidence').insert({ workspace_id: ws, kind: 'link', external_url: url, display_name, uploaded_by: s.profile.id })
    .select('id, display_name, kind, external_url, created_at').single();
  if (error) errorMessage(error);
  return json(data, 201);
}

/** Step 1 of an upload: validate the file details and issue a one-time signed upload URL for a random path. */
export async function startUpload(s: Session, ws: string, req: Request): Promise<Response> {
  const workspace = await requireWorkspace(s, ws);
  if (workspace.status !== 'active') fail(400, 'This workspace is not active');
  const body = await readJson(req);
  const name = safeFileName(text(body.file_name, 'File name', { max: 255, min: 1 })!);
  const { ext, mime } = checkUpload(name, String(body.mime_type || ''), Number(body.size));
  const display_name = text(body.display_name, 'Name', { max: 200 }) || name;
  const service = serviceClient();
  const path = `${ws}/${randomUUID()}.${ext}`;
  const { data: row, error } = await service.from('evidence').insert({
    workspace_id: ws, kind: 'file', storage_path: path, display_name, file_type: mime, file_size: Number(body.size), upload_status: 'pending', uploaded_by: s.profile.id,
  }).select('id').single();
  if (error) throw error;
  const { data: signed, error: signError } = await service.storage.from('evidence').createSignedUploadUrl(path);
  if (signError || !signed) {
    await service.from('evidence').delete().eq('id', row.id);
    throw signError || new Error('Could not prepare the upload');
  }
  return json({ id: row.id, upload_url: signed.signedUrl, content_type: mime }, 201);
}

/** Step 2: after the browser uploads, check the stored file really is what it claims to be. */
export async function completeUpload(s: Session, ws: string, id: string): Promise<Response> {
  await requireWorkspace(s, ws);
  const service = serviceClient();
  const { data: row } = await service.from('evidence').select('id, storage_path, file_type, upload_status, uploaded_by')
    .eq('id', id).eq('workspace_id', ws).eq('uploaded_by', s.profile.id).eq('upload_status', 'pending').maybeSingle();
  if (!row) return fail(404, 'Upload not found');
  const reject = async (message: string) => {
    await service.storage.from('evidence').remove([row.storage_path]);
    await service.from('evidence').delete().eq('id', row.id);
    return fail(400, message);
  };
  const { data: blob, error } = await service.storage.from('evidence').download(row.storage_path);
  if (error || !blob) return reject('The file did not finish uploading. Please try again.');
  if (blob.size > MAX_UPLOAD_BYTES) return reject('Files must be 10 MB or smaller');
  if (blob.size === 0) return reject('The file is empty');
  const ext = row.storage_path.split('.').pop()!;
  if (!contentMatches(ext, new Uint8Array(await blob.slice(0, 8192).arrayBuffer()))) {
    return reject("The file's contents don't match its type, so it wasn't saved.");
  }
  const { data, error: upd } = await service.from('evidence').update({ upload_status: 'ready', file_size: blob.size })
    .eq('id', row.id).select('id, display_name, kind, file_type, file_size, created_at').single();
  if (upd) throw upd;
  return json(data);
}

/** Issues a 60-second signed download URL, after row level security confirms the user can see the evidence. */
export async function downloadEvidence(s: Session, ws: string, id: string): Promise<Response> {
  await requireWorkspace(s, ws);
  const { data: row } = await s.db.from('evidence').select('id, kind, display_name, external_url, upload_status, deleted_at').eq('id', id).eq('workspace_id', ws).maybeSingle();
  if (!row || row.upload_status !== 'ready') return fail(404, 'Document not found');
  if (row.kind === 'link') return json({ url: row.external_url });
  const { data: file } = await serviceClient().from('evidence').select('storage_path, file_type').eq('id', id).single();
  const ext = file!.storage_path.split('.').pop();
  const name = /\.[a-z0-9]+$/i.test(row.display_name) ? row.display_name : `${row.display_name}.${ext}`;
  const { data, error } = await serviceClient().storage.from('evidence').createSignedUrl(file!.storage_path, 60, { download: name });
  if (error || !data) throw error || new Error('Could not create a download link');
  return json({ url: data.signedUrl, expires_in: 60 });
}

/** Removes abandoned uploads that never completed. */
export async function cleanStalePending(): Promise<number> {
  const service = serviceClient();
  const { data } = await service.from('evidence').select('id, storage_path').eq('upload_status', 'pending').lt('created_at', new Date(Date.now() - 6 * 3600_000).toISOString());
  for (const row of data || []) {
    await service.storage.from('evidence').remove([row.storage_path]);
    await service.from('evidence').delete().eq('id', row.id);
  }
  return data?.length || 0;
}

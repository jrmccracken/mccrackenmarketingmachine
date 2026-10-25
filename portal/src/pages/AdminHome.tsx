import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { get, post } from '../api.ts';
import { useMe } from '../App.tsx';
import { ago, fmtDate } from '../format.ts';
import { Dialog, Empty, ErrorAlert, Field, Loading, Status, useAction } from '../components/ui.tsx';

interface Overview {
  workspaces: any[]; overdue: any[]; missing: any[]; activity: any[]; notifications: any[];
}

export default function AdminHome() {
  const { me, reload: reloadMe } = useMe();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { busy, run } = useAction();
  const load = useCallback(async () => {
    try { setData(await get<Overview>('/admin/overview')); setError(null); } catch (err) { setError(err); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (me?.user?.role !== 'admin') return <Navigate to="/" replace />;

  const markRead = (body: object) => run('read', async () => { await post('/notifications/read', body); await Promise.all([load(), reloadMe()]); });
  const missingByWs = Object.values((data?.missing || []).reduce((acc: Record<string, { id: string; name: string; items: string[] }>, m) => {
    (acc[m.workspace_id] ||= { id: m.workspace_id, name: m.workspace, items: [] }).items.push(m.item);
    return acc;
  }, {}));
  const visible = (data?.workspaces || []).filter((w) => showArchived || w.status !== 'archived');

  return (
    <main id="main" className="wrap">
      <div className="page-head">
        <div><div className="eyebrow">Administrator</div><h1>Client workspaces</h1><p>Every client workspace, what is missing and what has changed.</p></div>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>New workspace</button>
      </div>
      <ErrorAlert error={error} />
      {!data && !error && <Loading />}
      {data && <>
        <div className="stats" role="list">
          <div role="listitem"><div className="label">Active workspaces</div><div className="big-number">{data.workspaces.filter((w) => w.status === 'active').length}</div></div>
          <div role="listitem"><div className="label">Overdue actions</div><div className="big-number">{data.overdue.length}</div></div>
          <div role="listitem"><div className="label">Missing access items</div><div className="big-number">{data.missing.length}</div></div>
          <div role="listitem"><div className="label">Unread updates</div><div className="big-number">{data.notifications.length}</div></div>
        </div>

        <section className="section" aria-labelledby="ws-h">
          <h2 id="ws-h">Workspaces <span className="count">
            <label className="check" style={{ display: 'inline-flex', padding: 0, minHeight: 0 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
          </span></h2>
          {visible.length ? (
            <table className="table">
              <thead><tr><th scope="col">Client</th><th scope="col">Status</th><th scope="col">Onboarding</th><th scope="col">Missing access</th><th scope="col">Overdue actions</th><th scope="col">People</th></tr></thead>
              <tbody>
                {visible.map((w) => (
                  <tr key={w.id}>
                    <td data-label="Client"><Link to={`/workspaces/${w.id}`}><strong>{w.name}</strong></Link>{w.start_date && <span className="sub">Started {fmtDate(w.start_date)}</span>}</td>
                    <td data-label="Status"><Status value={w.status} /></td>
                    <td data-label="Onboarding">{w.progress}% <span className="sub">{w.checklist_done} of {w.checklist_total} done</span></td>
                    <td data-label="Missing access">{w.missing_access}</td>
                    <td data-label="Overdue actions">{w.overdue_actions ? <Status value="overdue" text={`${w.overdue_actions} overdue`} /> : '0'}</td>
                    <td data-label="People">{w.members.length ? w.members.map((m: any) => (
                      <span className="sub" key={m.email}>{m.name || m.email} · {m.status === 'accepted' ? 'signed in' : m.status === 'invited' ? 'invited' : 'not invited yet'}</span>
                    )) : <span className="sub">No client contacts yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No workspaces yet. Select "New workspace" to set one up.</Empty>}
        </section>

        <div className="grid-2">
          <section className="section" aria-labelledby="notif-h">
            <h2 id="notif-h">Unread updates <span className="count">{data.notifications.length > 0 && <button type="button" className="btn link" disabled={!!busy} onClick={() => markRead({ all: true })}>Mark all as read</button>}</span></h2>
            {data.notifications.length ? (
              <ul className="list">
                {data.notifications.slice(0, 15).map((n) => (
                  <li key={n.id}>
                    <div className="row">
                      <span>{n.link ? <Link to={n.link}>{n.title}</Link> : n.title}</span>
                      <button type="button" className="btn link" disabled={!!busy} onClick={() => markRead({ ids: [n.id] })}>Mark read<span className="sr-only">: {n.title}</span></button>
                    </div>
                    <span className="when">{ago(n.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty>You're up to date.</Empty>}
          </section>

          <section className="section" aria-labelledby="act-h">
            <h2 id="act-h">Recent client activity</h2>
            {data.activity.length ? (
              <ul className="list">{data.activity.slice(0, 12).map((a) => (
                <li key={a.id}><Link to={`/workspaces/${a.workspace_id}?tab=activity`}>{a.workspace}</Link>: {a.description} <span className="when">· {ago(a.created_at)}</span></li>
              ))}</ul>
            ) : <Empty>No client activity yet.</Empty>}
          </section>
        </div>

        <div className="grid-2">
          <section className="section" aria-labelledby="over-h">
            <h2 id="over-h">Overdue actions <span className="count">{data.overdue.length}</span></h2>
            {data.overdue.length ? (
              <ul className="list">{data.overdue.map((a) => (
                <li key={a.id}><div className="row"><span><Link to={`/workspaces/${a.workspace_id}?tab=actions#action-${a.id}`}>{a.action}</Link><span className="sub muted">{a.workspace} · {a.owner_type === 'client' ? 'Client' : 'McCracken Marketing'}</span></span><Status value="overdue" text={`Due ${fmtDate(a.due_date)}`} /></div></li>
              ))}</ul>
            ) : <Empty>Nothing is overdue.</Empty>}
          </section>

          <section className="section" aria-labelledby="miss-h">
            <h2 id="miss-h">Missing access items <span className="count">{data.missing.length}</span></h2>
            {missingByWs.length ? (
              <ul className="list">{missingByWs.map((g) => (
                <li key={g.id}><Link to={`/workspaces/${g.id}?tab=checklist`}><strong>{g.name}</strong></Link>: {g.items.length} outstanding
                  <span className="sub muted">{g.items.slice(0, 3).join(' · ')}{g.items.length > 3 ? ' …' : ''}</span></li>
              ))}</ul>
            ) : <Empty>Every client checklist is complete.</Empty>}
          </section>
        </div>

        <Reminders />
      </>}
      <CreateWorkspace open={creating} onClose={() => setCreating(false)} />
    </main>
  );
}

function CreateWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', start_date: '', contact_name: '', contact_email: '', send_invite: false });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await post<{ workspace: { id: string } }>('/admin/workspaces', { ...f, start_date: f.start_date || null, contact_email: f.contact_email || undefined });
      onClose();
      nav(`/workspaces/${r.workspace.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Dialog title="New workspace" open={open} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorAlert error={error} />
        <Field label="Client or business name">{(p) => <input {...p} className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Start date" hint="Optional">{(p) => <input {...p} className="input" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />}</Field>
        <Field label="Client contact name">{(p) => <input {...p} className="input" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} />}</Field>
        <Field label="Client contact email" hint="Only email addresses you add can sign in to this workspace.">{(p) => <input {...p} className="input" type="email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} />}</Field>
        <label className="check"><input type="checkbox" checked={f.send_invite} disabled={!f.contact_email} onChange={(e) => setF({ ...f, send_invite: e.target.checked })} /> Send the invitation email now</label>
        <p className="muted small-text">The standard onboarding checklist is added automatically. You can edit or remove any item afterwards.</p>
        <div className="actions-row"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

function Reminders() {
  const { busy, run } = useAction();
  const [preview, setPreview] = useState<any>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <section className="section" aria-labelledby="rem-h">
      <h2 id="rem-h">Weekly reminders</h2>
      <p>Clients with outstanding checklist items or overdue actions get one email at 09:00 every Monday. Each person receives at most one reminder a week.</p>
      <div className="actions-row">
        <button type="button" className="btn" disabled={!!busy} onClick={() => run('preview', async () => setPreview(await post('/admin/reminders/run', {})))}>Preview this week's reminders</button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => { setTyped(''); setConfirming(true); }}>Send reminders now</button>
      </div>
      {preview && (
        <div className="panel" style={{ marginTop: 16 }} role="status">
          {preview.planned.length ? <>
            <p><strong>{preview.planned.length}</strong> {preview.planned.length === 1 ? 'person has' : 'people have'} something outstanding{preview.sent !== undefined && !preview.dryRun ? ` · ${preview.sent} sent, ${preview.alreadySent || 0} already reminded this week` : ' (preview only, nothing sent)'}.</p>
            <ul>{preview.planned.map((p: any) => <li key={p.user_id}>{p.email}: {p.sections.map((s: any) => `${s.workspace} (${s.lines.length})`).join(', ')}</li>)}</ul>
          </> : <p>Nobody has anything outstanding, so no reminders would be sent.</p>}
        </div>
      )}
      <Dialog title="Send reminders now?" open={confirming} onClose={() => setConfirming(false)}>
        <p>This emails every client who has outstanding items. Anyone already reminded this week will be skipped. Type <strong>SEND</strong> to confirm.</p>
        <Field label="Type SEND to confirm">{(p) => <input {...p} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}</Field>
        <div className="actions-row">
          <button type="button" className="btn primary" disabled={typed !== 'SEND' || !!busy} onClick={() => run('send', async () => { setPreview(await post('/admin/reminders/run', { send: true, confirm: 'SEND' })); setConfirming(false); }, 'Reminders sent')}>Send reminders</button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      </Dialog>
    </section>
  );
}

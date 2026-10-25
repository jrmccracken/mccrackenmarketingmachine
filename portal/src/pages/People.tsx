import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, patch, post } from '../api.ts';
import { fmtDate, fmtDateTime, label } from '../format.ts';
import { Dialog, Empty, ErrorAlert, Field, Status, useAction } from '../components/ui.tsx';
import type { WorkspaceData } from './Workspace.tsx';

/** Administrator-only: workspace members, invitations, details and status. */
export function PeopleTab({ d, reload }: { d: WorkspaceData; reload: () => Promise<void> }) {
  const ws = d.workspace;
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<any>(null);

  return (
    <>
      <section className="section" aria-labelledby="ppl-h">
        <div className="page-head">
          <div><h2 id="ppl-h">People with access</h2><p>Only these email addresses can sign in to this workspace. You have access to every workspace as the administrator.</p></div>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>Add person</button>
        </div>
        {d.members.length ? (
          <table className="table">
            <thead><tr><th scope="col">Person</th><th scope="col">Access</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.members.map((m) => (
              <tr key={m.user_id}>
                <td data-label="Person"><strong>{m.profile?.name || '–'}</strong><span className="sub">{m.profile?.email}</span></td>
                <td data-label="Access"><Status value={m.invitation_status} />{m.invited_at && m.invitation_status !== 'revoked' && <span className="sub">Last invited {fmtDateTime(m.invited_at)}</span>}</td>
                <td data-label="Last sign-in">{m.profile?.last_login_at ? fmtDateTime(m.profile.last_login_at) : 'Never'}</td>
                <td className="actions-cell">{m.invitation_status !== 'revoked' ? (
                  <div className="actions-row">
                    <button type="button" className="btn small" disabled={!!busy || ws.status !== 'active'} onClick={() => run(`i-${m.user_id}`, async () => { await post(`/admin/workspaces/${ws.id}/members/${m.user_id}/invite`); await reload(); }, 'Invitation sent')}>
                      {m.invitation_status === 'pending' ? 'Send invitation' : 'Resend invitation'}<span className="sr-only"> to {m.profile?.email}</span>
                    </button>
                    <button type="button" className="btn small danger" onClick={() => setRemoving(m)}>Remove access<span className="sr-only"> for {m.profile?.email}</span></button>
                  </div>
                ) : <span className="muted">Access removed</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>No client contacts yet. Add a person to give them access.</Empty>}
      </section>

      <WorkspaceDetails d={d} reload={reload} />

      <AddPerson open={adding} onClose={() => setAdding(false)} ws={ws.id} active={ws.status === 'active'} reload={reload} />
      <Dialog title="Remove access?" open={!!removing} onClose={() => setRemoving(null)}>
        <p>{removing?.profile?.name || removing?.profile?.email} will no longer be able to sign in to this workspace. Their past comments and activity stay in the history. You can add them again later.</p>
        <div className="actions-row">
          <button type="button" className="btn danger solid" disabled={!!busy} onClick={() => run('rm', async () => { await del(`/admin/workspaces/${ws.id}/members/${removing.user_id}`); setRemoving(null); await reload(); }, 'Access removed')}>Remove access</button>
          <button type="button" className="btn" onClick={() => setRemoving(null)}>Cancel</button>
        </div>
      </Dialog>
    </>
  );
}

function AddPerson({ open, onClose, ws, active, reload }: { open: boolean; onClose: () => void; ws: string; active: boolean; reload: () => Promise<void> }) {
  const [f, setF] = useState({ name: '', email: '', send_invite: false });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await post(`/admin/workspaces/${ws}/members`, f);
      setF({ name: '', email: '', send_invite: false });
      onClose();
      await reload();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Add a person" open={open} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorAlert error={error} />
        <Field label="Name">{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Email address" hint="They will sign in with a one-time link sent to this address.">{(p) => <input {...p} className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <label className="check"><input type="checkbox" checked={f.send_invite} disabled={!active} onChange={(e) => setF({ ...f, send_invite: e.target.checked })} /> Send the invitation email now</label>
        <div className="actions-row"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Adding…' : 'Add person'}</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

function WorkspaceDetails({ d, reload }: { d: WorkspaceData; reload: () => Promise<void> }) {
  const ws = d.workspace;
  const nav = useNavigate();
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: ws.name, start_date: ws.start_date || '' });
  const [confirm, setConfirm] = useState<'suspended' | 'archived' | 'delete' | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<unknown>(null);

  const setStatus = (status: string) => run('st', async () => { await patch(`/admin/workspaces/${ws.id}`, { status }); setConfirm(null); await reload(); }, `Workspace ${label(status).toLowerCase()}`);
  const remove = async () => {
    setError(null);
    try { await del(`/admin/workspaces/${ws.id}`, { confirm_name: typed }); nav('/admin'); } catch (err) { setError(err); }
  };

  return (
    <>
      <section className="section" aria-labelledby="det-h">
        <h2 id="det-h">Workspace details</h2>
        <form className="panel" onSubmit={(e) => { e.preventDefault(); run('save', async () => { await patch(`/admin/workspaces/${ws.id}`, { name: f.name, start_date: f.start_date || null }); await reload(); }, 'Saved'); }}>
          <div className="form-grid">
            <Field label="Client or business name">{(p) => <input {...p} className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label="Start date (optional)">{(p) => <input {...p} className="input" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />}</Field>
          </div>
          <button type="submit" className="btn primary" disabled={!!busy}>Save details</button>
          <p className="muted small-text" style={{ marginTop: 12, marginBottom: 0 }}>Created {fmtDate(ws.created_at)} · last updated {fmtDateTime(ws.updated_at)}</p>
        </form>
      </section>

      <section className="section" aria-labelledby="stat-h">
        <h2 id="stat-h">Workspace status</h2>
        <p>Current status: <Status value={ws.status} /></p>
        <ul>
          <li><strong>Suspend</strong> stops clients signing in. Everything is kept and you can reactivate at any time.</li>
          <li><strong>Archive</strong> is for finished engagements. Clients can't sign in; the records are kept.</li>
          <li><strong>Delete permanently</strong> is only available after archiving, and removes the workspace, its history and its files for good.</li>
        </ul>
        <div className="actions-row">
          {ws.status !== 'active' && <button type="button" className="btn primary" disabled={!!busy} onClick={() => setStatus('active')}>Reactivate</button>}
          {ws.status === 'active' && <button type="button" className="btn" onClick={() => setConfirm('suspended')}>Suspend</button>}
          {ws.status !== 'archived' && <button type="button" className="btn" onClick={() => setConfirm('archived')}>Archive</button>}
          {ws.status === 'archived' && <button type="button" className="btn danger" onClick={() => { setTyped(''); setError(null); setConfirm('delete'); }}>Delete permanently</button>}
        </div>
      </section>

      <Dialog title={confirm === 'delete' ? 'Delete this workspace permanently?' : `${confirm === 'archived' ? 'Archive' : 'Suspend'} this workspace?`} open={!!confirm} onClose={() => setConfirm(null)}>
        {confirm === 'delete' ? <>
          <div className="alert error" role="alert"><strong>This can't be undone.</strong> The workspace, its checklist, actions, findings, comments, activity history and every uploaded file will be deleted.</div>
          <p>Download anything you need to keep first. Supabase backups may still hold a copy until they expire.</p>
          <ErrorAlert error={error} />
          <Field label={`Type the workspace name to confirm: ${ws.name}`}>{(p) => <input {...p} className="input" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field>
          <div className="actions-row">
            <button type="button" className="btn danger solid" disabled={typed.trim() !== ws.name} onClick={remove}>Delete permanently</button>
            <button type="button" className="btn" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </> : <>
          <p>Clients will not be able to sign in to {ws.name} until you reactivate it. Nothing is deleted.</p>
          <div className="actions-row">
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => setStatus(confirm!)}>{confirm === 'archived' ? 'Archive' : 'Suspend'}</button>
            <button type="button" className="btn" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </>}
      </Dialog>
    </>
  );
}

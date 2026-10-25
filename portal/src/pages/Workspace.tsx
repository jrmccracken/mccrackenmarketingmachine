import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { del, get, patch, post } from '../api.ts';
import { useMe } from '../App.tsx';
import { ago, fmtDate, fmtDateTime, fmtSize, isOverdue, label } from '../format.ts';
import { Dialog, Empty, ErrorAlert, Field, Loading, Priority, Status, useAction, useToast } from '../components/ui.tsx';
import { PeopleTab } from './People.tsx';

type Row = Record<string, any>;
export interface WorkspaceData {
  workspace: Row; isAdmin: boolean; me: Row; members: Row[]; checklist: Row[]; actions: Row[]; interviews: Row[];
  findings: Row[]; evidence: Row[]; comments: Row[]; activity: Row[];
}

const TABS: [string, string][] = [
  ['overview', 'Overview'], ['checklist', 'Access checklist'], ['actions', 'Actions'], ['interviews', 'Interviews'],
  ['findings', 'Findings'], ['documents', 'Documents'], ['discussion', 'Questions and comments'], ['activity', 'Activity'],
];

const STATUS_OPTIONS: Record<string, string[]> = {
  checklist: ['not_started', 'in_progress', 'done', 'not_applicable'],
  actions: ['not_started', 'in_progress', 'blocked', 'done'],
  interviews: ['to_schedule', 'scheduled', 'completed', 'cancelled'],
  findings: ['draft', 'shared', 'agreed', 'in_progress', 'closed'],
};

export default function Workspace() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    try { setData(await get<WorkspaceData>(`/workspaces/${id}`)); setError(null); } catch (err) { setError(err); }
  }, [id]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  useEffect(() => {
    // Jump to a linked record (for example from an email) once the data is on screen.
    if (data && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
  }, [data, tab]);

  if (error) return <main id="main" className="wrap"><ErrorAlert error={error} /><p><Link to="/">Back to your workspaces</Link></p></main>;
  if (!data) return <main id="main" className="wrap"><Loading /></main>;

  const tabs = data.isAdmin ? [...TABS, ['people', 'People and settings'] as [string, string]] : TABS;
  const progress = checklistProgress(data.checklist);
  const mine = data.actions.filter((a) => a.owner_type === 'client' && a.status !== 'done' && !a.deleted_at);

  return (
    <main id="main" className="ws-main">
      <div className="ws-band">
        <div className="wrap">
          <div className="eyebrow">{data.isAdmin ? 'Client workspace' : 'Your workspace'}</div>
          <h1>{data.workspace.name}</h1>
          <div className="meta">
            <span>Onboarding {progress.pct}% complete ({progress.done} of {progress.total})</span>
            {data.workspace.start_date && <span>Started {fmtDate(data.workspace.start_date)}</span>}
            {data.workspace.status !== 'active' && <Status value={data.workspace.status} />}
          </div>
          <nav aria-label="Workspace sections">
            <div className="tabs">
              {tabs.map(([key, text]) => (
                <a key={key} href={`?tab=${key}`} aria-current={tab === key ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); setParams({ tab: key }); }}>
                  {text}{key === 'actions' && mine.length > 0 && <span className="badge-count" aria-label={`${mine.length} open for the client`}>{mine.length}</span>}
                </a>
              ))}
            </div>
          </nav>
        </div>
      </div>
      <div className="wrap ws-content">
        {data.workspace.status !== 'active' && data.isAdmin && (
          <div className="note" role="note">This workspace is {label(data.workspace.status).toLowerCase()}. Clients can't sign in to it until it is reactivated in People and settings.</div>
        )}
        {tab === 'overview' && <Overview d={data} go={(t) => setParams({ tab: t })} />}
        {tab === 'checklist' && <Checklist d={data} reload={reload} />}
        {tab === 'actions' && <Actions d={data} reload={reload} />}
        {tab === 'interviews' && <Interviews d={data} reload={reload} />}
        {tab === 'findings' && <Findings d={data} reload={reload} />}
        {tab === 'documents' && <Documents d={data} reload={reload} />}
        {tab === 'discussion' && <Discussion d={data} reload={reload} />}
        {tab === 'activity' && <Activity d={data} />}
        {tab === 'people' && data.isAdmin && <PeopleTab d={data} reload={reload} />}
      </div>
    </main>
  );
}

export function checklistProgress(items: Row[]) {
  const counted = items.filter((c) => !c.deleted_at && c.status !== 'not_applicable');
  const done = counted.filter((c) => c.status === 'done').length;
  return { total: counted.length, done, pct: counted.length ? Math.round((done / counted.length) * 100) : 0 };
}

const live = (rows: Row[]) => rows.filter((r) => !r.deleted_at);

// ---------------------------------------------------------------- overview

function Overview({ d, go }: { d: WorkspaceData; go: (tab: string) => void }) {
  const progress = checklistProgress(d.checklist);
  const actions = live(d.actions).filter((a) => a.status !== 'done');
  const priorities = actions.filter((a) => a.priority === 'high' || a.important).slice(0, 5);
  const forClient = actions.filter((a) => a.owner_type === 'client');
  const interviews = live(d.interviews).filter((i) => i.status !== 'cancelled');
  const findings = live(d.findings).filter((f) => d.isAdmin || f.status !== 'draft');
  const byCategory = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const c of live(d.checklist)) {
      if (c.status === 'not_applicable') continue;
      const g = m.get(c.category) || { done: 0, total: 0 };
      g.total++; if (c.status === 'done') g.done++;
      m.set(c.category, g);
    }
    return [...m.entries()];
  }, [d.checklist]);

  return (
    <>
      <section className="section" aria-labelledby="progress-h">
        <h2 id="progress-h">Overall progress</h2>
        <div className="progress">
          <span className="big-number">{progress.pct}%</span>
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.pct} aria-label="Onboarding checklist complete"><span style={{ width: `${progress.pct}%` }} /></div>
          <span>{progress.done} of {progress.total} checklist items done</span>
        </div>
      </section>

      <div className="grid-2">
        <section className="section" aria-labelledby="prio-h">
          <h2 id="prio-h">Current priorities</h2>
          {priorities.length ? (
            <ul className="list">{priorities.map((a) => (
              <li key={a.id}><div className="row"><span>{a.action}<span className="sub muted">{a.owner_type === 'client' ? 'For you' : 'McCracken Marketing'}{a.due_date ? ` · due ${fmtDate(a.due_date)}` : ''}</span></span><Priority value={a.priority} /></div></li>
            ))}</ul>
          ) : <Empty>No high-priority actions at the moment.</Empty>}
        </section>

        <section className="section" aria-labelledby="client-h">
          <h2 id="client-h">{d.isAdmin ? 'Actions with the client' : 'Actions for you'} <span className="count">{forClient.length}</span></h2>
          {forClient.length ? (
            <ul className="list">{forClient.slice(0, 6).map((a) => (
              <li key={a.id}><div className="row"><span>{a.action}</span>{isOverdue(a.due_date, a.status) ? <Status value="overdue" text={`Overdue: ${fmtDate(a.due_date)}`} /> : <Status value={a.status} />}</div></li>
            ))}</ul>
          ) : <Empty>Nothing waiting on {d.isAdmin ? 'the client' : 'you'}.</Empty>}
          {forClient.length > 0 && <p><button type="button" className="btn link" onClick={() => go('actions')}>See all actions</button></p>}
        </section>
      </div>

      <div className="grid-2">
        <section className="section" aria-labelledby="access-h">
          <h2 id="access-h">Access checklist</h2>
          {byCategory.length ? (
            <table className="table">
              <thead><tr><th scope="col">Area</th><th scope="col">Progress</th></tr></thead>
              <tbody>{byCategory.map(([cat, g]) => (
                <tr key={cat}><td data-label="Area">{cat}</td><td data-label="Progress">{g.done === g.total ? <Status value="done" text={`${g.done} of ${g.total} done`} /> : `${g.done} of ${g.total} done`}</td></tr>
              ))}</tbody>
            </table>
          ) : <Empty>No checklist items yet.</Empty>}
          <p><button type="button" className="btn link" onClick={() => go('checklist')}>Open the checklist</button></p>
        </section>

        <section className="section" aria-labelledby="int-h">
          <h2 id="int-h">Interviews</h2>
          {interviews.length ? <>
            <p>{interviews.filter((i) => i.status === 'completed').length} of {interviews.length} stakeholder conversations completed.</p>
            <ul className="list">{interviews.slice(0, 5).map((i) => (
              <li key={i.id}><div className="row"><span>{i.stakeholder_name}{i.stakeholder_role && <span className="sub muted">{i.stakeholder_role}</span>}</span><Status value={i.status} /></div></li>
            ))}</ul>
          </> : <Empty>No interviews planned yet.</Empty>}

          <h2 id="find-h" style={{ marginTop: 28 }}>Findings and recommendations</h2>
          {findings.length ? (
            <ul className="list">{findings.slice(0, 4).map((f) => (
              <li key={f.id}><div className="row"><span>{f.title}</span><Priority value={f.priority} /></div></li>
            ))}</ul>
          ) : <Empty>Findings will appear here once they are shared.</Empty>}
        </section>
      </div>

      <section className="section" aria-labelledby="recent-h">
        <h2 id="recent-h">Recent activity</h2>
        <ActivityList rows={d.activity.slice(0, 8)} />
        <p><button type="button" className="btn link" onClick={() => go('activity')}>See all activity</button></p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- shared editing pieces

interface FieldDef { key: string; label: string; type: 'text' | 'textarea' | 'date' | 'select' | 'checkbox'; options?: [string, string][]; required?: boolean; hint?: string }

function RecordForm({ fields, initial, onSubmit, submitLabel, onCancel }: { fields: FieldDef[]; initial: Row; onSubmit: (v: Row) => Promise<void>; submitLabel: string; onCancel: () => void }) {
  const [v, setV] = useState<Row>(() => ({ ...initial }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = fields.find((f) => f.required && !String(v[f.key] ?? '').trim());
    if (missing) { setError(new Error(`${missing.label} is required`)); return; }
    setBusy(true); setError(null);
    try {
      const out: Row = {};
      for (const f of fields) out[f.key] = f.type === 'date' ? (v[f.key] || null) : f.type === 'checkbox' ? !!v[f.key] : (v[f.key] ?? '');
      await onSubmit(out);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate>
      <ErrorAlert error={error} />
      <div className="form-grid">
        {fields.map((f) => f.type === 'checkbox' ? (
          <label key={f.key} className="check full"><input type="checkbox" checked={!!v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.checked })} /> <span>{f.label}{f.hint && <span className="sub muted">{f.hint}</span>}</span></label>
        ) : (
          <div key={f.key} className={f.type === 'textarea' ? 'full' : undefined}>
            <Field label={f.label + (f.required ? '' : ' (optional)')} hint={f.hint}>{(p) =>
              f.type === 'textarea' ? <textarea {...p} className="input" value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
                : f.type === 'select' ? <select {...p} className="input" value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value || null })}>{f.options!.map(([val, text]) => <option key={val} value={val}>{text}</option>)}</select>
                  : <input {...p} className="input" type={f.type} value={v[f.key] ?? ''} required={f.required} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}
            </Field>
          </div>
        ))}
      </div>
      <div className="actions-row"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

const opts = (values: string[]): [string, string][] => values.map((v) => [v, label(v)]);

function useEditor(ws: string, kind: string, reload: () => Promise<void>) {
  const toast = useToast();
  const [editing, setEditing] = useState<Row | null>(null);
  const save = async (values: Row) => {
    if (editing?.id) await patch(`/workspaces/${ws}/${kind}/${editing.id}`, values);
    else await post(`/workspaces/${ws}/${kind}`, values);
    setEditing(null);
    toast('Saved');
    await reload();
  };
  return { editing, setEditing, save };
}

function RemoveButton({ ws, kind, row, name, reload }: { ws: string; kind: string; row: Row; name: string; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const { busy, run } = useAction();
  return <>
    <button type="button" className="btn small danger" onClick={() => setOpen(true)}>Remove<span className="sr-only">: {name}</span></button>
    <Dialog title="Remove this item?" open={open} onClose={() => setOpen(false)}>
      <p>"{name}" will be hidden from the client. It stays in the database and the activity history, so it can be restored if needed.</p>
      <div className="actions-row">
        <button type="button" className="btn danger solid" disabled={!!busy} onClick={() => run('x', async () => { await del(`/workspaces/${ws}/${kind}/${row.id}`); setOpen(false); await reload(); }, 'Removed')}>Remove</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Keep it</button>
      </div>
    </Dialog>
  </>;
}

/** "Comments (n)" button that opens the thread for one record. */
function CommentsButton({ d, type, record, title, reload }: { d: WorkspaceData; type: string; record: Row; title: string; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const thread = d.comments.filter((c) => c.record_type === type && c.record_id === record.id && !c.deleted_at);
  return <>
    <button type="button" className="btn small" onClick={() => setOpen(true)}>Comments ({thread.length})<span className="sr-only"> on {title}</span></button>
    <Dialog title={`Comments: ${title.length > 60 ? title.slice(0, 60) + '…' : title}`} open={open} onClose={() => setOpen(false)}>
      <Thread d={d} rows={thread} reload={reload} />
      <CommentForm ws={d.workspace.id} type={type} recordId={record.id} reload={reload} />
    </Dialog>
  </>;
}

function Thread({ d, rows, reload }: { d: WorkspaceData; rows: Row[]; reload: () => Promise<void> }) {
  const { busy, run } = useAction();
  if (!rows.length) return <p className="muted">No comments yet.</p>;
  return (
    <ul className="thread">{rows.map((c) => (
      <li key={c.id}>
        <span className="who">{c.author?.name || c.author?.email || 'Former member'}</span>{c.author?.role === 'admin' && ' (McCracken Marketing)'} <span className="when">· {fmtDateTime(c.created_at)}</span>
        <div className="body">{c.body}</div>
        {d.isAdmin && <button type="button" className="btn link" disabled={!!busy} onClick={() => run('h', async () => { await del(`/workspaces/${d.workspace.id}/comments/${c.id}`); await reload(); }, 'Comment hidden')}>Hide comment</button>}
      </li>
    ))}</ul>
  );
}

function CommentForm({ ws, type, recordId, reload, labelText = 'Add a comment' }: { ws: string; type: string; recordId?: string; reload: () => Promise<void>; labelText?: string }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const { busy, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) { setError('Write a comment first'); return; }
    setError('');
    run('c', async () => { await post(`/workspaces/${ws}/comments`, { record_type: type, record_id: recordId, body }); setBody(''); await reload(); }, 'Comment added');
  };
  return (
    <form onSubmit={submit} noValidate>
      <Field label={labelText} error={error} hint="Please don't include passwords or sensitive personal information.">{(p) => <textarea {...p} className="input" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />}</Field>
      <button type="submit" className="btn primary" disabled={!!busy}>{busy ? 'Posting…' : 'Post comment'}</button>
    </form>
  );
}

/** Status dropdown plus notes, for the items a client may update. */
function ClientUpdate({ d, kind, row, reload }: { d: WorkspaceData; kind: 'checklist' | 'actions'; row: Row; reload: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(row.notes || '');
  const name = row.item || row.action;
  const save = (values: Row, msg: string) => run('u', async () => { await patch(`/workspaces/${d.workspace.id}/${kind}/${row.id}`, values); await reload(); }, msg);
  return <>
    <label className="sr-only" htmlFor={`st-${row.id}`}>Status of {name}</label>
    <select id={`st-${row.id}`} className="inline-select" value={row.status} disabled={!!busy} onChange={(e) => save({ status: e.target.value }, 'Status updated')}>
      {STATUS_OPTIONS[kind].map((s) => <option key={s} value={s}>{label(s)}</option>)}
    </select>
    <button type="button" className="btn small" onClick={() => { setNotes(row.notes || ''); setNotesOpen(true); }}>{row.notes ? 'Edit answer' : 'Add answer'}<span className="sr-only"> for {name}</span></button>
    <Dialog title="Your answer or notes" open={notesOpen} onClose={() => setNotesOpen(false)}>
      <p><strong>{name}</strong></p>
      <Field label="Answer or notes" hint="For example, who granted access and when. Don't include passwords.">{(p) => <textarea {...p} className="input" value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />}</Field>
      <div className="actions-row"><button type="button" className="btn primary" disabled={!!busy} onClick={async () => { await save({ notes }, 'Saved'); setNotesOpen(false); }}>Save</button><button type="button" className="btn" onClick={() => setNotesOpen(false)}>Cancel</button></div>
    </Dialog>
  </>;
}

// ---------------------------------------------------------------- checklist

function Checklist({ d, reload }: { d: WorkspaceData; reload: () => Promise<void> }) {
  const ed = useEditor(d.workspace.id, 'checklist', reload);
  const rows = live(d.checklist);
  const categories = [...new Set(rows.map((r) => r.category))];
  const fields: FieldDef[] = [
    { key: 'category', label: 'Category', type: 'text', required: true, hint: 'For example GA4, CRM or Brand assets' },
    { key: 'item', label: 'Item', type: 'textarea', required: true },
    { key: 'owner_type', label: 'Who does this', type: 'select', options: opts(['client', 'mccracken']) },
    { key: 'status', label: 'Status', type: 'select', options: opts(STATUS_OPTIONS.checklist) },
    { key: 'due_date', label: 'Due date', type: 'date' },
    { key: 'client_editable', label: 'The client can update the status and answer', type: 'checkbox' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ];
  return (
    <section className="section" aria-labelledby="cl-h">
      <div className="page-head">
        <div><h2 id="cl-h">Access and onboarding checklist</h2><p>Mark each item as you complete it and add any answers. McCracken Marketing is notified of changes.</p></div>
        {d.isAdmin && <button type="button" className="btn primary" onClick={() => ed.setEditing({ category: categories[0] || '', item: '', owner_type: 'client', status: 'not_started', client_editable: true })}>Add item</button>}
      </div>
      {!d.isAdmin && <p className="note">Please share access by adding <strong>james@mccrackenmarketing.co.uk</strong> as a user in each tool. Never send passwords through the portal or by email.</p>}
      {rows.length ? (
        <table className="table">
          <thead><tr><th scope="col">Item</th><th scope="col">Who</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          {categories.map((cat) => (
            <tbody key={cat}>
              <tr className="group-row"><th colSpan={5} scope="colgroup">{cat}</th></tr>
              {rows.filter((r) => r.category === cat).map((r) => {
                const canEdit = d.isAdmin || r.client_editable;
                return (
                  <tr key={r.id} id={`checklist-${r.id}`}>
                    <td data-label="Item">{r.item}{r.notes && <span className="sub"><strong>Answer:</strong> {r.notes}</span>}</td>
                    <td data-label="Who">{label(r.owner_type)}</td>
                    <td data-label="Status">{isOverdue(r.due_date, r.status) ? <Status value="overdue" text={`Overdue · ${label(r.status)}`} /> : <Status value={r.status} />}</td>
                    <td data-label="Due" className={r.due_date ? undefined : 'blank'}>{fmtDate(r.due_date) || '–'}</td>
                    <td className="actions-cell"><div className="actions-row">
                      {canEdit && !d.isAdmin && <ClientUpdate d={d} kind="checklist" row={r} reload={reload} />}
                      {d.isAdmin && <button type="button" className="btn small" onClick={() => ed.setEditing(r)}>Edit<span className="sr-only">: {r.item}</span></button>}
                      <CommentsButton d={d} type="checklist" record={r} title={r.item} reload={reload} />
                      {d.isAdmin && <RemoveButton ws={d.workspace.id} kind="checklist" row={r} name={r.item} reload={reload} />}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      ) : <Empty>No checklist items yet.</Empty>}
      <Dialog title={ed.editing?.id ? 'Edit checklist item' : 'Add checklist item'} open={!!ed.editing} onClose={() => ed.setEditing(null)}>
        {ed.editing && <RecordForm fields={fields} initial={ed.editing} onSubmit={ed.save} submitLabel="Save item" onCancel={() => ed.setEditing(null)} />}
      </Dialog>
    </section>
  );
}

// ---------------------------------------------------------------- actions

function Actions({ d, reload }: { d: WorkspaceData; reload: () => Promise<void> }) {
  const ed = useEditor(d.workspace.id, 'actions', reload);
  const [filter, setFilter] = useState('open');
  const people = d.members.filter((m) => m.invitation_status !== 'revoked');
  const rows = live(d.actions).filter((a) => filter === 'all' || (filter === 'open' ? a.status !== 'done' : filter === 'client' ? a.owner_type === 'client' && a.status !== 'done' : a.status === 'done'));
  const fields: FieldDef[] = [
    { key: 'action', label: 'Action', type: 'textarea', required: true },
    { key: 'owner_type', label: 'Owner', type: 'select', options: opts(['client', 'mccracken']) },
    { key: 'owner_id', label: 'Client contact', type: 'select', options: [['', 'Anyone at the client'], ...people.map((m) => [m.user_id, m.profile?.name || m.profile?.email] as [string, string])], hint: 'Only used when the client owns the action' },
    { key: 'priority', label: 'Priority', type: 'select', options: opts(['high', 'medium', 'low']) },
    { key: 'status', label: 'Status', type: 'select', options: opts(STATUS_OPTIONS.actions) },
    { key: 'due_date', label: 'Due date', type: 'date' },
    { key: 'important', label: 'Important: email the client about this action', type: 'checkbox', hint: 'Sent once, when a client-owned action is first marked important' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ];
  return (
    <section className="section" aria-labelledby="ac-h">
      <div className="page-head">
        <div><h2 id="ac-h">Actions</h2><p>What needs doing, who owns it and when it is due.</p></div>
        {d.isAdmin && <button type="button" className="btn primary" onClick={() => ed.setEditing({ action: '', owner_type: 'client', priority: 'medium', status: 'not_started', owner_id: '' })}>Add action</button>}
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
        <legend className="sr-only">Show</legend>
        <div className="actions-row">
          {[['open', 'Open'], ['client', d.isAdmin ? 'With the client' : 'For you'], ['done', 'Done'], ['all', 'All']].map(([k, t]) => (
            <button key={k} type="button" className={`btn small ${filter === k ? 'primary' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{t}</button>
          ))}
        </div>
      </fieldset>
      {rows.length ? (
        <table className="table">
          <thead><tr><th scope="col">Action</th><th scope="col">Owner</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id} id={`action-${a.id}`}>
              <td data-label="Action">{a.action}{a.notes && <span className="sub">{a.notes}</span>}</td>
              <td data-label="Owner">{a.owner_type === 'client' ? (people.find((m) => m.user_id === a.owner_id)?.profile?.name || 'Client') : 'McCracken Marketing'}</td>
              <td data-label="Priority"><Priority value={a.priority} /></td>
              <td data-label="Status">{isOverdue(a.due_date, a.status) ? <Status value="overdue" text={`Overdue · ${label(a.status)}`} /> : <Status value={a.status} />}</td>
              <td data-label="Due" className={a.due_date ? undefined : 'blank'}>{fmtDate(a.due_date) || '–'}</td>
              <td className="actions-cell"><div className="actions-row">
                {!d.isAdmin && a.owner_type === 'client' && <ClientUpdate d={d} kind="actions" row={a} reload={reload} />}
                {d.isAdmin && <button type="button" className="btn small" onClick={() => ed.setEditing({ ...a, owner_id: a.owner_id || '' })}>Edit<span className="sr-only">: {a.action}</span></button>}
                <CommentsButton d={d} type="action" record={a} title={a.action} reload={reload} />
                {d.isAdmin && <RemoveButton ws={d.workspace.id} kind="actions" row={a} name={a.action} reload={reload} />}
              </div></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty>No actions to show.</Empty>}
      <Dialog title={ed.editing?.id ? 'Edit action' : 'Add action'} open={!!ed.editing} onClose={() => ed.setEditing(null)}>
        {ed.editing && <RecordForm fields={fields} initial={ed.editing} onSubmit={(v) => ed.save({ ...v, owner_id: v.owner_id || null })} submitLabel="Save action" onCancel={() => ed.setEditing(null)} />}
      </Dialog>
    </section>
  );
}

// ---------------------------------------------------------------- interviews

function Interviews({ d, reload }: { d: WorkspaceData; reload: () => Promise<void> }) {
  const ed = useEditor(d.workspace.id, 'interviews', reload);
  const rows = live(d.interviews);
  const fields: FieldDef[] = [
    { key: 'stakeholder_name', label: 'Stakeholder name', type: 'text', required: true },
    { key: 'stakeholder_role', label: 'Role', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: opts(STATUS_OPTIONS.interviews) },
    { key: 'planned_date', label: 'Planned date', type: 'date' },
    { key: 'completed_date', label: 'Completed date', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea', hint: 'Visible to the client. Keep personal opinions about individuals out of shared notes.' },
  ];
  return (
    <section className="section" aria-labelledby="iv-h">
      <div className="page-head">
        <div><h2 id="iv-h">Interviews and stakeholder conversations</h2><p>Who we are speaking to, and where each conversation has got to.</p></div>
        {d.isAdmin && <button type="button" className="btn primary" onClick={() => ed.setEditing({ stakeholder_name: '', stakeholder_role: '', status: 'to_schedule' })}>Add interview</button>}
      </div>
      {rows.length ? (
        <table className="table">
          <thead><tr><th scope="col">Stakeholder</th><th scope="col">Status</th><th scope="col">Planned</th><th scope="col">Completed</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((i) => (
            <tr key={i.id} id={`interview-${i.id}`}>
              <td data-label="Stakeholder"><strong>{i.stakeholder_name}</strong>{i.stakeholder_role && <span className="sub">{i.stakeholder_role}</span>}{i.notes && <span className="sub">{i.notes}</span>}</td>
              <td data-label="Status"><Status value={i.status} /></td>
              <td data-label="Planned" className={i.planned_date ? undefined : 'blank'}>{fmtDate(i.planned_date) || '–'}</td>
              <td data-label="Completed" className={i.completed_date ? undefined : 'blank'}>{fmtDate(i.completed_date) || '–'}</td>
              <td className="actions-cell"><div className="actions-row">
                {d.isAdmin && <button type="button" className="btn small" onClick={() => ed.setEditing(i)}>Edit<span className="sr-only">: {i.stakeholder_name}</span></button>}
                <CommentsButton d={d} type="interview" record={i} title={i.stakeholder_name} reload={reload} />
                {d.isAdmin && <RemoveButton ws={d.workspace.id} kind="interviews" row={i} name={i.stakeholder_name} reload={reload} />}
              </div></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty>No interviews yet.{!d.isAdmin && ' McCracken Marketing will add the stakeholder conversations planned with your team.'}</Empty>}
      <Dialog title={ed.editing?.id ? 'Edit interview' : 'Add interview'} open={!!ed.editing} onClose={() => ed.setEditing(null)}>
        {ed.editing && <RecordForm fields={fields} initial={ed.editing} onSubmit={ed.save} submitLabel="Save interview" onCancel={() => ed.setEditing(null)} />}
      </Dialog>
    </section>
  );
}

// ---------------------------------------------------------------- findings

function Findings({ d, reload }: { d: WorkspaceData; reload: () => Promise<void> }) {
  const ed = useEditor(d.workspace.id, 'findings', reload);
  const rows = live(d.findings);
  const fields: FieldDef[] = [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'category', label: 'Category', type: 'text', hint: 'For example Website, Paid media, Positioning' },
    { key: 'priority', label: 'Priority', type: 'select', options: opts(['high', 'medium', 'low']) },
    { key: 'status', label: 'Status', type: 'select', options: opts(STATUS_OPTIONS.findings), hint: 'Draft findings are visible only to you' },
    { key: 'summary', label: 'Finding and recommendation', type: 'textarea' },
    { key: 'evidence', label: 'Evidence', type: 'textarea', hint: 'What supports this, for example data or document names' },
  ];
  return (
    <section className="section" aria-labelledby="fi-h">
      <div className="page-head">
        <div><h2 id="fi-h">Findings and recommendations</h2><p>What we have found and what we recommend. Add a comment to ask a question or respond.</p></div>
        {d.isAdmin && <button type="button" className="btn primary" onClick={() => ed.setEditing({ title: '', category: '', priority: 'medium', status: 'draft', summary: '', evidence: '' })}>Add finding</button>}
      </div>
      {rows.length ? (
        <ul className="list">{rows.map((f) => (
          <li key={f.id} id={`finding-${f.id}`}>
            <div className="row"><h3 style={{ margin: 0 }}>{f.title}</h3><span className="actions-row"><Priority value={f.priority} />{(d.isAdmin || f.status !== 'shared') && <Status value={f.status} />}</span></div>
            {f.category && <p className="muted small-text" style={{ margin: '4px 0 8px' }}>{f.category}</p>}
            {f.summary && <p style={{ whiteSpace: 'pre-wrap' }}>{f.summary}</p>}
            {f.evidence && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}><strong>Evidence:</strong> {f.evidence}</p>}
            <div className="actions-row">
              {d.isAdmin && <button type="button" className="btn small" onClick={() => ed.setEditing(f)}>Edit<span className="sr-only">: {f.title}</span></button>}
              <CommentsButton d={d} type="finding" record={f} title={f.title} reload={reload} />
              {d.isAdmin && <RemoveButton ws={d.workspace.id} kind="findings" row={f} name={f.title} reload={reload} />}
            </div>
          </li>
        ))}</ul>
      ) : <Empty>No findings yet. They will appear here once McCracken Marketing shares them.</Empty>}
      <Dialog title={ed.editing?.id ? 'Edit finding' : 'Add finding'} open={!!ed.editing} onClose={() => ed.setEditing(null)}>
        {ed.editing && <RecordForm fields={fields} initial={ed.editing} onSubmit={ed.save} submitLabel="Save finding" onCancel={() => ed.setEditing(null)} />}
      </Dialog>
    </section>
  );
}

// ---------------------------------------------------------------- documents

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg,.webp,.gif';

function Documents({ d, reload }: { d: WorkspaceData; reload: () => Promise<void> }) {
  const ws = d.workspace.id;
  const { busy, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [link, setLink] = useState({ url: '', display_name: '' });
  const [linkError, setLinkError] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const rows = d.evidence.filter((e) => d.isAdmin ? true : !e.deleted_at);

  const upload = (e: FormEvent) => {
    e.preventDefault();
    setFileError('');
    if (!file) { setFileError('Choose a file to upload'); return; }
    if (file.size > 10 * 1024 * 1024) { setFileError('Files must be 10 MB or smaller'); return; }
    run('up', async () => {
      try {
        const start = await post<{ id: string; upload_url: string; content_type: string }>(`/workspaces/${ws}/evidence/upload`, { file_name: file.name, mime_type: file.type, size: file.size, display_name: fileName });
        const res = await fetch(start.upload_url, { method: 'PUT', headers: { 'content-type': start.content_type, 'x-upsert': 'false' }, body: file });
        if (!res.ok) throw new Error('The upload did not complete. Please try again.');
        await post(`/workspaces/${ws}/evidence/${start.id}/complete`);
      } catch (err) { setFileError(err instanceof Error ? err.message : 'Upload failed'); throw err; }
      setFile(null); setFileName(''); setInputKey((k) => k + 1);
      await reload();
    }, 'Document uploaded');
  };

  const addLink = (e: FormEvent) => {
    e.preventDefault();
    setLinkError('');
    if (!/^https:\/\//i.test(link.url.trim())) { setLinkError('Enter a full web address starting with https://'); return; }
    run('link', async () => {
      try { await post(`/workspaces/${ws}/evidence/link`, link); } catch (err) { setLinkError(err instanceof Error ? err.message : 'Could not add the link'); throw err; }
      setLink({ url: '', display_name: '' });
      await reload();
    }, 'Link added');
  };

  const open = (row: Row) => run(`dl-${row.id}`, async () => {
    const r = await get<{ url: string }>(`/workspaces/${ws}/evidence/${row.id}/download`);
    window.location.assign(r.url);
  });

  return (
    <section className="section" aria-labelledby="doc-h">
      <h2 id="doc-h">Documents and evidence</h2>
      <div className="note" role="note"><strong>Business documents only.</strong> Please don't upload passwords, unnecessary personal data about customers or staff, or special-category data (for example health information). Remove personal details from exports where you can.</div>
      <div className="grid-2">
        <form className="panel section" onSubmit={upload} noValidate aria-labelledby="up-h">
          <h3 id="up-h">Upload a file</h3>
          <Field label="File" hint="PDF, Word, Excel, PowerPoint, CSV, text or image files, up to 10 MB" error={fileError}>{(p) =>
            <input {...p} key={inputKey} className="input" type="file" accept={ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] || null); setFileError(''); }} />}</Field>
          <Field label="Name (optional)" hint="Defaults to the file name">{(p) => <input {...p} className="input" value={fileName} maxLength={200} onChange={(e) => setFileName(e.target.value)} />}</Field>
          <button type="submit" className="btn primary" disabled={!!busy}>{busy === 'up' ? 'Uploading…' : 'Upload'}</button>
        </form>
        <form className="panel section" onSubmit={addLink} noValidate aria-labelledby="ln-h">
          <h3 id="ln-h">Add a link to a document</h3>
          <Field label="Web address" hint="For example a Google Drive or SharePoint link. Make sure james@mccrackenmarketing.co.uk has access." error={linkError}>{(p) =>
            <input {...p} className="input" type="url" inputMode="url" placeholder="https://" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} />}</Field>
          <Field label="Name (optional)">{(p) => <input {...p} className="input" value={link.display_name} maxLength={200} onChange={(e) => setLink({ ...link, display_name: e.target.value })} />}</Field>
          <button type="submit" className="btn primary" disabled={!!busy}>{busy === 'link' ? 'Adding…' : 'Add link'}</button>
        </form>
      </div>
      {rows.length ? (
        <table className="table">
          <thead><tr><th scope="col">Document</th><th scope="col">Added by</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id} id={`evidence-${e.id}`}>
              <td data-label="Document"><strong>{e.display_name}</strong>
                <span className="sub">{e.kind === 'link' ? `Link · ${safeHost(e.external_url)}` : `File · ${fmtSize(e.file_size)}`}{e.deleted_at ? ' · removed' : ''}{e.upload_status === 'pending' ? ' · upload not finished' : ''}</span></td>
              <td data-label="Added by">{e.uploader?.name || e.uploader?.email || '–'}</td>
              <td data-label="Added">{fmtDate(e.created_at)}</td>
              <td className="actions-cell"><div className="actions-row">
                {e.upload_status === 'ready' && <button type="button" className="btn small" disabled={busy === `dl-${e.id}`} onClick={() => open(e)}>{e.kind === 'link' ? 'Open link' : 'Download'}<span className="sr-only">: {e.display_name}</span></button>}
                <CommentsButton d={d} type="evidence" record={e} title={e.display_name} reload={reload} />
                {d.isAdmin && !e.deleted_at && <RemoveButton ws={ws} kind="evidence" row={e} name={e.display_name} reload={reload} />}
              </div></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty>No documents yet.</Empty>}
    </section>
  );
}

function safeHost(url: string) { try { return new URL(url).hostname; } catch { return ''; } }

// ---------------------------------------------------------------- discussion and activity

function Discussion({ d, reload }: { d: WorkspaceData; reload: () => Promise<void> }) {
  const rows = d.comments.filter((c) => c.record_type === 'workspace' && !c.deleted_at);
  return (
    <section className="section" aria-labelledby="dis-h">
      <h2 id="dis-h">Questions and comments</h2>
      <p>Use this for general questions and answers. To comment on a specific checklist item, action, finding or document, use the Comments button next to it.</p>
      <div className="panel"><Thread d={d} rows={rows} reload={reload} /><CommentForm ws={d.workspace.id} type="workspace" reload={reload} labelText="Ask a question or add a comment" /></div>
    </section>
  );
}

function ActivityList({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty>No activity yet.</Empty>;
  return <ul className="list">{rows.map((a) => <li key={a.id}><div className="row"><span>{a.description}</span><span className="when">{ago(a.created_at)}</span></div></li>)}</ul>;
}

function Activity({ d }: { d: WorkspaceData }) {
  return (
    <section className="section" aria-labelledby="hist-h">
      <h2 id="hist-h">Activity history</h2>
      <p>A record of changes in this workspace. It can't be edited or deleted.</p>
      <ActivityList rows={d.activity} />
    </section>
  );
}

export type { ReactNode };

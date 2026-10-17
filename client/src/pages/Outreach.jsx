import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fmt } from '../lib/format.js';
import { gmailLink } from '../lib/gmail.js';
import { Card, PageHead, Seg, Modal, useFetch, useAction, Loading } from '../components/ui.jsx';

export default function Outreach() {
  const [tab, setTab] = useState('queue');
  return (
    <div className="stack">
      <PageHead title="Outreach" sub="Approve emails, manage templates and multi-step sequences.">
        <Seg options={[['queue', 'Approval queue'], ['sequences', 'Sequences'], ['templates', 'Templates']]} value={tab} onChange={setTab} />
      </PageHead>
      {tab === 'queue' && <Queue />}
      {tab === 'sequences' && <Sequences />}
      {tab === 'templates' && <Templates />}
    </div>
  );
}

function Queue() {
  const [status, setStatus] = useState('draft');
  const { data, loading, reload } = useFetch(`/outbox?status=${status}`);
  const [busy, run] = useAction();
  const [edit, setEdit] = useState(null);
  const set = (id, s) => run(id, () => api.patch(`/outbox/${id}`, { status: s }).then(reload));
  return (
    <>
      <div className="row between">
        <Seg options={[['draft', 'Awaiting approval'], ['approved', 'Approved (sending)'], ['sent', 'Sent'], ['failed', 'Failed'], ['cancelled', 'Cancelled']]} value={status} onChange={setStatus} />
        <div className="row">
          {data && <span className="muted num" style={{ fontSize: 12 }}>{data.sentToday}/{data.dailyLimit} sent today</span>}
          {status === 'draft' && data?.items.length > 0 && <button className="btn" disabled={!!busy} onClick={() => run('all', () => api.post('/outbox/approve-all').then(reload), (r) => `${r.changed} approved`)}>Approve all</button>}
          <button className="btn primary" disabled={!!busy || !data?.smtp} title={data?.smtp ? '' : 'Connect SMTP in Settings'} onClick={() => run('flush', () => api.post('/outbox/flush').then((r) => { reload(); return r; }), (r) => r.skipped || (r.error ? `${r.sent} sent, ${r.failed} failed: ${r.error}` : `${r.sent} sent`))}>Send approved now</button>
        </div>
      </div>
      {data && !data.smtp && <div className="notice"><span>Email sending isn't connected yet. Add SMTP details (Google Workspace, Microsoft 365 or any provider) in <Link to="/settings">Settings</Link>. Until then, use "Open in Gmail" on each email, then "Mark sent".</span></div>}
      <Card>
        {loading && !data ? <Loading /> : data.items.length ? data.items.map((o) => (
          <div className="rec" key={o.id} style={{ gridTemplateColumns: '1fr auto' }}>
            <div style={{ minWidth: 0 }}>
              <div className="row"><Link to={`/leads/${o.lead_id}`}><strong>{o.first_name} {o.last_name}</strong></Link><span className="muted">{o.company} · {o.to_email}</span></div>
              <h3 style={{ marginTop: 4 }}>{o.subject}</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{o.body.length > 400 ? o.body.slice(0, 400) + '…' : o.body}</p>
              {o.error && <p className="bad">{o.error}</p>}
              <p className="muted" style={{ fontSize: 12 }}>{o.sent_at ? `Sent ${fmt.dateTime(o.sent_at)}` : `Created ${fmt.ago(o.created_at)}`}{o.enrollment_id ? ' · from sequence' : ''}</p>
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              {['draft', 'failed'].includes(o.status) && <>
                <button className="btn sm" onClick={() => setEdit({ ...o })}>Edit</button>
                <button className="btn sm primary" disabled={busy === o.id} onClick={() => set(o.id, 'approved')}>Approve</button>
              </>}
              {['draft', 'approved', 'failed'].includes(o.status) && <>
                <a className="btn sm" href={gmailLink({ to: o.to_email, subject: o.subject, body: o.body })} target="_blank" rel="noreferrer">Open in Gmail</a>
                <button className="btn sm" disabled={busy === `s${o.id}`} onClick={() => run(`s${o.id}`, () => api.post(`/outbox/${o.id}/sent`).then(reload), 'Marked as sent')}>Mark sent</button>
                <button className="btn sm ghost" onClick={() => set(o.id, 'cancelled')}>Cancel</button>
              </>}
            </div>
          </div>
        )) : <div className="empty">Nothing here.</div>}
      </Card>
      {edit && (
        <Modal title="Edit email" wide onClose={() => setEdit(null)} footer={<>
          <button className="btn" onClick={() => run('e', () => api.patch(`/outbox/${edit.id}`, { subject: edit.subject, body: edit.body }).then(() => { setEdit(null); reload(); }), 'Saved')}>Save</button>
          <button className="btn primary" onClick={() => run('e', () => api.patch(`/outbox/${edit.id}`, { subject: edit.subject, body: edit.body, status: 'approved' }).then(() => { setEdit(null); reload(); }), 'Approved')}>Save & approve</button>
        </>}>
          <input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
          <textarea className="input" rows={12} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
        </Modal>
      )}
    </>
  );
}

function Templates() {
  const { data, reload } = useFetch('/templates');
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  return (
    <>
      <div className="row between">
        <span className="secondary">Variables: {'{{first_name}} {{last_name}} {{company}} {{title}} {{industry}} {{website}} {{sender_name}} {{my_company}}'}</span>
        <button className="btn primary" onClick={() => setEdit({ name: '', subject: '', body: '' })}>New template</button>
      </div>
      <div className="grid cols-2">
        {data?.map((t) => (
          <Card key={t.id} title={t.name} sub={`Subject: ${t.subject}`} actions={<>
            <button className="btn sm" onClick={() => setEdit({ ...t })}>Edit</button>
            <button className="btn sm danger" onClick={() => confirm('Delete template?') && run('d', () => api.del(`/templates/${t.id}`).then(reload))}>Delete</button>
          </>}>
            <p className="secondary" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{t.body}</p>
          </Card>
        ))}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit template' : 'New template'} wide onClose={() => setEdit(null)} footer={
          <button className="btn primary" disabled={busy} onClick={() => run('s', () => api.post('/templates', edit).then(() => { setEdit(null); reload(); }), 'Template saved')}>Save</button>}>
          <label className="field">Name<input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field">Subject<input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></label>
          <label className="field">Body<textarea className="input" rows={12} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></label>
        </Modal>
      )}
    </>
  );
}

function Sequences() {
  const { data, reload } = useFetch('/sequences');
  const templates = useFetch('/templates');
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const tname = (id) => templates.data?.find((t) => t.id === id)?.name || `Template #${id}`;
  return (
    <>
      <div className="row between">
        <span className="secondary">Enrol leads from the Leads page. Each step lands in the approval queue on its day.</span>
        <button className="btn primary" onClick={() => setEdit({ name: '', steps: [{ day: 0, template_id: templates.data?.[0]?.id }] })}>New sequence</button>
      </div>
      {data?.map((s) => (
        <Card key={s.id} title={s.name} sub={`${s.active} active · ${s.total} enrolled in total`} actions={<>
          <button className="btn sm" onClick={() => setEdit({ ...s })}>Edit</button>
          <button className="btn sm danger" onClick={() => confirm('Delete sequence and its enrolments?') && run('d', () => api.del(`/sequences/${s.id}`).then(reload))}>Delete</button>
        </>}>
          <div className="row">{s.steps.map((st, i) => <span className="badge" key={i}>Day {st.day}: {tname(st.template_id)}</span>)}</div>
        </Card>
      ))}
      {edit && (
        <Modal title={edit.id ? 'Edit sequence' : 'New sequence'} wide onClose={() => setEdit(null)} footer={
          <button className="btn primary" disabled={busy} onClick={() => run('s', () => api.post('/sequences', edit).then(() => { setEdit(null); reload(); }), 'Sequence saved')}>Save</button>}>
          <label className="field">Name<input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          {edit.steps.map((st, i) => (
            <div className="row" key={i}>
              <label className="field" style={{ width: 90 }}>Day<input className="input" type="number" min="0" value={st.day} onChange={(e) => { const steps = [...edit.steps]; steps[i] = { ...st, day: e.target.value }; setEdit({ ...edit, steps }); }} /></label>
              <label className="field" style={{ flex: 1 }}>Template<select className="input" value={st.template_id} onChange={(e) => { const steps = [...edit.steps]; steps[i] = { ...st, template_id: Number(e.target.value) }; setEdit({ ...edit, steps }); }}>
                {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <button className="btn sm ghost" style={{ marginTop: 18 }} onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div><button className="btn sm" onClick={() => setEdit({ ...edit, steps: [...edit.steps, { day: (Number(edit.steps.at(-1)?.day) || 0) + 3, template_id: templates.data?.[0]?.id }] })}>Add step</button></div>
        </Modal>
      )}
    </>
  );
}

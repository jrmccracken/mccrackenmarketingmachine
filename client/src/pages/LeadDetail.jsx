import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fmt } from '../lib/format.js';
import { Card, PageHead, useFetch, useAction, Loading, ErrorBox, Modal, Seg } from '../components/ui.jsx';
import { LeadForm, STAGES, Enroll } from './Leads.jsx';

const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export default function LeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = useFetch(`/leads/${id}`);
  const [busy, run] = useAction();
  const [edit, setEdit] = useState(null);
  const [enroll, setEnroll] = useState(false);
  const [mail, setMail] = useState({ subject: '', body: '', goal: 'book an intro call' });
  const [log, setLog] = useState({ type: 'call', direction: 'out', body: '' });

  useEffect(() => { setMail({ subject: '', body: '', goal: 'book an intro call' }); }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  const { lead, activities, outbox, enrollments } = data;
  const patch = (body, msg) => run('p', () => api.patch(`/leads/${id}`, body).then(reload), msg);

  return (
    <div className="stack">
      <PageHead title={`${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.company} sub={[lead.title, lead.company].filter(Boolean).join(' · ')}>
        <Link className="btn" to="/leads">All leads</Link>
        <button className="btn" onClick={() => setEdit({ ...lead })}>Edit</button>
        <button className="btn danger" onClick={() => confirm('Delete this lead and its history?') && run('d', () => api.del(`/leads/${id}`).then(() => nav('/leads')))}>Delete</button>
      </PageHead>

      <div className="grid cols-3" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card title="Details">
            <div className="stack" style={{ gap: 10 }}>
              <label className="field">Stage
                <select className="input" value={lead.stage} onChange={(e) => patch({ stage: e.target.value }, `Moved to ${e.target.value}`)}>
                  {STAGES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="field">Next follow-up
                <input className="input" type="datetime-local" value={toLocal(lead.next_follow_up_at)}
                  onChange={(e) => patch({ next_follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </label>
              <div className="row">
                {[1, 3, 7, 14].map((d) => <button key={d} className="btn sm" onClick={() => patch({ next_follow_up_at: new Date(Date.now() + d * 864e5).toISOString() }, `Follow-up in ${d} days`)}>+{d}d</button>)}
              </div>
              <Info k="Email" v={lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>} />
              <Info k="Phone" v={lead.phone} />
              <Info k="Website" v={lead.website && <a href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a>} />
              <Info k="LinkedIn" v={lead.linkedin && <a href={lead.linkedin} target="_blank" rel="noreferrer">Profile</a>} />
              <Info k="Industry" v={lead.industry} />
              <Info k="Deal value" v={fmt.money(lead.value)} />
              <Info k="Score" v={`${lead.score} / 100`} />
              <Info k="Source" v={lead.source} />
              <Info k="Tags" v={lead.tags} />
              <Info k="Last contacted" v={fmt.ago(lead.last_contacted_at)} />
              <label className="row secondary" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={!!lead.unsubscribed} onChange={(e) => patch({ unsubscribed: e.target.checked })} /> Do not email (unsubscribed)
              </label>
            </div>
          </Card>
          <Card title="Notes">
            <NotesEditor key={lead.id} value={lead.notes || ''} onSave={(notes) => patch({ notes }, 'Notes saved')} />
          </Card>
          <Card title="Sequences" actions={<button className="btn sm" onClick={() => setEnroll(true)}>Add to sequence</button>}>
            {enrollments.length ? enrollments.map((e) => (
              <div className="list-item" key={e.id}><span>{e.name}</span><span className="badge">{e.status} · step {Math.min(e.step + 1, 99)}</span></div>
            )) : <div className="muted">Not in a sequence</div>}
          </Card>
        </div>

        <div className="stack span-2">
          {lead.pipeline && <PipelinePanel lead={lead} onUse={(m) => setMail({ ...mail, ...m })} />}

          <Card title="Write an email" sub={lead.email ? `To ${lead.email}. Variables like {{first_name}} and {{company}} are filled in.` : 'Add an email address to this lead to send.'}
            actions={<>
              <input className="input" style={{ width: 200 }} value={mail.goal} onChange={(e) => setMail({ ...mail, goal: e.target.value })} aria-label="Goal" placeholder="Goal" />
              <button className="btn sm" disabled={busy === 'draft'} onClick={() => run('draft', async () => { const d = await api.post(`/leads/${id}/draft`, { goal: mail.goal }); setMail({ ...mail, ...d }); })}>
                {busy === 'draft' ? 'Drafting…' : 'Draft with AI'}
              </button>
            </>}>
            <div className="stack" style={{ gap: 8 }}>
              <input className="input" placeholder="Subject" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
              <textarea className="input" rows={8} placeholder="Message" value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" disabled={!lead.email || !mail.subject || !mail.body || busy} onClick={() => run('q', () => api.post(`/leads/${id}/email`, mail).then(() => { setMail({ ...mail, subject: '', body: '' }); reload(); }), 'Saved to the approval queue')}>Save to approval queue</button>
                <button className="btn primary" disabled={!lead.email || !mail.subject || !mail.body || busy} onClick={() => run('s', () => api.post(`/leads/${id}/email`, { ...mail, approve: true }).then((r) => { setMail({ ...mail, subject: '', body: '' }); reload(); return r; }),
                  (r) => (r.flushed?.sent ? 'Sent' : r.flushed?.skipped ? `Approved but not sent: ${r.flushed.skipped}` : 'Approved and queued (daily limit reached)'))}>Send now</button>
              </div>
            </div>
          </Card>

          <Card title="Log activity" sub="Logging an inbound reply moves the lead to 'replied' and stops sequences.">
            <div className="row">
              <select className="input" style={{ width: 130 }} value={log.type} onChange={(e) => setLog({ ...log, type: e.target.value })}>
                <option value="call">Call</option><option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="meeting">Meeting</option><option value="note">Note</option>
              </select>
              <select className="input" style={{ width: 130 }} value={log.direction} onChange={(e) => setLog({ ...log, direction: e.target.value })}>
                <option value="out">Outbound</option><option value="in">Inbound / reply</option>
              </select>
              <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="What happened?" value={log.body} onChange={(e) => setLog({ ...log, body: e.target.value })} />
              <button className="btn primary" disabled={!log.body || busy} onClick={() => run('l', () => api.post(`/leads/${id}/activities`, { ...log, subject: `${log.type} (${log.direction === 'in' ? 'inbound' : 'outbound'})` }).then(() => { setLog({ ...log, body: '' }); reload(); }), 'Logged')}>Log</button>
            </div>
          </Card>

          {outbox.length > 0 && (
            <Card title="Emails" actions={<Link className="btn sm" to="/outreach">Approval queue</Link>}>
              {outbox.map((o) => (
                <div className="list-item" key={o.id}>
                  <div><strong>{o.subject}</strong><div className="muted" style={{ fontSize: 12 }}>{o.status === 'sent' ? `Sent ${fmt.dateTime(o.sent_at)}` : `Created ${fmt.ago(o.created_at)}`}{o.error ? ` · ${o.error}` : ''}</div></div>
                  <span className="badge">{o.status}</span>
                </div>
              ))}
            </Card>
          )}

          <Card title="Timeline">
            <div className="timeline">
              {activities.map((a) => (
                <div className="ev" key={a.id}>
                  <div className="row"><strong style={{ textTransform: 'capitalize' }}>{a.subject || a.type}</strong><span className="muted" style={{ fontSize: 12 }}>{fmt.dateTime(a.created_at)}</span></div>
                  {a.body && <pre>{a.body}</pre>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {edit && (
        <Modal title="Edit lead" wide onClose={() => setEdit(null)} footer={<button className="btn primary" onClick={() => run('e', () => api.patch(`/leads/${id}`, edit).then(() => { setEdit(null); reload(); }), 'Saved')}>Save</button>}>
          <LeadForm value={edit} onChange={setEdit} />
        </Modal>
      )}
      {enroll && <Enroll ids={[lead.id]} onClose={() => setEnroll(false)} onDone={() => { setEnroll(false); reload(); }} />}
    </div>
  );
}

function Info({ k, v }) {
  return <div className="row between" style={{ fontSize: 13 }}><span className="muted">{k}</span><span style={{ textAlign: 'right', wordBreak: 'break-all' }}>{v || '–'}</span></div>;
}

function NotesEditor({ value, onSave }) {
  const [v, setV] = useState(value);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <textarea className="input" rows={5} value={v} onChange={(e) => setV(e.target.value)} />
      {v !== value && <div><button className="btn sm primary" onClick={() => onSave(v)}>Save notes</button></div>}
    </div>
  );
}

/** The research and drafts the Monday lead engine wrote for this lead. Emails go out from Gmail, not from here. */
function PipelinePanel({ lead, onUse }) {
  const p = JSON.parse(lead.pipeline);
  const [tab, setTab] = useState('first');
  const [copied, setCopied] = useState('');
  const subject = tab === 'first' ? p.subject : `Re: ${p.subject}`;
  const body = tab === 'first' ? p.body : p.followup1;
  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(p.email || '')}&su=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
  const copy = async (what, text) => { try { await navigator.clipboard.writeText(text || ''); setCopied(what); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ } };
  return (
    <Card title={<span className="row">From the Lead pipeline {p.fit && <span className="badge">Fit {p.fit}</span>} <span className="badge">{p.status}</span></span>}
      sub={p.trigger} actions={<a className="btn sm" href="https://claude.ai/artifact/KkZdbgtE5g3hZtga5DPpjp" target="_blank" rel="noreferrer">Open pipeline ↗</a>}>
      <div className="stack" style={{ gap: 10 }}>
        {p.angle && <p className="secondary" style={{ margin: 0 }}><strong>Angle:</strong> {p.angle}</p>}
        <div className="row secondary" style={{ fontSize: 13 }}>
          {p.source && <a href={p.source} target="_blank" rel="noreferrer">Read the story ↗</a>}
          {p.location && <span>{p.location}</span>}
          {p.emailNote && <span className="muted">{p.emailNote}</span>}
        </div>
        {p.body && <>
          <Seg options={[['first', 'First email'], ['fu', 'Follow-up']]} value={tab} onChange={setTab} />
          <div><strong>Subject:</strong> {subject}</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, padding: 12, background: 'var(--band)', border: '1px solid var(--border)' }}>{body}</pre>
          <div className="row">
            <a className="btn sm primary" href={gmail} target="_blank" rel="noreferrer">Open in Gmail</a>
            <button className="btn sm" onClick={() => copy('s', subject)}>{copied === 's' ? 'Copied' : 'Copy subject'}</button>
            <button className="btn sm" onClick={() => copy('b', body)}>{copied === 'b' ? 'Copied' : 'Copy email'}</button>
            <button className="btn sm ghost" onClick={() => onUse({ subject, body })}>Edit below</button>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>The Monday run already saved this as a Gmail draft. Send it from Gmail, then mark it Sent in the pipeline.</p>
        </>}
        {p.notes && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}><strong>Pipeline notes:</strong> {p.notes}</p>}
      </div>
    </Card>
  );
}

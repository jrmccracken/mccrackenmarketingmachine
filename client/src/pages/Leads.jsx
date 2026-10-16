import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fmt } from '../lib/format.js';
import { Card, PageHead, Seg, Modal, useFetch, useAction, Loading, ErrorBox, DataTable } from '../components/ui.jsx';

export const STAGES = ['new', 'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost'];

export default function Leads() {
  const [params, setParams] = useSearchParams();
  const due = params.get('due') ? 1 : '';
  const [view, setView] = useState('table');
  const [stage, setStage] = useState('');
  const [q, setQ] = useState(params.get('q') || '');
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal] = useState(null);
  const { data, error, loading, reload } = useFetch(`/leads?stage=${stage}&q=${encodeURIComponent(q)}&due=${due}`);
  const nav = useNavigate();
  const [busy, run] = useAction();

  const toggle = (id) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };
  const leads = data || [];
  return (
    <div className="stack">
      <PageHead title="Leads" sub="Every prospect in one place. Scored on fit and engagement.">
        <button className="btn" onClick={() => setModal('import')}>Import CSV</button>
        <button className="btn primary" onClick={() => setModal('add')}>Add lead</button>
      </PageHead>
      <div className="row between">
        <div className="row">
          <Seg options={[['table', 'Table'], ['board', 'Pipeline board']]} value={view} onChange={setView} />
          <select className="input" style={{ width: 150 }} value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
            <option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="row secondary" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={!!due} onChange={(e) => setParams(e.target.checked ? { due: '1' } : {})} /> Follow-up due
          </label>
        </div>
        <div className="row">
          {selected.size > 0 && <button className="btn" onClick={() => setModal('enroll')}>Add {selected.size} to sequence</button>}
          <input className="input" style={{ width: 240 }} placeholder="Search name, company, email, tag" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : view === 'table' ? (
        <Card>
          <div className="only-mobile">
            {leads.length ? leads.slice(0, 200).map((l) => (
              <Link key={l.id} to={`/leads/${l.id}`} className="lead-card">
                <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{[l.first_name, l.last_name].filter(Boolean).join(' ') || l.company}</strong>
                    <div className="muted" style={{ fontSize: 13 }}>{[l.title, l.company].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                    {l.fit && <span className="badge">{l.fit}</span>}
                    <span className="badge">{l.pipeline_status || l.stage}</span>
                  </div>
                </div>
                {l.next_follow_up_at && <div style={{ fontSize: 12, marginTop: 4 }} className={new Date(l.next_follow_up_at) < new Date() ? 'bad' : 'muted'}>Follow-up {fmt.ago(l.next_follow_up_at)}</div>}
              </Link>
            )) : <div className="empty">No leads yet. Add one or import a CSV.</div>}
          </div>
          <div className="only-desktop">
          <DataTable rows={leads} onRow={(r) => nav(`/leads/${r.id}`)} limit={200} empty="No leads yet. Add one or import a CSV." cols={[
            { key: 'sel', label: '', render: (r) => <input type="checkbox" aria-label="Select" checked={selected.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} /> },
            { key: 'last_name', label: 'Name', render: (r) => <><strong>{r.first_name} {r.last_name}</strong><div className="sub">{r.title}</div></> },
            { key: 'company', label: 'Company', render: (r) => <>{r.company}<div className="sub">{r.industry}</div></> },
            { key: 'fit', label: 'Fit', render: (r) => (r.fit ? <span className="badge">{r.fit}</span> : <span className="muted">–</span>) },
            { key: 'stage', label: 'Stage', render: (r) => <span className="badge">{r.pipeline_status || r.stage}</span> },
            { key: 'score', label: 'Score', r: true },
            { key: 'value', label: 'Value', r: true, f: fmt.money },
            { key: 'last_contacted_at', label: 'Last touch', f: fmt.ago },
            { key: 'next_follow_up_at', label: 'Follow-up', render: (r) => r.next_follow_up_at ? <span className={new Date(r.next_follow_up_at) < new Date() ? 'bad' : ''}>{fmt.ago(r.next_follow_up_at)}</span> : <span className="muted">–</span> },
          ]} />
          </div>
        </Card>
      ) : (
        <div className="kanban">
          {STAGES.map((s) => {
            const col = leads.filter((l) => l.stage === s);
            return (
              <div className="kanban-col" key={s}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { const id = e.dataTransfer.getData('id'); run('mv', () => api.patch(`/leads/${id}`, { stage: s }).then(reload)); }}>
                <h3>{s} <span className="muted num">{col.length}</span></h3>
                {col.map((l) => (
                  <div className="kanban-card" key={l.id} draggable onDragStart={(e) => e.dataTransfer.setData('id', l.id)} onClick={() => nav(`/leads/${l.id}`)}>
                    <strong>{l.first_name} {l.last_name}</strong>
                    <div className="muted">{l.company}</div>
                    <div className="row between" style={{ marginTop: 4, fontSize: 12 }}><span className="num">{fmt.money(l.value)}</span><span className="muted">score {l.score}</span></div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {modal === 'add' && <AddLead onClose={() => setModal(null)} onDone={(id) => nav(`/leads/${id}`)} />}
      {modal === 'import' && <ImportLeads onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'enroll' && <Enroll ids={[...selected]} onClose={() => setModal(null)} onDone={() => { setModal(null); setSelected(new Set()); }} />}
    </div>
  );
}

export function LeadForm({ value, onChange }) {
  const up = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const F = (k, label, type = 'text') => <label className="field">{label}<input className="input" type={type} value={value[k] ?? ''} onChange={up(k)} /></label>;
  return (
    <div className="grid cols-2">
      {F('first_name', 'First name')}{F('last_name', 'Last name')}
      {F('email', 'Email', 'email')}{F('phone', 'Phone')}
      {F('company', 'Company')}{F('title', 'Job title')}
      {F('website', 'Website')}{F('linkedin', 'LinkedIn URL')}
      {F('industry', 'Industry')}{F('value', 'Deal value (£)', 'number')}
      {F('source', 'Source')}{F('tags', 'Tags (comma separated)')}
    </div>
  );
}

function AddLead({ onClose, onDone }) {
  const [f, setF] = useState({ stage: 'new', source: 'Manual' });
  const [busy, run] = useAction();
  return (
    <Modal title="Add lead" onClose={onClose} wide footer={<button className="btn primary" disabled={busy} onClick={() => run('s', async () => onDone((await api.post('/leads', f)).id), 'Lead added')}>Save lead</button>}>
      <LeadForm value={f} onChange={setF} />
      <label className="field">Notes<textarea className="input" value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
    </Modal>
  );
}

function ImportLeads({ onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [tags, setTags] = useState('');
  const [busy, run] = useAction();
  const onFile = (e) => { const file = e.target.files[0]; if (file) file.text().then(setCsv); };
  return (
    <Modal title="Import leads from CSV" onClose={onClose} wide footer={
      <button className="btn primary" disabled={!csv || busy} onClick={() => run('i', () => api.post('/leads/import', { csv, tags }).then((r) => { onDone(); return r; }), (r) => `Imported ${r.created} leads, skipped ${r.skipped} (duplicates or missing email/company)`)}>Import</button>}>
      <p className="secondary" style={{ margin: 0 }}>
        Columns are matched by name: first_name, last_name (or name), email, company, title, website, linkedin, phone, industry, value, tags, notes.
        Exports from Apollo, LinkedIn Sales Navigator tools, HubSpot and Instantly work as-is. Existing emails are skipped.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} />
      <textarea className="input" rows={8} placeholder="…or paste CSV here" value={csv} onChange={(e) => setCsv(e.target.value)} />
      <label className="field">Tag every imported lead with<input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. saas-q4" /></label>
    </Modal>
  );
}

export function Enroll({ ids, onClose, onDone }) {
  const { data } = useFetch('/sequences');
  const [seq, setSeq] = useState('');
  const [busy, run] = useAction();
  return (
    <Modal title={`Add ${ids.length} lead${ids.length > 1 ? 's' : ''} to a sequence`} onClose={onClose} footer={
      <button className="btn primary" disabled={!seq || busy} onClick={() => run('e', () => api.post(`/sequences/${seq}/enroll`, { lead_ids: ids }).then((r) => { onDone(); return r; }),
        (r) => `Enrolled ${r.enrolled}. ${r.queued} first emails are in the approval queue.`)}>Start sequence</button>}>
      <select className="input" value={seq} onChange={(e) => setSeq(e.target.value)}>
        <option value="">Choose a sequence…</option>
        {data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.steps.length} steps)</option>)}
      </select>
      <p className="muted" style={{ margin: 0 }}>Each step creates an email in <Link to="/outreach">Outreach → Approval queue</Link>. Sequences stop automatically when a lead replies or moves to meeting, won or lost.</p>
    </Modal>
  );
}

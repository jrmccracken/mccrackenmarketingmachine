import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fmt } from '../lib/format.js';
import { Card, PageHead, Seg, Modal, useFetch, useAction, Loading, ErrorBox } from '../components/ui.jsx';

export default function Radar() {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { data: res, error, loading, reload } = useFetch(`/opportunities?kind=${kind}&status=${status}&q=${encodeURIComponent(q)}`);
  const data = res?.items;
  const scan = res?.lastScan;
  const [busy, run] = useAction();
  const [draft, setDraft] = useState(null);
  const [toLead, setToLead] = useState(null);
  const [feeds, setFeeds] = useState(false);

  const set = (id, s) => run(id, () => api.patch(`/opportunities/${id}`, { status: s }).then(reload));
  return (
    <div className="stack">
      <PageHead title="Market radar" sub="News, journalist requests and buying signals that match your keywords. Scanned every 2 hours.">
        <button className="btn" onClick={() => setFeeds(true)}>Sources & keywords</button>
        <button className="btn primary" disabled={busy === 'scan'} onClick={() => run('scan', () => api.post('/opportunities/run').then((r) => { reload(); return r; }),
          (r) => `${r.added} new opportunities from ${r.found} articles${r.failed ? ` · ${r.failed} of ${r.sources} sources failed` : ''}`)}>{busy === 'scan' ? 'Scanning…' : 'Scan now'}</button>
      </PageHead>
      {res && (
        <div className="notice"><span>
          {scan ? <>Last scan {fmt.ago(scan.at)}: {scan.added} new from {scan.found} articles across {scan.sources} searches.{scan.failed ? ` ${scan.failed} searches failed (${scan.errors[0]}).` : ''}{scan.added === 0 && scan.found > 0 ? ' Nothing new matched your keywords, so broaden them in Settings → Market radar.' : ''}</>
            : 'No scan has run yet on this copy. Press "Scan now".'}
          {res.demo && ' The items marked "Demo data" are examples and disappear after the first successful scan.'}
        </span></div>
      )}
      <div className="row between">
        <div className="row">
          <Seg options={[['', 'All'], ['pr', 'PR'], ['outbound', 'Outbound']]} value={kind} onChange={setKind} />
          <Seg options={[['', 'Active'], ['saved', 'Saved'], ['actioned', 'Actioned'], ['dismissed', 'Dismissed']]} value={status} onChange={setStatus} />
        </div>
        <input className="input" style={{ width: 240 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <ErrorBox error={error} />}
      <Card>
        {loading && !data ? <Loading /> : data?.length ? data.map((o) => (
          <div className="rec" key={o.id}>
            <div style={{ textAlign: 'center', minWidth: 44 }}>
              <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{Math.round(o.score)}</div>
              <div className="muted" style={{ fontSize: 11 }}>score</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ marginBottom: 2 }}>
                <span className="badge">{o.kind === 'pr' ? 'PR' : 'Outbound'}</span>
                <span className="muted" style={{ fontSize: 12 }}>{o.source} · {fmt.ago(o.published_at || o.found_at)}</span>
                {o.status !== 'new' && <span className="badge">{o.status}</span>}
              </div>
              <h3><a href={o.url} target="_blank" rel="noreferrer">{o.title}</a></h3>
              {o.summary && o.summary !== o.title && <p>{o.summary.slice(0, 280)}</p>}
              {o.keywords && <p className="muted" style={{ fontSize: 12 }}>Matched: {o.keywords}</p>}
            </div>
            <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'flex-end', maxWidth: 220 }}>
              <button className="btn sm primary" disabled={busy === `d${o.id}`} onClick={() => run(`d${o.id}`, async () => setDraft({ opp: o, text: (await api.post(`/opportunities/${o.id}/draft`)).draft }))}>
                {busy === `d${o.id}` ? 'Drafting…' : o.kind === 'pr' ? 'Draft pitch' : 'Draft email'}
              </button>
              {o.kind === 'outbound' && <button className="btn sm" onClick={() => setToLead(o)}>Add lead</button>}
              {o.status !== 'saved' && <button className="btn sm" onClick={() => set(o.id, 'saved')}>Save</button>}
              {o.status !== 'dismissed' && <button className="btn sm ghost" onClick={() => set(o.id, 'dismissed')}>Dismiss</button>}
            </div>
          </div>
        )) : <div className="empty">No opportunities. Try "Scan now" or broaden your keywords.</div>}
      </Card>
      {draft && <DraftModal draft={draft} onClose={() => setDraft(null)} onActioned={() => { set(draft.opp.id, 'actioned'); setDraft(null); }} />}
      {toLead && <LeadModal opp={toLead} onClose={() => setToLead(null)} onDone={() => { setToLead(null); reload(); }} />}
      {feeds && <FeedsModal onClose={() => setFeeds(false)} />}
    </div>
  );
}

function DraftModal({ draft, onClose, onActioned }) {
  const [text, setText] = useState(draft.text);
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={draft.opp.kind === 'pr' ? 'Pitch draft' : 'Outbound draft'} onClose={onClose} wide footer={<>
      <button className="btn" onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button>
      <button className="btn primary" onClick={onActioned}>Mark as actioned</button>
    </>}>
      <p className="secondary" style={{ margin: 0 }}><a href={draft.opp.url} target="_blank" rel="noreferrer">{draft.opp.title}</a></p>
      <textarea className="input" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}

function LeadModal({ opp, onClose, onDone }) {
  const nav = useNavigate();
  const guess = opp.title.split(/ (raises|appoints|announces|launches|expands|hires|acquires|opens|secures)/i)[0].slice(0, 80);
  const [f, setF] = useState({ company: guess, first_name: '', last_name: '', email: '', title: '', website: '', notes: '' });
  const [busy, run] = useAction();
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Add as lead" onClose={onClose} footer={
      <button className="btn primary" disabled={busy} onClick={() => run('s', async () => { const r = await api.post(`/opportunities/${opp.id}/lead`, f); onDone(); nav(`/leads/${r.id}`); }, 'Lead added')}>Create lead</button>}>
      <p className="muted" style={{ margin: 0 }}>{opp.title}</p>
      <div className="grid cols-2">
        <label className="field">Company<input className="input" value={f.company} onChange={up('company')} /></label>
        <label className="field">Website<input className="input" value={f.website} onChange={up('website')} /></label>
        <label className="field">First name<input className="input" value={f.first_name} onChange={up('first_name')} /></label>
        <label className="field">Last name<input className="input" value={f.last_name} onChange={up('last_name')} /></label>
        <label className="field">Email<input className="input" value={f.email} onChange={up('email')} /></label>
        <label className="field">Job title<input className="input" value={f.title} onChange={up('title')} /></label>
      </div>
      <label className="field">Notes<textarea className="input" value={f.notes} onChange={up('notes')} /></label>
    </Modal>
  );
}

function FeedsModal({ onClose }) {
  const { data, reload } = useFetch('/feeds');
  const [f, setF] = useState({ name: '', url: '', kind: 'auto' });
  const [busy, run] = useAction();
  return (
    <Modal title="Radar sources" onClose={onClose} wide>
      <p className="secondary" style={{ margin: 0 }}>
        The radar searches Google News for every keyword in <strong>Settings → Market radar</strong>. Add any other RSS or Atom feed here: industry publications,
        journalist-request services that offer RSS, Google Alerts (choose "Deliver to: RSS feed"), or a Google News search such as <code style={{ wordBreak: 'break-all' }}>{data?.example}</code>.
      </p>
      {data?.feeds?.map((feed) => (
        <div className="list-item" key={feed.id}>
          <div style={{ minWidth: 0 }}><strong>{feed.name}</strong> <span className="badge">{feed.kind}</span><div className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>{feed.url}</div></div>
          <button className="btn sm danger" onClick={() => run('x', () => api.del(`/feeds/${feed.id}`).then(reload))}>Remove</button>
        </div>
      ))}
      <div className="grid cols-3">
        <label className="field">Name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field" style={{ gridColumn: 'span 1' }}>Feed URL<input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
        <label className="field">Type<select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="auto">Auto-detect</option><option value="pr">PR</option><option value="outbound">Outbound</option></select></label>
      </div>
      <div><button className="btn primary" disabled={busy} onClick={() => run('a', () => api.post('/feeds', f).then(() => { setF({ name: '', url: '', kind: 'auto' }); reload(); }), 'Source added')}>Add source</button></div>
    </Modal>
  );
}

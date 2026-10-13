import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fmt } from '../lib/format.js';
import { Card, PageHead, Seg, useFetch, useAction, Loading, ErrorBox } from '../components/ui.jsx';

const RANGES = [[7, '7d'], [30, '30d'], [90, '90d'], [365, '12m']];
const BAND_STATUS = { High: 'high', Medium: 'medium', Low: 'low' };
const dur = (s) => (s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`);
const q = encodeURIComponent;

export default function Visitors() {
  const [days, setDays] = useState(90);
  const [tab, setTab] = useState('orgs');
  const [bandF, setBandF] = useState('all');
  const [search, setSearch] = useState('');
  const { data, error, loading, reload } = useFetch(`/visitors?days=${days}`);
  const [busy, run] = useAction();
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;

  const needle = search.toLowerCase();
  const orgs = data.orgs.filter((o) => (bandF === 'all' || o.band === bandF)
    && (!needle || `${o.name} ${o.city} ${o.top.map((p) => p.path).join(' ')}`.toLowerCase().includes(needle)));
  const people = data.people.filter((p) => !needle || `${p.name} ${p.email} ${p.company} ${p.org}`.toLowerCase().includes(needle));
  const addLead = (o) => run(o.name, async () => {
    const r = await api.post('/visitors/lead', { name: o.name, city: o.city, pages: o.top, contact: o.contacts?.[0] });
    reload();
    nav(`/leads/${r.id}`);
  }, (r) => 'Lead added');

  return (
    <div className="stack">
      <PageHead title="Company visitors" sub="Organisations reading your website, ranked by buying intent. From the Website Visitor Log (visitors who accepted cookies).">
        <Seg options={RANGES} value={days} onChange={setDays} />
        <button className="btn" disabled={!!busy} onClick={() => run('sync', () => api.post('/integrations/visitors/sync').then((r) => { reload(); return r; }),
          (r) => (r.status === 'ok' ? 'Visitor log refreshed' : `${r.status}: ${r.message}`))}>{busy === 'sync' ? 'Refreshing…' : 'Refresh'}</button>
      </PageHead>

      {data.totalEvents === 0 ? <SetupCard /> : <>
        <div className="grid cols-4">
          {[['Organisations identified', data.orgs.length], ['High intent', data.high], ['Known people', data.people.length], ['Visits', data.visits]].map(([l, v]) => (
            <div className="card stat" key={l}><span className="stat-label">{l}</span><span className="stat-value num">{fmt.n(v)}</span></div>
          ))}
        </div>
        <div className="row between">
          <div className="row">
            <Seg options={[['orgs', 'Organisations'], ['people', 'Known people']]} value={tab} onChange={setTab} />
            {tab === 'orgs' && <Seg options={[['all', 'All'], ['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']]} value={bandF} onChange={setBandF} />}
          </div>
          <input className="input" style={{ width: 260 }} placeholder="Search organisation, person or page" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {tab === 'orgs' ? (
          <Card>
            {orgs.length ? orgs.map((o) => (
              <div className="rec" key={o.name} style={{ gridTemplateColumns: 'auto 1fr auto' }}>
                <div style={{ textAlign: 'center', minWidth: 54 }}>
                  <span className={`badge ${BAND_STATUS[o.band]}`}><span className="dot" />{o.band}</span>
                  <div className="muted num" style={{ fontSize: 11, marginTop: 4 }}>score {o.score}</div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3>{o.name}</h3>
                  <p className="muted" style={{ fontSize: 13 }}>{[o.city, o.country].filter(Boolean).join(', ') || 'Location unknown'} · {o.visits} visit{o.visits === 1 ? '' : 's'} · {o.people} {o.people === 1 ? 'person' : 'people'} · {o.pages} pages · last seen {fmt.ago(o.last)}</p>
                  <div className="row" style={{ marginTop: 6 }}>
                    {o.top.map((p) => <span key={p.path} className="badge" style={o.hot || p.hot ? { background: 'var(--accent-soft)', color: 'var(--text-primary)' } : undefined}
                      title={p.title}>{p.path} ×{p.views}{p.secs ? ` · ${dur(p.secs)}` : ''}</span>)}
                  </div>
                  {o.contacts.length > 0 && <p style={{ fontSize: 13 }}><strong>Known contact:</strong> {o.contacts.map((c) => `${c.name || ''} ${c.email}`.trim()).join(', ')}</p>}
                  <div className="row" style={{ marginTop: 6, fontSize: 13 }}>
                    <a href={`https://find-and-update.company-information.service.gov.uk/search/companies?q=${q(o.name)}`} target="_blank" rel="noreferrer">Companies House ↗</a>
                    <a href={`https://www.linkedin.com/search/results/companies/?keywords=${q(o.name)}`} target="_blank" rel="noreferrer">LinkedIn page ↗</a>
                    <a href={`https://www.linkedin.com/search/results/people/?keywords=${q(`${o.name} managing director`)}`} target="_blank" rel="noreferrer">Find decision makers ↗</a>
                  </div>
                  <details style={{ marginTop: 6 }}>
                    <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Recent activity</summary>
                    <div style={{ fontSize: 12.5 }}>{o.recent.map((p, i) => <div key={i} className="row between" style={{ borderBottom: '1px solid var(--grid)', padding: '3px 0' }}>
                      <span>{p.path}{p.secs ? ` · ${dur(p.secs)}` : ''}</span><span className="muted">{fmt.dateTime(new Date(p.t).toISOString())}</span></div>)}</div>
                  </details>
                </div>
                <div>
                  {o.leadId ? <Link className="btn sm" to={`/leads/${o.leadId}`}>Open lead</Link>
                    : <button className="btn sm primary" disabled={busy === o.name} onClick={() => addLead(o)}>Add as lead</button>}
                </div>
              </div>
            )) : <div className="empty">No identified organisations in this period with these filters.</div>}
            {data.unresolved > 0 && <p className="muted" style={{ fontSize: 12.5 }}>{data.unresolved} other visitor{data.unresolved === 1 ? '' : 's'} came from home or mobile broadband, a VPN or a cloud network, so their organisation can't be identified.</p>}
          </Card>
        ) : (
          <Card>
            {people.length ? people.map((p) => (
              <div className="rec" key={p.email} style={{ gridTemplateColumns: 'auto 1fr auto' }}>
                <span className={`badge ${BAND_STATUS[p.band]}`}><span className="dot" />{p.band}</span>
                <div>
                  <h3>{p.name || p.email}</h3>
                  <p className="muted" style={{ fontSize: 13 }}>{[p.company || p.org, p.form].filter(Boolean).join(' · ')} · {p.visits} visits · {p.pages} pages · last seen {fmt.ago(p.last)}</p>
                  <p style={{ fontSize: 13 }}>{p.email}{p.phone ? ` · ${p.phone}` : ''}</p>
                </div>
                {p.leadId ? <Link className="btn sm" to={`/leads/${p.leadId}`}>Open lead</Link> : <span className="muted" style={{ fontSize: 12 }}>Not a lead yet</span>}
              </div>
            )) : <div className="empty">Nobody has filled in a form in this period.</div>}
          </Card>
        )}
      </>}
    </div>
  );
}

function SetupCard() {
  return (
    <Card title="No visits logged yet" sub="Your Website Visitor Log sheet is empty, so the tracking snippet isn't sending anything from the website yet.">
      <ol className="secondary" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
        <li><strong>Connect the sheet:</strong> share the <a href="https://docs.google.com/spreadsheets/d/1sVqnrRqbtd0M8IcuYYOlF87zXYC_bPaNSDgpxi6doto/edit" target="_blank" rel="noreferrer">Website Visitor Log</a> with your service account email (Viewer), and enable the <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noreferrer">Google Sheets API</a> in your Google Cloud project.</li>
        <li><strong>Switch on the logging:</strong> follow steps 2 to 4 on the Setup tab of your <a href="https://claude.ai/artifact/WSrA9yDLyYMSLeTH6uBbch" target="_blank" rel="noreferrer">Visitor Insights</a> page: deploy the Apps Script, then add the snippet to every page of your site and republish it on Netlify.</li>
        <li>Visit <code>mccrackenmarketing.co.uk/?mm_ignore=1</code> once on your own devices so your visits aren't counted, then click <strong>Refresh</strong> here.</li>
      </ol>
    </Card>
  );
}

import { useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/format.js';
import { Card, PageHead, useFetch, useAction, Loading } from '../components/ui.jsx';

const IMPORT_SOURCES = [['openai_ads', 'ChatGPT Ads'], ['google_ads', 'Google Ads'], ['linkedin', 'LinkedIn'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['email', 'Outbound email'], ['ga4', 'Website (GA4)'], ['gsc', 'Search Console']];
const IMPORT_COLS = {
  openai_ads: 'date, campaign, spend, impressions, clicks, conversions, conversion_value', google_ads: 'date, campaign, spend, impressions, clicks, conversions, conversion_value',
  linkedin: 'date, impressions, engagements, clicks, followers_gained', facebook: 'date, impressions, engagements, clicks, followers_gained', instagram: 'date, impressions, engagements, clicks, followers_gained',
  email: 'date, sent, opens, replies, clicks, bounces, opportunities', ga4: 'date, sessions, users, new_users, engaged_sessions, conversions', gsc: 'date, clicks, impressions, position_weighted',
};

export default function Integrations() {
  const { data, reload } = useFetch('/integrations');
  const settings = useFetch('/settings');
  const [busy, run] = useAction();
  return (
    <div className="stack">
      <PageHead title="Integrations" sub="Connect each channel. Data syncs every 6 hours (last 30 days), and recommendations refresh after each sync.">
        <button className="btn primary" disabled={!!busy} onClick={() => run('all', () => api.post('/integrations/sync-all').then((r) => { reload(); return r; }),
          (r) => r.map((x) => `${x.id}: ${x.status}`).join(' · '))}>{busy === 'all' ? 'Syncing…' : 'Sync all now'}</button>
      </PageHead>
      {!data || !settings.data ? <Loading /> : data.map((c) => (
        <Connector key={c.id} c={c} settings={settings.data} busy={busy} run={run} reload={() => { reload(); settings.reload(); }} />
      ))}
      <ImportCard onDone={reload} />
      <DemoCard onDone={reload} />
    </div>
  );
}

function Connector({ c, settings, busy, run, reload }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState(() => Object.fromEntries(c.fields.map((f) => [f.key, settings[f.key] || ''])));
  const status = c.lastRun?.status === 'error' ? ['err', 'Error'] : c.configured ? ['ok', 'Connected'] : ['', 'Not connected'];
  return (
    <Card title={<span className="row">{c.name} <span className={`badge ${status[0]}`}><span className="dot" />{status[1]}</span></span>}
      sub={c.lastRun ? `Last sync ${fmt.ago(c.lastRun.finished_at || c.lastRun.started_at)}: ${c.lastRun.status}${c.lastRun.rows ? `, ${c.lastRun.rows} rows` : ''}` : c.category}
      actions={<>
        <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Close' : c.configured ? 'Edit credentials' : 'Connect'}</button>
        <button className="btn sm" disabled={!c.configured || !!busy} onClick={() => run(c.id, () => api.post(`/integrations/${c.id}/sync`).then((r) => { reload(); return r; }),
          (r) => (r.status === 'ok' ? `Synced ${r.rows} rows` : `${r.status}: ${r.message}`))}>{busy === c.id ? 'Syncing…' : 'Sync now'}</button>
      </>}>
      {c.lastRun?.status === 'error' && <div className="notice" style={{ marginBottom: 10 }}><span className="bad">{c.lastRun.message}</span></div>}
      <div className="row muted" style={{ fontSize: 12 }}>
        {c.sources.map((s) => <span key={s.id}>{s.label}: {s.rows ? `${fmt.date(s.first)} to ${fmt.date(s.last)}${s.demo ? ' (demo)' : ''}` : 'no data'}</span>)}
      </div>
      {open && (
        <div className="stack" style={{ gap: 10, marginTop: 12 }}>
          {c.fields.map((f) => (
            <label className="field" key={f.key}>{f.label}
              {f.multiline
                ? <textarea className="input" rows={4} value={vals[f.key]} placeholder={f.secret && settings[f.key] ? 'Saved. Paste a new value to replace it.' : ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                : <input className="input" type={f.secret ? 'password' : 'text'} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} autoComplete="off" />}
            </label>
          ))}
          <div className="row">
            <button className="btn primary" disabled={!!busy} onClick={() => run('save', () => api.put('/settings', vals).then(() => { setOpen(false); reload(); }), 'Saved. Click "Sync now" to pull data.')}>Save</button>
            <a className="btn ghost" href={c.docs} target="_blank" rel="noreferrer">Setup guide ↗</a>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Credentials are stored in the local database on this server. You can also set them as environment variables instead (see README).</p>
        </div>
      )}
    </Card>
  );
}

function ImportCard({ onDone }) {
  const [source, setSource] = useState('openai_ads');
  const [csv, setCsv] = useState('');
  const [busy, run] = useAction();
  return (
    <Card title="Import CSV" sub="For channels without API access (or for backfilling history). Rows for the dates in the file replace existing ones.">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row">
          <select className="input" style={{ width: 220 }} value={source} onChange={(e) => setSource(e.target.value)}>
            {IMPORT_SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files[0]?.text().then(setCsv)} />
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Expected columns: <code>{IMPORT_COLS[source]}</code></p>
        <textarea className="input" rows={5} placeholder="…or paste CSV" value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div><button className="btn primary" disabled={!csv || busy} onClick={() => run('i', () => api.post('/import/metrics', { source, csv }).then((r) => { setCsv(''); onDone(); return r; }), (r) => `Imported ${r.rows} values (${r.from} to ${r.to})`)}>Import</button></div>
      </div>
    </Card>
  );
}

function DemoCard({ onDone }) {
  const [busy, run] = useAction();
  return (
    <Card title="Demo data" sub="Demo data fills channels that aren't connected yet. Live data replaces it per channel automatically.">
      <div className="row">
        <button className="btn danger" disabled={!!busy} onClick={() => confirm('Remove all demo metrics, demo leads and demo opportunities?') && run('c', () => api.post('/demo/clear').then(onDone), 'Demo data removed')}>Remove demo data</button>
        <button className="btn" disabled={!!busy} onClick={() => run('s', () => api.post('/demo/seed').then(onDone), 'Demo data loaded')}>Reload demo data</button>
      </div>
    </Card>
  );
}

import { useState } from 'react';
import { api } from '../lib/api.js';
import { fileToCsv } from '../lib/sheet.js';
import { fmt } from '../lib/format.js';
import { Card, PageHead, useFetch, useAction, Loading } from '../components/ui.jsx';

const IMPORT_SOURCES = [['openai_ads', 'ChatGPT Ads'], ['google_ads', 'Google Ads'], ['linkedin', 'LinkedIn'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['email', 'Outbound email'], ['ga4', 'Website (GA4)'], ['gsc', 'Search Console']];
const IMPORT_COLS = {
  openai_ads: 'ChatGPT Ads Manager → Reporting → Export CSV (daily breakdown). Needs Day/Date, Campaign, Spend, Impressions, Clicks, Conversions; £ signs and UK dates are fine', google_ads: 'date, campaign, spend, impressions, clicks, conversions, conversion_value',
  linkedin: 'LinkedIn page → Analytics → Content (and Followers) → Export. Upload the Excel file as it is; do Content and Followers as two uploads', facebook: 'Meta Business Suite → Insights → Export (daily). Excel or CSV both work', instagram: 'Meta Business Suite → Insights → Export (daily). Excel or CSV both work',
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
      <PipelineCard onDone={reload} />
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

function PipelineCard({ onDone }) {
  const { data, reload } = useFetch('/pipeline');
  const [json, setJson] = useState('');
  const [busy, run] = useAction();
  const doImport = (text) => run('p', () => api.post('/pipeline/import', { json: text }).then((r) => { setJson(''); reload(); onDone(); return r; }),
    (r) => `${r.total} leads synced: ${r.created} new, ${r.stageChanges} stage change${r.stageChanges === 1 ? '' : 's'}`);
  const paste = async () => {
    try { const text = await navigator.clipboard.readText(); if (text) return doImport(text); } catch { /* clipboard blocked: fall back to the box */ }
    document.getElementById('pipeline-json')?.focus();
  };
  return (
    <Card title={<span className="row">Lead pipeline (outbound email) {data?.total > 0 && <span className="badge ok"><span className="dot" />Connected</span>}</span>}
      sub={data?.lastImport ? `Last updated ${fmt.ago(data.lastImport)} · ${data.total} leads` : 'Your Monday lead engine. Its leads, Gmail drafts and stages feed the Leads and Outbound email pages.'}
      actions={data?.url && <a className="btn sm" href={data.url} target="_blank" rel="noreferrer">Open pipeline ↗</a>}>
      <div className="stack" style={{ gap: 10 }}>
        <ol className="secondary" style={{ margin: 0, paddingLeft: 20 }}>
          <li>Open the pipeline and click <strong>Export for dashboard</strong> at the top. It copies everything.</li>
          <li>Come back here and click <strong>Paste from pipeline</strong>.</li>
        </ol>
        <div className="row">
          <button className="btn primary" disabled={!!busy} onClick={paste}>{busy ? 'Updating…' : 'Paste from pipeline'}</button>
          <span className="muted" style={{ fontSize: 12 }}>Do this after the Monday run and whenever you change stages in the pipeline.</span>
        </div>
        <details>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Paste didn't work? Paste it into a box instead</summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <textarea id="pipeline-json" className="input" rows={4} placeholder="Click here, press Ctrl+V, then Import" value={json} onChange={(e) => setJson(e.target.value)} />
            <div><button className="btn" disabled={!json || !!busy} onClick={() => doImport(json)}>Import</button></div>
          </div>
        </details>
      </div>
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
          <input type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={(e) => {
            const f = e.target.files[0];
            if (!f) return;
            if (/linkedin/i.test(f.name)) setSource('linkedin');
            run('read', () => fileToCsv(f).then(setCsv), `Loaded ${f.name}. Check the channel, then click Import.`);
          }} />
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Expected columns: <code>{IMPORT_COLS[source]}</code></p>
        <textarea className="input" rows={5} placeholder="…or paste CSV" value={csv} onChange={(e) => setCsv(e.target.value)} />
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Excel (.xlsx / .xls) and CSV files both work.</p>
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

import { useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/format.js';
import { Card, PageHead, Priority, Seg, useFetch, useAction, Loading, ErrorBox, Markdown } from '../components/ui.jsx';

const SOURCE_LABEL = { email: 'Outbound email', linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', ga4: 'Website', gsc: 'Search',
  google_ads: 'Google Ads', openai_ads: 'ChatGPT Ads', paid: 'Paid', leads: 'Pipeline', radar: 'Market radar', strategy: 'Strategy' };

export default function Recommendations({ status }) {
  const [tab, setTab] = useState('open');
  const [src, setSrc] = useState('all');
  const { data, error, loading, reload } = useFetch(`/recommendations?status=${tab}`);
  const briefs = useFetch('/briefs');
  const [busy, run] = useAction();
  if (error) return <ErrorBox error={error} />;
  const sources = [...new Set((data || []).map((r) => r.source))];
  const list = (data || []).filter((r) => src === 'all' || r.source === src);

  const setStatus = (id, s) => run(id, () => api.patch(`/recommendations/${id}`, { status: s }).then(reload));
  return (
    <div className="stack">
      <PageHead title="Recommendations" sub="What to do next across every channel. Rules run after each sync; the AI strategist adds a weekly plan.">
        <button className="btn" disabled={busy === 'refresh'} onClick={() => run('refresh', () => api.post('/recommendations/refresh').then(reload), (r) => `${r.count} rule-based recommendations`)}>Re-run rules</button>
        <button className="btn primary" disabled={busy === 'ai' || !status?.ai} title={status?.ai ? '' : 'Add an Anthropic API key in Settings'}
          onClick={() => run('ai', () => api.post('/brief').then(() => { reload(); briefs.reload(); }), 'AI strategist added new recommendations')}>
          {busy === 'ai' ? 'Thinking…' : 'Ask the AI strategist'}
        </button>
      </PageHead>
      <div className="row between">
        <Seg options={[['open', 'Open'], ['done', 'Done'], ['dismissed', 'Dismissed']]} value={tab} onChange={setTab} />
        <select className="input" style={{ width: 200 }} value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Filter by channel">
          <option value="all">All channels</option>
          {sources.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s] || s}</option>)}
        </select>
      </div>
      <Card>
        {loading && !data ? <Loading /> : list.length ? list.map((r) => (
          <div className="rec" key={r.id}>
            <Priority p={r.priority} />
            <div>
              <div className="row" style={{ marginBottom: 2 }}>
                <span className="badge">{SOURCE_LABEL[r.source] || r.source}</span>
                {r.origin === 'ai' && <span className="badge">AI strategist</span>}
                <span className="muted" style={{ fontSize: 12 }}>{fmt.ago(r.updated_at)}</span>
              </div>
              <h3>{r.title}</h3>
              <p>{r.detail}</p>
              {r.action && <p className="action"><strong>Do this:</strong> {r.action}</p>}
              {r.impact && <p className="muted" style={{ fontSize: 12.5 }}>Expected impact: {r.impact}</p>}
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              {tab === 'open' ? <>
                <button className="btn sm" disabled={busy === r.id} onClick={() => setStatus(r.id, 'done')}>Done</button>
                <button className="btn sm ghost" disabled={busy === r.id} onClick={() => setStatus(r.id, 'dismissed')}>Dismiss</button>
              </> : <button className="btn sm" onClick={() => setStatus(r.id, 'open')}>Reopen</button>}
            </div>
          </div>
        )) : <div className="empty">Nothing here.</div>}
      </Card>
      {briefs.data?.length > 0 && (
        <Card title="Previous strategy briefs">
          {briefs.data.map((b) => (
            <details key={b.id} style={{ borderBottom: '1px solid var(--grid)', padding: '8px 0' }}>
              <summary style={{ cursor: 'pointer' }}>{fmt.dateTime(b.created_at)}</summary>
              <Markdown text={b.body} />
            </details>
          ))}
        </Card>
      )}
    </div>
  );
}

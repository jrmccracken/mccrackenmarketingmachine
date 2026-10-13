import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fmt, KPI } from '../lib/format.js';
import { Card, PageHead, Priority, Seg, RANGES, useRange, useFetch, useAction, Loading, ErrorBox, Markdown, Delta, DemoBadge } from '../components/ui.jsx';
import { Sparkline } from '../components/Chart.jsx';

// The one KPI per channel the command centre leads with.
const TILES = [
  ['email', 'replies', '/email', 'reply_rate'],
  ['linkedin', 'impressions', '/social', 'engagement_rate'],
  ['ga4', 'sessions', '/website', 'conversions'],
  ['gsc', 'clicks', '/search', 'position'],
  ['google_ads', 'conversions', '/paid', 'cpa'],
  ['openai_ads', 'conversions', '/paid', 'cpa'],
  ['instagram', 'impressions', '/social', 'engagement_rate'],
  ['facebook', 'impressions', '/social', 'engagement_rate'],
];

export default function Overview({ status }) {
  const [days, setDays] = useRange();
  const { data, error, loading, reload } = useFetch(`/overview?days=${days}`);
  const [busy, run] = useAction();

  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  const S = data.snapshot.sources;
  const leadsIn = data.pipeline.filter((p) => !['won', 'lost'].includes(p.stage));
  const openValue = leadsIn.reduce((a, p) => a + p.value, 0);
  const paidSpend = (S.google_ads?.current.cost || 0) + (S.openai_ads?.current.cost || 0);
  const paidConv = (S.google_ads?.current.conversions || 0) + (S.openai_ads?.current.conversions || 0);

  return (
    <div className="stack">
      <PageHead title="Command centre" sub={`${fmt.date(data.snapshot.window.from)} to ${fmt.date(data.snapshot.window.to)}, compared with the previous ${days} days`}>
        <Seg options={RANGES} value={days} onChange={setDays} />
      </PageHead>

      {status?.demo && (
        <div className="notice">
          <span>Channels without a connected integration are showing <strong>demo data</strong> so you can explore. It's replaced automatically when you connect each one.</span>
          <Link className="btn sm" to="/integrations">Connect integrations</Link>
        </div>
      )}

      <div className="grid cols-4">
        <div className="card stat">
          <span className="stat-label">Open pipeline</span>
          <span className="stat-value num" style={{ fontSize: 30 }}>{fmt.money(openValue)}</span>
          <span className="muted" style={{ fontSize: 12 }}>{leadsIn.reduce((a, p) => a + p.n, 0)} active leads · {fmt.money(data.pipeline.find((p) => p.stage === 'won')?.value || 0)} won</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Paid spend</span>
          <span className="stat-value num">{fmt.money(paidSpend)}</span>
          <span className="muted" style={{ fontSize: 12 }}>{fmt.n(paidConv)} conversions · {fmt.money(paidConv ? paidSpend / paidConv : 0)} blended CPA</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Website conversions</span>
          <span className="stat-value num">{fmt.n(S.ga4?.current.conversions)}</span>
          {S.ga4 && <Delta value={S.ga4.change.conversions} />}
        </div>
        <div className="card stat">
          <span className="stat-label">Email replies</span>
          <span className="stat-value num">{fmt.n(S.email?.current.replies)}</span>
          {S.email && <span className="muted" style={{ fontSize: 12 }}>{fmt.pct(S.email.current.reply_rate, 2)} reply rate</span>}
        </div>
      </div>

      <div className="grid cols-4">
        {TILES.filter(([s]) => S[s]).map(([s, k, to, sub]) => (
          <Link to={to} className="card stat" key={s}>
            <span className="stat-label">{S[s].label} · {KPI[k].label.toLowerCase()} <DemoBadge show={S[s].demo} /></span>
            <span className="stat-value num">{KPI[k].f(S[s].current[k])}</span>
            <Delta value={S[s].change[k]} up={KPI[k].up} />
            <span className="muted" style={{ fontSize: 12 }}>{KPI[sub].label}: {KPI[sub].f(S[s].current[sub])}</span>
            <Sparkline values={data.sparks[s]} />
          </Link>
        ))}
      </div>

      <div className="grid cols-3">
        <Card className="span-2" title="What to do next" sub="Ranked by impact. Updated after every sync."
          actions={<Link className="btn sm" to="/recommendations">All recommendations</Link>}>
          {data.recommendations.length ? data.recommendations.map((r) => (
            <div className="rec" key={r.id}>
              <Priority p={r.priority} />
              <div>
                <h3>{r.title}</h3>
                <p>{r.detail}</p>
                {r.action && <p className="action"><strong>Do this:</strong> {r.action}</p>}
              </div>
              <button className="btn sm" disabled={busy === r.id}
                onClick={() => run(r.id, () => api.patch(`/recommendations/${r.id}`, { status: 'done' }).then(reload), 'Marked done')}>Done</button>
            </div>
          )) : <div className="empty">Nothing urgent. Nice.</div>}
        </Card>

        <div className="stack">
          <Card title="Follow-ups due" actions={<Link className="btn sm" to="/leads?due=1">Open</Link>}>
            {data.followUps.length ? data.followUps.map((l) => (
              <Link to={`/leads/${l.id}`} className="list-item" key={l.id} style={{ textDecoration: 'none' }}>
                <div><strong>{l.first_name} {l.last_name}</strong><div className="muted" style={{ fontSize: 12 }}>{l.company} · {l.stage}</div></div>
                <span className={new Date(l.next_follow_up_at) < new Date() ? 'bad' : 'secondary'} style={{ fontSize: 12 }}>{fmt.ago(l.next_follow_up_at)}</span>
              </Link>
            )) : <div className="empty">You're all caught up</div>}
          </Card>
          <Card title="Market radar" sub="New PR and outbound opportunities" actions={<Link className="btn sm" to="/radar">Open</Link>}>
            {data.opportunities.length ? data.opportunities.map((o) => (
              <div className="list-item" key={o.id}>
                <div style={{ minWidth: 0 }}>
                  <span className="badge" style={{ marginBottom: 4 }}>{o.kind === 'pr' ? 'PR' : 'Outbound'}</span>
                  <div style={{ fontSize: 13 }}>{o.title}</div>
                </div>
                <span className="num secondary" title="Opportunity score">{Math.round(o.score)}</span>
              </div>
            )) : <div className="empty">No new opportunities</div>}
          </Card>
        </div>
      </div>

      <Card title="Pipeline" sub="Leads by stage (count · value)">
        <div className="funnel">
          {data.pipeline.map((p) => (
            <div key={p.stage}><strong className="num">{p.n}</strong><span>{p.stage}</span><div className="muted num" style={{ fontSize: 11.5 }}>{fmt.money(p.value)}</div></div>
          ))}
        </div>
      </Card>

      <Card title="Weekly strategy brief" sub={data.brief ? `Written ${fmt.ago(data.brief.created_at)}` : 'The AI strategist reads every channel and writes the plan for the week.'}
        actions={<button className="btn primary sm" disabled={busy === 'brief' || !status?.ai}
          title={status?.ai ? '' : 'Add an Anthropic API key in Settings'}
          onClick={() => run('brief', () => api.post('/brief').then(reload), 'Brief written')}>{busy === 'brief' ? 'Thinking…' : 'Write this week\'s brief'}</button>}>
        {data.brief ? <Markdown text={data.brief.body} /> : <div className="empty">{status?.ai ? 'No brief yet. Generate one above.' : 'Add an Anthropic API key in Settings to switch on the AI strategist.'}</div>}
      </Card>
    </div>
  );
}

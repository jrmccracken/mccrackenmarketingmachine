import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, KPI } from '../lib/format.js';
import { Card, PageHead, Seg, RANGES, useRange, useFetch, Loading, ErrorBox, StatRow, DataTable, DemoBadge, Delta } from '../components/ui.jsx';
import { LineChart, BarList } from '../components/Chart.jsx';

function useChannel(source, days) {
  return useFetch(`/channel/${source}?days=${days}`);
}

function NoData({ label }) {
  return (
    <Card>
      <div className="empty">
        No {label} data yet. <Link to="/integrations">Connect the integration</Link> or import a CSV.
      </div>
    </Card>
  );
}

function Head({ title, sub, days, setDays, demo }) {
  return (
    <PageHead title={<span className="row">{title} <DemoBadge show={demo} /></span>} sub={sub}>
      <Seg options={RANGES} value={days} onChange={setDays} />
    </PageHead>
  );
}

const col = (key, extra = {}) => ({ key, label: KPI[key]?.label || key, f: KPI[key]?.f, r: true, ...extra });

// ------------------------------------------------------------------ Outbound email
// Fed by the Lead pipeline (Gmail drafts sent by hand), or by Instantly if that's connected instead.
export function EmailPage() {
  const [days, setDays] = useRange();
  const { data, error, loading } = useChannel('email', days);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  const p = data.pipeline;
  const fromPipeline = p?.total > 0;
  const hasOpens = (data.snapshot?.current.opens || 0) > 0;
  return (
    <div className="stack">
      <Head title="Outbound email" days={days} setDays={setDays} demo={data.info.demo}
        sub={fromPipeline ? `From your Lead pipeline · last imported ${p.lastImport ? new Date(p.lastImport).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never'}` : 'Connect your Lead pipeline on the Integrations page'} />
      {fromPipeline && (
        <Card title="Lead pipeline" sub="Where every researched prospect is right now" actions={<>
          <a className="btn sm" href={p.url} target="_blank" rel="noreferrer">Open pipeline ↗</a>
          <Link className="btn sm primary" to="/integrations">Update from pipeline</Link>
        </>}>
          <div className="funnel" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))' }}>
            {['New', 'Drafted', 'Sent', 'Replied', 'Meeting', 'Proposal', 'Won', 'Parked', 'Lost'].map((s) => (
              <div key={s}><strong className="num">{p.byStatus[s] || 0}</strong><span>{s}</span></div>
            ))}
          </div>
        </Card>
      )}
      {!data.snapshot ? <NoData label="email" /> : <>
        <StatRow snap={data.snapshot} keys={fromPipeline && !hasOpens ? ['prospects', 'sent', 'reply_rate', 'opportunities'] : ['sent', 'open_rate', 'reply_rate', 'bounce_rate']} />
        <div className="grid cols-2">
          <Card title="Emails sent per day"><LineChart data={data.series} series={[{ key: 'sent', label: 'Sent' }]} /></Card>
          <Card title="Replies and meetings per day"><LineChart data={data.series} series={[{ key: 'replies', label: 'Replies' }, { key: 'opportunities', label: 'Meetings' }]} /></Card>
        </div>
        <Card title={fromPipeline ? 'By fit grade' : 'Campaigns'} sub={fromPipeline ? 'Is the A-list replying more than the rest?' : 'Sorted by volume. Look for reply rate outliers in both directions.'}>
          <DataTable rows={data.campaigns} initialSort={{ key: fromPipeline ? 'prospects' : 'sent', dir: 'desc' }} cols={fromPipeline && !hasOpens ? [
            { key: 'name', label: 'Segment' }, col('prospects'), col('sent'), col('replies'), col('reply_rate'), col('opportunities'), col('bounces'),
          ] : [
            { key: 'name', label: 'Campaign' }, col('sent'), col('open_rate'), col('reply_rate'), col('replies'), col('bounce_rate'), col('opportunities'),
          ]} />
        </Card>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ Social
const NETWORKS = [['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['facebook', 'Facebook']];
export function SocialPage() {
  const [days, setDays] = useRange();
  const [net, setNet] = useState('linkedin');
  const results = Object.fromEntries(NETWORKS.map(([id]) => [id, useChannel(id, days)])); // fixed order: hooks are stable
  const cur = results[net];
  if (cur.error) return <ErrorBox error={cur.error} />;
  if (!cur.data) return <Loading />;
  const d = cur.data;
  return (
    <div className="stack">
      <Head title="Social" sub="Company page performance across networks" days={days} setDays={setDays} demo={d.info.demo} />
      <Card title="All networks" sub={`Last ${days} days`}>
        <DataTable rows={NETWORKS.map(([id, label]) => ({ name: label, ...(results[id].data?.snapshot?.current || {}), change: results[id].data?.snapshot?.change?.impressions }))}
          cols={[{ key: 'name', label: 'Network' }, col('impressions'), { key: 'change', label: 'Δ impressions', r: true, render: (r) => <Delta value={r.change} /> },
            col('engagements'), col('engagement_rate'), col('clicks'), col('followers_gained')]} />
      </Card>
      <div className="row"><Seg options={NETWORKS} value={net} onChange={setNet} /></div>
      {!d.snapshot ? <NoData label={d.label} /> : <>
        <StatRow snap={d.snapshot} keys={['impressions', 'engagements', 'engagement_rate', 'followers_gained']} />
        <div className="grid cols-2">
          <Card title={`${d.label} impressions`}><LineChart data={d.series} series={[{ key: 'impressions', label: 'Impressions' }]} /></Card>
          <Card title={`${d.label} engagements and clicks`}><LineChart data={d.series} series={[{ key: 'engagements', label: 'Engagements' }, { key: 'clicks', label: 'Clicks' }]} /></Card>
        </div>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ Website
export function WebsitePage() {
  const [days, setDays] = useRange();
  const { data, error, loading } = useChannel('ga4', days);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  return (
    <div className="stack">
      <Head title="Website" sub="Google Analytics 4" days={days} setDays={setDays} demo={data.info.demo} />
      {!data.snapshot ? <NoData label="GA4" /> : <>
        <StatRow snap={data.snapshot} keys={['sessions', 'users', 'conversions', 'conversion_rate']} />
        <div className="grid cols-2">
          <Card title="Sessions per day"><LineChart data={data.series} series={[{ key: 'sessions', label: 'Sessions' }]} /></Card>
          <Card title="Conversions per day" sub="GA4 key events"><LineChart data={data.series} series={[{ key: 'conversions', label: 'Conversions' }]} /></Card>
        </div>
        <div className="grid cols-2">
          <Card title="Sessions by channel">
            <BarList rows={data.channels} value={(r) => r.sessions || 0} />
          </Card>
          <Card title="Channel quality">
            <DataTable rows={data.channels} initialSort={{ key: 'sessions', dir: 'desc' }} cols={[
              { key: 'name', label: 'Channel' }, col('sessions'), col('engagement_rate'), col('conversions'), col('conversion_rate')]} />
          </Card>
        </div>
        {data.pages?.length > 0 && (
          <Card title="Top landing pages">
            <DataTable rows={data.pages} initialSort={{ key: 'sessions', dir: 'desc' }} cols={[
              { key: 'name', label: 'Page' }, col('sessions'), col('engagement_rate'), col('conversions'), col('conversion_rate')]} />
          </Card>
        )}
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ Search Console
export function SearchPage() {
  const [days, setDays] = useRange();
  const [filter, setFilter] = useState('all');
  const { data, error, loading } = useChannel('gsc', days);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  const queries = (data.queries || []).filter((q) =>
    filter === 'striking' ? q.position > 4 && q.position <= 15 && q.impressions >= 50
      : filter === 'ctr' ? q.position <= 5 && q.ctr < 0.03 && q.impressions >= 50 : true);
  return (
    <div className="stack">
      <Head title="Search Console" sub="Organic Google search performance" days={days} setDays={setDays} demo={data.info.demo} />
      {!data.snapshot ? <NoData label="Search Console" /> : <>
        <StatRow snap={data.snapshot} keys={['clicks', 'impressions', 'ctr', 'position']} />
        <div className="grid cols-2">
          <Card title="Clicks per day"><LineChart data={data.series} series={[{ key: 'clicks', label: 'Clicks' }]} /></Card>
          <Card title="Impressions per day"><LineChart data={data.series} series={[{ key: 'impressions', label: 'Impressions' }]} /></Card>
        </div>
        <Card title="Queries" actions={<Seg options={[['all', 'All'], ['striking', 'Striking distance (4-15)'], ['ctr', 'Low CTR in top 5']]} value={filter} onChange={setFilter} />}>
          <DataTable rows={queries} initialSort={{ key: 'impressions', dir: 'desc' }} empty="No queries match this filter" cols={[
            { key: 'name', label: 'Query' }, col('clicks'), col('impressions'), col('ctr'), col('position')]} />
        </Card>
        <Card title="Pages">
          <DataTable rows={data.pages} initialSort={{ key: 'clicks', dir: 'desc' }} empty="No page data yet (comes from live sync)" cols={[
            { key: 'name', label: 'Page', render: (r) => <span style={{ wordBreak: 'break-all' }}>{r.name}</span> }, col('clicks'), col('impressions'), col('ctr'), col('position')]} />
        </Card>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ Paid
export function PaidPage() {
  const [days, setDays] = useRange();
  const g = useChannel('google_ads', days);
  const o = useChannel('openai_ads', days);
  if (g.error || o.error) return <ErrorBox error={g.error || o.error} />;
  if (!g.data || !o.data) return <Loading />;
  const merged = g.data.series.map((r, i) => ({
    date: r.date, g_cost: r.cost, o_cost: o.data.series[i]?.cost || 0, g_conv: r.conversions, o_conv: o.data.series[i]?.conversions || 0,
  }));
  const platforms = [['Google Ads', g.data], ['ChatGPT Ads', o.data]].filter(([, d]) => d.snapshot);
  const keys = ['cost', 'impressions', 'clicks', 'ctr', 'cpc', 'conversions', 'cpa', 'conv_rate', 'roas'];
  return (
    <div className="stack">
      <Head title="Paid: Google Ads & ChatGPT Ads" sub="Side-by-side so you can move budget to whichever converts cheaper" days={days} setDays={setDays}
        demo={g.data.info.demo || o.data.info.demo} />
      {!platforms.length ? <NoData label="paid" /> : <>
        <Card title="Platform comparison" sub={`Last ${days} days, change vs previous period`}>
          <div className="table-wrap"><table>
            <thead><tr><th>Metric</th>{platforms.map(([n, d]) => <th className="r" key={n}>{n} <DemoBadge show={d.info.demo} /></th>)}</tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k}><td>{KPI[k].label}</td>{platforms.map(([n, d]) => (
                <td className="r num" key={n}>{KPI[k].f(d.snapshot.current[k])}<div><Delta value={d.snapshot.change[k]} up={KPI[k].up} /></div></td>
              ))}</tr>
            ))}</tbody>
          </table></div>
        </Card>
        <div className="grid cols-2">
          <Card title="Spend per day"><LineChart data={merged} format={fmt.money} series={[{ key: 'g_cost', label: 'Google Ads' }, { key: 'o_cost', label: 'ChatGPT Ads' }]} /></Card>
          <Card title="Conversions per day"><LineChart data={merged} series={[{ key: 'g_conv', label: 'Google Ads' }, { key: 'o_conv', label: 'ChatGPT Ads' }]} /></Card>
        </div>
        {platforms.map(([n, d]) => (
          <Card key={n} title={`${n} campaigns`}>
            <DataTable rows={d.campaigns} initialSort={{ key: 'cost', dir: 'desc' }} cols={[
              { key: 'name', label: 'Campaign' }, col('cost'), col('clicks'), col('ctr'), col('cpc'), col('conversions'), col('cpa'), col('roas')]} />
          </Card>
        ))}
      </>}
    </div>
  );
}

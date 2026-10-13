import { totals, breakdown, daysAgo, ratio, pctChange, sourceInfo } from '../metrics.js';
import { SOURCES } from '../connectors/index.js';

/** Derived KPIs for a source from raw totals. */
export function derive(source, t) {
  const v = (k) => t[k] || 0;
  switch (source) {
    case 'email':
      return { ...t, open_rate: ratio(v('opens'), v('sent')), reply_rate: ratio(v('replies'), v('sent')),
        bounce_rate: ratio(v('bounces'), v('sent')), click_rate: ratio(v('clicks'), v('sent')) };
    case 'ga4':
      return { ...t, engagement_rate: ratio(v('engaged_sessions'), v('sessions')), conversion_rate: ratio(v('conversions'), v('sessions')) };
    case 'gsc':
      return { ...t, ctr: ratio(v('clicks'), v('impressions')), position: ratio(v('position_weighted'), v('impressions')) };
    case 'google_ads':
    case 'openai_ads':
      return { ...t, ctr: ratio(v('clicks'), v('impressions')), cpc: ratio(v('cost'), v('clicks')),
        cpa: v('conversions') ? v('cost') / v('conversions') : null, conv_rate: ratio(v('conversions'), v('clicks')), roas: v('cost') ? v('conv_value') / v('cost') : null };
    default: // social
      return { ...t, engagement_rate: ratio(v('engagements'), v('impressions')) };
  }
}

/** Current window vs the previous window of equal length, for every source with data. */
export function snapshot(days = 28) {
  const to = daysAgo(1);
  const from = daysAgo(days);
  const prevTo = daysAgo(days + 1);
  const prevFrom = daysAgo(days * 2);
  const out = { window: { from, to, prevFrom, prevTo, days }, sources: {} };
  for (const [source, meta] of Object.entries(SOURCES)) {
    const info = sourceInfo(source);
    if (!info.rows) continue;
    const cur = derive(source, totals(source, from, to));
    const prev = derive(source, totals(source, prevFrom, prevTo));
    const change = Object.fromEntries(Object.keys(cur).map((k) => [k, cur[k] == null || prev[k] == null ? null : pctChange(cur[k], prev[k])]));
    out.sources[source] = { label: meta.label, demo: info.demo, lastDate: info.last, current: cur, previous: prev, change };
  }
  return out;
}

export function campaigns(source, from, to) {
  return breakdown(source, 'campaign', from, to, { orderBy: source === 'email' ? 'sent' : 'cost', limit: 100 })
    .map((c) => ({ ...derive(source, c), name: c.name }));
}

export function searchQueries(from, to, limit = 200) {
  return breakdown('gsc', 'query', from, to, { orderBy: 'impressions', limit })
    .map((q) => ({ ...derive('gsc', q), name: q.name }));
}
export function searchPages(from, to, limit = 100) {
  return breakdown('gsc', 'page', from, to, { orderBy: 'clicks', limit })
    .map((q) => ({ ...derive('gsc', q), name: q.name }));
}

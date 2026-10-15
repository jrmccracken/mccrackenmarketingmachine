import { db, tx } from './db.js';

export const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
export const daysAgo = (n, from = new Date()) => {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
};

export function dateRange(from, to) {
  const out = [];
  for (let d = new Date(from + 'T00:00:00Z'); isoDate(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(isoDate(d));
  return out;
}

/** Replace a source's rows inside [from, to] with fresh ones. Live data also clears any demo rows for the source. */
export function writeMetrics(source, rows, { from, to, demo = false, onlyMetrics = null }) {
  // onlyMetrics: replace just these metrics (e.g. a followers export must not wipe impressions from a content export).
  const del = onlyMetrics
    ? db.prepare(`DELETE FROM metrics WHERE source = ? AND date BETWEEN ? AND ? AND metric IN (${onlyMetrics.map(() => '?').join(',')})`)
    : db.prepare('DELETE FROM metrics WHERE source = ? AND date BETWEEN ? AND ?');
  const ins = db.prepare(`INSERT INTO metrics(source, metric, date, dim_type, dim, value, demo) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(source, metric, date, dim_type, dim) DO UPDATE SET value = excluded.value, demo = excluded.demo`);
  tx(() => {
    const sources = new Set(rows.map((r) => r.source || source));
    sources.add(source);
    for (const s of sources) {
      if (!demo) db.prepare('DELETE FROM metrics WHERE source = ? AND demo = 1').run(s);
      if (from && to) del.run(s, from, to, ...(onlyMetrics || []));
    }
    for (const r of rows) {
      if (!Number.isFinite(r.value)) continue;
      ins.run(r.source || source, r.metric, r.date, r.dim_type || '', String(r.dim ?? ''), r.value, demo ? 1 : 0);
    }
  });
  return rows.length;
}

/** Daily series of totals for a set of metrics. */
export function series(source, metrics, from, to) {
  const rows = db.prepare(`SELECT date, metric, SUM(value) v FROM metrics
    WHERE source = ? AND dim_type = '' AND date BETWEEN ? AND ? GROUP BY date, metric`).all(source, from, to);
  const byDate = new Map(dateRange(from, to).map((d) => [d, Object.fromEntries(metrics.map((m) => [m, 0]))]));
  for (const r of rows) if (byDate.has(r.date) && metrics.includes(r.metric)) byDate.get(r.date)[r.metric] = r.v;
  return [...byDate].map(([date, vals]) => ({ date, ...vals }));
}

// Daily rates and averages (Clarity's scroll depth, % of sessions with rage clicks…) are averaged over a period, not added up.
export const isAverage = (metric) => /_pct$|^scroll_depth$|^pages_per_session$|^engagement_time$/.test(metric);

export function totals(source, from, to) {
  const rows = db.prepare(`SELECT metric, SUM(value) s, AVG(value) a FROM metrics
    WHERE source = ? AND dim_type = '' AND date BETWEEN ? AND ? GROUP BY metric`).all(source, from, to);
  return Object.fromEntries(rows.map((r) => [r.metric, isAverage(r.metric) ? r.a : r.s]));
}

/** Totals broken down by a dimension (campaign, query, page, channel, post). */
export function breakdown(source, dimType, from, to, { orderBy, limit = 50 } = {}) {
  const rows = db.prepare(`SELECT dim, metric, SUM(value) s, AVG(value) a FROM metrics
    WHERE source = ? AND dim_type = ? AND date BETWEEN ? AND ? GROUP BY dim, metric`).all(source, dimType, from, to)
    .map((r) => ({ ...r, v: isAverage(r.metric) ? r.a : r.s }));
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.dim)) map.set(r.dim, { name: r.dim });
    map.get(r.dim)[r.metric] = r.v;
  }
  let out = [...map.values()];
  if (orderBy) out.sort((a, b) => (b[orderBy] || 0) - (a[orderBy] || 0));
  return out.slice(0, limit);
}

export function sourceInfo(source) {
  const r = db.prepare('SELECT MIN(date) first, MAX(date) last, MAX(demo) demo, COUNT(*) n FROM metrics WHERE source = ?').get(source);
  return { first: r.first, last: r.last, demo: !!r.demo, rows: r.n };
}

export const ratio = (a, b) => (b ? a / b : 0);
export const pctChange = (cur, prev) => (prev ? (cur - prev) / prev : cur ? 1 : 0);

import { getSetting, setSettings } from '../settings.js';
import { getJson } from './google-auth.js';

// Microsoft Clarity Data Export API: https://learn.microsoft.com/en-us/clarity/clarity-data-export-api
// It only returns the last 1-3 days and allows ~10 requests a day per project, so we fetch the last 24 hours once a
// day (two requests: site totals and per-page) and keep our own day-by-day history.
const URL_BASE = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';
const n = (v) => { const x = Number(String(v ?? '').replace(/[,%]/g, '')); return Number.isFinite(x) ? x : 0; };

/** One Clarity response -> { metric: value } for the whole site (or for one row of a dimension breakdown). */
export function clarityMetrics(info) {
  const out = {};
  const pick = (name, field, metric) => {
    const r = info[name];
    if (r && r[field] !== undefined) out[metric] = n(r[field]);
  };
  pick('Traffic', 'totalSessionCount', 'sessions');
  pick('Traffic', 'totalBotSessionCount', 'bot_sessions');
  pick('Traffic', 'distinctUserCount', 'users');
  pick('Traffic', 'pagesPerSessionPercentage', 'pages_per_session');
  pick('ScrollDepth', 'averageScrollDepth', 'scroll_depth');
  pick('EngagementTime', 'activeTime', 'engagement_time');
  // Frustration signals: share of sessions that hit them.
  for (const [name, metric] of [['RageClickCount', 'rage_click_pct'], ['DeadClickCount', 'dead_click_pct'], ['QuickbackClick', 'quickback_pct'],
    ['ExcessiveScroll', 'excessive_scroll_pct'], ['ScriptErrorCount', 'script_error_pct'], ['ErrorClickCount', 'error_click_pct']]) {
    pick(name, 'sessionsWithMetricPercentage', metric);
  }
  return out;
}

/** Group a response's rows by the value of a dimension (e.g. URL), keeping each metric's first row per value. */
export function byDimension(response, dimension) {
  const groups = new Map();
  for (const m of response || []) {
    for (const row of m.information || []) {
      const key = row[dimension] ?? row[dimension.toLowerCase()] ?? row.Url ?? row.URL;
      if (!key) continue;
      const g = groups.get(key) || {};
      if (!g[m.metricName]) g[m.metricName] = row;
      groups.set(key, g);
    }
  }
  return groups;
}

export default {
  id: 'clarity',
  name: 'Microsoft Clarity',
  category: 'Website behaviour',
  docs: 'https://learn.microsoft.com/en-us/clarity/clarity-data-export-api',
  fields: [{ key: 'clarity.token', label: 'Clarity API token (Clarity → Settings → Data Export → Generate new API token)', secret: true }],
  configured: () => !!getSetting('clarity.token'),
  keepsHistory: true, // the API only covers the last day, so never clear older days

  async sync({ force } = {}) {
    // Stay well inside Clarity's daily request limit: at most one fetch per ~20 hours unless forced.
    const last = Date.parse(getSetting('clarity.last_fetch') || 0);
    if (!force && Date.now() - last < 20 * 3600e3) return [];
    const headers = { authorization: `Bearer ${getSetting('clarity.token')}`, 'content-type': 'application/json' };
    const site = await getJson(`${URL_BASE}?numOfDays=1`, { headers });
    const pages = await getJson(`${URL_BASE}?numOfDays=1&dimension1=URL`, { headers });
    setSettings({ 'clarity.last_fetch': new Date().toISOString() });

    // The figures cover the 24 hours before the fetch, so they're filed under yesterday.
    const date = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const rows = [];
    const siteInfo = Object.fromEntries((site || []).map((m) => [m.metricName, (m.information || [])[0] || {}]));
    for (const [metric, value] of Object.entries(clarityMetrics(siteInfo))) rows.push({ metric, date, value });
    for (const [url, info] of byDimension(pages, 'Url')) {
      let path = url;
      try { path = new URL(url).pathname || '/'; } catch { /* keep as given */ }
      for (const [metric, value] of Object.entries(clarityMetrics(info))) rows.push({ metric, date, dim_type: 'page', dim: path, value });
    }
    return rows;
  },
};

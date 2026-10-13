/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF. Returns objects keyed by normalised header. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/^﻿/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** "£1,234.50", "12%", "" -> number (NaN when not numeric). */
export function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[£$€,\s%]/g, '');
  return s === '' || s === '-' || s === '--' ? 0 : Number(s);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** Accepts 2026-10-13, 13/10/2026 (UK order, or US order with order 'mdy'), 13 Oct 2026, Oct 13, 2026. Returns YYYY-MM-DD or null. */
export function toIsoDate(v, order = 'dmy') {
  const s = String(v ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/))) {
    const [d, mo] = order === 'mdy' ? [m[2], m[1]] : [m[1], m[2]];
    return `${m[3]}-${pad(mo)}-${pad(d)}`;
  }
  if ((m = s.match(/^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})/i)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    return `${m[3]}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(m[1])}`;
  }
  if ((m = s.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(m[2])}`;
  }
  return null;
}

/** Find the date column under its common export names and normalise it to row.date (ISO). Rows without a date (totals) are dropped. */
export function withIsoDates(list, { defaultOrder = 'dmy' } = {}) {
  const keys = ['date', 'day', 'reporting_starts', 'start_date', 'date_range', 'time_period'];
  const raw = list.map((r) => String(r[keys.find((k) => r[k])] ?? ''));
  // 05/10/2026 is ambiguous, so look across the whole column: a first part over 12 means UK order, a second part over 12 means US order.
  const parts = raw.map((v) => v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}/)).filter(Boolean);
  const order = parts.some((m) => +m[1] > 12) ? 'dmy' : parts.some((m) => +m[2] > 12) ? 'mdy' : defaultOrder;
  return list.map((r, i) => ({ ...r, date: toIsoDate(raw[i], order) })).filter((r) => r.date);
}

// Column names used by LinkedIn, Facebook and Instagram exports, normalised by parseCsv.
const SOCIAL_ALIASES = {
  impressions: ['impressions', 'impressions_total', 'total_impressions', 'impressions_organic', 'views', 'post_impressions'],
  clicks: ['clicks', 'clicks_total', 'total_clicks', 'clicks_organic', 'link_clicks'],
  engagements: ['engagements', 'total_engagements', 'engagement', 'interactions', 'total_interactions'],
  followers_gained: ['followers_gained', 'new_followers', 'total_followers', 'follows', 'net_followers', 'followers'],
};
const ENGAGEMENT_PARTS = [['reactions_total', 'reactions', 'likes'], ['comments_total', 'comments'], ['reposts_total', 'reposts', 'shares_total', 'shares']];

/** One row of a social export -> { metric: value } using whatever column names the export has. */
export function socialMetrics(row) {
  const first = (names) => { for (const n of names) if (row[n] !== undefined && row[n] !== '') return toNumber(row[n]); return undefined; };
  const out = {};
  for (const [metric, names] of Object.entries(SOCIAL_ALIASES)) {
    const v = first(names);
    if (v !== undefined && Number.isFinite(v)) out[metric] = v;
  }
  if (out.engagements === undefined) {
    const parts = ENGAGEMENT_PARTS.map(first).filter((v) => v !== undefined && Number.isFinite(v));
    if (parts.length) out.engagements = parts.reduce((a, b) => a + b, 0) + (out.clicks || 0);
  }
  return out;
}

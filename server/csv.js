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

/** Accepts 2026-10-13, 13/10/2026 (UK order), 13 Oct 2026, Oct 13, 2026. Returns YYYY-MM-DD or null. */
export function toIsoDate(v) {
  const s = String(v ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  if ((m = s.match(/^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})/i)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    return `${m[3]}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(m[1])}`;
  }
  if ((m = s.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(m[2])}`;
  }
  return null;
}

/** Find the date column under its common export names and normalise it to row.date (ISO). Rows without a date (totals) are dropped. */
export function withIsoDates(list) {
  const keys = ['date', 'day', 'reporting_starts', 'start_date', 'date_range', 'time_period'];
  return list
    .map((r) => ({ ...r, date: toIsoDate(r[keys.find((k) => r[k])] ?? '') }))
    .filter((r) => r.date);
}

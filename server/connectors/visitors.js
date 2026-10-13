import { getSetting } from '../settings.js';
import { serviceAccountToken, getJson } from './google-auth.js';
import { db, tx } from '../db.js';
import { rowsToEvents } from '../services/visitors.js';

// Reads the "McCracken Marketing – Website Visitor Log" Google Sheet that the website's tracking snippet writes to,
// using the same Google service account as GA4 and Search Console. Share the sheet with the service account (Viewer)
// and enable the Google Sheets API in the Cloud project.
export const DEFAULT_SHEET = '1sVqnrRqbtd0M8IcuYYOlF87zXYC_bPaNSDgpxi6doto';

export function replaceEvents(events) {
  const ins = db.prepare(`INSERT INTO visitor_events(t, vid, type, path, title, ref, secs, org, city, country, email, name, phone, company, form)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  tx(() => {
    db.exec('DELETE FROM visitor_events');
    for (const e of events) {
      ins.run(...[e.t, e.vid, e.type, e.path, e.title, e.ref, e.secs, e.org, e.city, e.country, e.email, e.name, e.phone, e.company, e.form].map((v) => v ?? null));
    }
  });
}

export default {
  id: 'visitors',
  name: 'Company visitors (Website Visitor Log sheet)',
  category: 'Inbound leads',
  docs: 'https://console.cloud.google.com/apis/library/sheets.googleapis.com',
  fields: [
    { key: 'visitors.sheet_id', label: 'Visitor Log sheet ID (already filled in for your sheet)' },
    { key: 'google.service_account_json', label: 'Google service account JSON (same key as GA4; leave blank if already saved there)', secret: true, multiline: true },
  ],
  configured: () => !!getSetting('google.service_account_json'),

  async sync({ from }) {
    const token = await serviceAccountToken('https://www.googleapis.com/auth/spreadsheets.readonly');
    const id = getSetting('visitors.sheet_id') || DEFAULT_SHEET;
    const body = await getJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A:Q`, { headers: { authorization: `Bearer ${token}` } });
    const events = rowsToEvents(body.values || []);
    replaceEvents(events);

    // Daily page views and distinct visitors for the dashboard's charts.
    const days = new Map();
    for (const e of events) {
      if (e.type !== 'view') continue;
      const date = new Date(e.t).toISOString().slice(0, 10);
      if (date < from) continue;
      const d = days.get(date) || { views: 0, vids: new Set() };
      d.views++; d.vids.add(e.vid); days.set(date, d);
    }
    return [...days].flatMap(([date, d]) => [
      { source: 'visitors', metric: 'pageviews', date, value: d.views },
      { source: 'visitors', metric: 'visitors', date, value: d.vids.size },
    ]);
  },
};

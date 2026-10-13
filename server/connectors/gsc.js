import { getSetting } from '../settings.js';
import { serviceAccountToken, getJson } from './google-auth.js';

// Search Console API: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
// Search Console wants either "sc-domain:example.com" or a full URL-prefix property ending in "/".
export function siteUrl(input) {
  const v = String(input || '').trim();
  if (/^sc-domain:/i.test(v)) return v;
  if (/^https?:\/\//i.test(v)) return v.endsWith('/') ? v : `${v}/`;
  return `sc-domain:${v.replace(/^www\./i, '').replace(/\/.*$/, '')}`;
}

export default {
  id: 'gsc',
  name: 'Google Search Console',
  category: 'Search',
  docs: 'https://developers.google.com/webmaster-tools/v1/how-tos/authorizing',
  fields: [
    { key: 'gsc.site_url', label: 'Property (e.g. sc-domain:mccrackenmarketing.com or https://www.example.com/)' },
    { key: 'google.service_account_json', label: 'Google service account JSON (add its email as a user on the property)', secret: true, multiline: true },
  ],
  configured: () => !!(getSetting('gsc.site_url') && getSetting('google.service_account_json')),

  async sync({ from, to }) {
    const token = await serviceAccountToken('https://www.googleapis.com/auth/webmasters.readonly');
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl(getSetting('gsc.site_url')))}/searchAnalytics/query`;
    const query = (dimensions, rowLimit = 25000) => getJson(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: from, endDate: to, dimensions, rowLimit, dataState: 'all' }),
    });
    const rows = [];
    const emit = (r, date, dimType, dim) => {
      rows.push(
        { metric: 'clicks', date, dim_type: dimType, dim, value: r.clicks },
        { metric: 'impressions', date, dim_type: dimType, dim, value: r.impressions },
        // Stored impression-weighted so position can be re-aggregated over any window.
        { metric: 'position_weighted', date, dim_type: dimType, dim, value: r.position * r.impressions },
      );
    };
    for (const r of (await query(['date'])).rows || []) emit(r, r.keys[0], '', '');
    for (const r of (await query(['date', 'query'])).rows || []) emit(r, r.keys[0], 'query', r.keys[1]);
    for (const r of (await query(['date', 'page'])).rows || []) emit(r, r.keys[0], 'page', r.keys[1]);
    return rows;
  },
};

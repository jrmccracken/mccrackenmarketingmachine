import { getSetting } from '../settings.js';
import { serviceAccountToken, getJson } from './google-auth.js';

// GA4 Data API: https://developers.google.com/analytics/devguides/reporting/data/v1
const METRICS = [
  ['sessions', 'sessions'], ['totalUsers', 'users'], ['newUsers', 'new_users'],
  ['engagedSessions', 'engaged_sessions'], ['keyEvents', 'conversions'],
];

export default {
  id: 'ga4',
  name: 'Google Analytics 4',
  category: 'Analytics',
  docs: 'https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart',
  fields: [
    { key: 'ga4.property_id', label: 'GA4 property ID (numbers only)' },
    { key: 'google.service_account_json', label: 'Google service account JSON (shared with Search Console)', secret: true, multiline: true },
  ],
  configured: () => !!(getSetting('ga4.property_id') && getSetting('google.service_account_json')),

  async sync({ from, to }) {
    const token = await serviceAccountToken('https://www.googleapis.com/auth/analytics.readonly');
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${getSetting('ga4.property_id')}:runReport`;
    const run = (dimensions) => getJson(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: METRICS.map(([name]) => ({ name })),
        limit: 100000,
      }),
    });
    const toDate = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    const rows = [];
    const emit = (report, dimType) => {
      for (const r of report.rows || []) {
        const date = toDate(r.dimensionValues[0].value);
        const dim = dimType ? r.dimensionValues[1].value : '';
        METRICS.forEach(([, metric], i) => rows.push({ metric, date, dim_type: dimType, dim, value: Number(r.metricValues[i].value) }));
      }
    };
    emit(await run(['date']), '');
    emit(await run(['date', 'sessionDefaultChannelGroup']), 'channel');
    emit(await run(['date', 'landingPagePlusQueryString']), 'page');
    return rows;
  },
};

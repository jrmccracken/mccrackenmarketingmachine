import { getSetting } from '../settings.js';
import { refreshToken, getJson } from './google-auth.js';

// Google Ads API (REST searchStream): https://developers.google.com/google-ads/api/rest/overview
export default {
  id: 'google_ads',
  name: 'Google Ads',
  category: 'Paid',
  docs: 'https://developers.google.com/google-ads/api/docs/get-started/introduction',
  fields: [
    { key: 'google_ads.customer_id', label: 'Customer ID (no dashes)' },
    { key: 'google_ads.login_customer_id', label: 'Manager (MCC) ID, if accessing through one' },
    { key: 'google_ads.developer_token', label: 'Developer token', secret: true },
    { key: 'google_ads.client_id', label: 'OAuth client ID' },
    { key: 'google_ads.client_secret', label: 'OAuth client secret', secret: true },
    { key: 'google_ads.refresh_token', label: 'OAuth refresh token', secret: true },
    { key: 'google_ads.api_version', label: 'API version (default v22)' },
  ],
  configured: () => ['customer_id', 'developer_token', 'client_id', 'client_secret', 'refresh_token']
    .every((k) => getSetting(`google_ads.${k}`)),

  async sync({ from, to }) {
    const token = await refreshToken({
      clientId: getSetting('google_ads.client_id'),
      clientSecret: getSetting('google_ads.client_secret'),
      refreshToken: getSetting('google_ads.refresh_token'),
    });
    const cid = getSetting('google_ads.customer_id').replace(/-/g, '');
    const version = getSetting('google_ads.api_version') || 'v22';
    const headers = {
      authorization: `Bearer ${token}`,
      'developer-token': getSetting('google_ads.developer_token'),
      'content-type': 'application/json',
    };
    const login = getSetting('google_ads.login_customer_id').replace(/-/g, '');
    if (login) headers['login-customer-id'] = login;

    const query = `SELECT campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.conversions, metrics.conversions_value FROM campaign
      WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status != 'REMOVED'`;
    const batches = await getJson(`https://googleads.googleapis.com/${version}/customers/${cid}/googleAds:searchStream`, {
      method: 'POST', headers, body: JSON.stringify({ query }),
    });

    const totals = new Map();
    const rows = [];
    for (const batch of Array.isArray(batches) ? batches : [batches]) {
      for (const r of batch.results || []) {
        const date = r.segments.date;
        const m = {
          cost: Number(r.metrics.costMicros || 0) / 1e6,
          impressions: Number(r.metrics.impressions || 0),
          clicks: Number(r.metrics.clicks || 0),
          conversions: Number(r.metrics.conversions || 0),
          conv_value: Number(r.metrics.conversionsValue || 0),
        };
        const t = totals.get(date) || {};
        for (const [metric, value] of Object.entries(m)) {
          rows.push({ metric, date, dim_type: 'campaign', dim: r.campaign.name, value });
          t[metric] = (t[metric] || 0) + value;
        }
        totals.set(date, t);
      }
    }
    for (const [date, t] of totals) for (const [metric, value] of Object.entries(t)) rows.push({ metric, date, value });
    return rows;
  },
};

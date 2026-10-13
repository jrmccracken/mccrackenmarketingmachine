import { getSetting } from '../settings.js';
import { getJson } from './google-auth.js';
import { toNumber } from '../csv.js';

// ChatGPT ads (OpenAI). Reporting access is still limited, so this connector reads any JSON endpoint that
// returns daily campaign rows; otherwise use CSV import on the Integrations page with the export from the ads manager.
// Expected row shape (field names are matched loosely):
//   { date, campaign, spend|cost, impressions, clicks, conversions, conversion_value }
// Exports name columns with a currency suffix (spend_gbp, amount_spent_usd), so match on prefix too.
const num = (o, ...k) => {
  for (const key of k) {
    const hit = key in o ? key : Object.keys(o).find((c) => c.startsWith(key + '_'));
    if (hit && o[hit] !== '') { const v = toNumber(o[hit]); if (Number.isFinite(v)) return v; }
  }
  return 0;
};

export default {
  id: 'openai_ads',
  name: 'OpenAI (ChatGPT) Ads',
  category: 'Paid',
  docs: 'https://openai.com/',
  fields: [
    { key: 'openai_ads.report_url', label: 'Reporting endpoint URL, only if OpenAI has given you API access (use {from} and {to} placeholders). Otherwise leave blank and use Import CSV below.' },
    { key: 'openai_ads.api_key', label: 'API key / bearer token', secret: true },
  ],
  configured: () => !!(getSetting('openai_ads.report_url') && getSetting('openai_ads.api_key')),

  async sync({ from, to }) {
    const url = getSetting('openai_ads.report_url').replace('{from}', from).replace('{to}', to);
    const body = await getJson(url, { headers: { authorization: `Bearer ${getSetting('openai_ads.api_key')}` } });
    return adRowsToMetrics(Array.isArray(body) ? body : body.data || body.rows || []);
  },
};

export function adRowsToMetrics(list) {
  const totals = new Map();
  const rows = [];
  for (const r of list) {
    const date = String(r.date || r.day).slice(0, 10);
    const dim = r.campaign || r.campaign_name || r.campaign_title || 'All campaigns';
    const m = {
      cost: num(r, 'spend', 'cost', 'amount_spent'),
      impressions: num(r, 'impressions'),
      clicks: num(r, 'clicks'),
      conversions: num(r, 'conversions', 'total_conversions', 'results'),
      conv_value: num(r, 'conversion_value', 'conversions_value', 'conv_value', 'revenue'),
    };
    const t = totals.get(date) || {};
    for (const [metric, value] of Object.entries(m)) {
      rows.push({ metric, date, dim_type: 'campaign', dim, value });
      t[metric] = (t[metric] || 0) + value;
    }
    totals.set(date, t);
  }
  for (const [date, t] of totals) for (const [metric, value] of Object.entries(t)) rows.push({ metric, date, value });
  return rows;
}

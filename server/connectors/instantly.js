import { getSetting } from '../settings.js';
import { getJson } from './google-auth.js';

// Instantly API v2: https://developer.instantly.ai/
const BASE = 'https://api.instantly.ai/api/v2';
const pick = (o, ...keys) => { for (const k of keys) if (o?.[k] != null) return Number(o[k]); return 0; };

export default {
  id: 'email',
  name: 'Instantly (optional alternative to the pipeline)',
  category: 'Outbound email',
  docs: 'https://developer.instantly.ai/',
  fields: [{ key: 'instantly.api_key', label: 'Instantly API key (v2, analytics read scope)', secret: true }],
  configured: () => !!getSetting('instantly.api_key'),

  async sync({ from, to }) {
    const headers = { authorization: `Bearer ${getSetting('instantly.api_key')}` };
    const rows = [];

    const daily = await getJson(`${BASE}/campaigns/analytics/daily?start_date=${from}&end_date=${to}`, { headers });
    for (const d of Array.isArray(daily) ? daily : daily.items || []) {
      const date = String(d.date).slice(0, 10);
      rows.push(
        { metric: 'sent', date, value: pick(d, 'sent') },
        { metric: 'opens', date, value: pick(d, 'unique_opened', 'opened') },
        { metric: 'replies', date, value: pick(d, 'unique_replies', 'replies') },
        { metric: 'clicks', date, value: pick(d, 'unique_clicks', 'clicks') },
        { metric: 'opportunities', date, value: pick(d, 'opportunities', 'unique_opportunities') },
      );
    }

    // Campaign totals for the window are stored against the window's last day.
    const camps = await getJson(`${BASE}/campaigns/analytics?start_date=${from}&end_date=${to}`, { headers });
    for (const c of Array.isArray(camps) ? camps : camps.items || []) {
      const dim = c.campaign_name || c.campaign_id;
      const m = {
        sent: pick(c, 'emails_sent_count', 'sent'),
        opens: pick(c, 'open_count_unique', 'open_count'),
        replies: pick(c, 'reply_count_unique', 'reply_count'),
        clicks: pick(c, 'link_click_count_unique', 'link_click_count'),
        bounces: pick(c, 'bounced_count'),
        opportunities: pick(c, 'total_opportunities'),
      };
      for (const [metric, value] of Object.entries(m)) rows.push({ metric, date: to, dim_type: 'campaign', dim, value });
      rows.push({ metric: 'bounces', date: to, value: m.bounces });
    }
    return rows;
  },
};

import { getSetting } from '../settings.js';
import { getJson } from './google-auth.js';

// Meta Graph API - Facebook Page insights + Instagram professional account insights.
// Metric names change between Graph versions, so both lists are editable in settings.
const GRAPH = () => `https://graph.facebook.com/${getSetting('meta.api_version') || 'v23.0'}`;

// Our metric name <- possible Meta metric names
const FB_MAP = { impressions: ['page_media_view', 'page_impressions'], engagements: ['page_post_engagements'], followers_gained: ['page_daily_follows_unique', 'page_follows'], clicks: ['page_total_actions'] };
const IG_MAP = { impressions: ['views', 'impressions'], reach: ['reach'], engagements: ['total_interactions', 'accounts_engaged'], followers_gained: ['follower_count'], clicks: ['website_clicks', 'profile_links_taps'] };

async function insights(objectId, map, { from, to, token, extra = '' }) {
  const rows = [];
  for (const [ours, candidates] of Object.entries(map)) {
    for (const metric of candidates) {
      try {
        const until = new Date(Date.parse(to) + 86_400_000).toISOString().slice(0, 10);
        const res = await getJson(`${GRAPH()}/${objectId}/insights?metric=${metric}&period=day&since=${from}&until=${until}${extra}&access_token=${token}`);
        for (const series of res.data || []) {
          for (const v of series.values || []) {
            const value = typeof v.value === 'number' ? v.value : Object.values(v.value || {}).reduce((a, b) => a + Number(b || 0), 0);
            rows.push({ metric: ours, date: String(v.end_time).slice(0, 10), value });
          }
        }
        break; // first candidate that works wins
      } catch { /* try next candidate name */ }
    }
  }
  return rows;
}

export default {
  id: 'meta',
  name: 'Facebook & Instagram (Meta)',
  category: 'Social',
  docs: 'https://developers.facebook.com/docs/graph-api/reference/insights',
  fields: [
    { key: 'meta.page_id', label: 'Facebook Page ID' },
    { key: 'meta.ig_user_id', label: 'Instagram business account ID (optional)' },
    { key: 'meta.access_token', label: 'Long-lived Page access token', secret: true },
    { key: 'meta.api_version', label: 'Graph API version (default v23.0)' },
  ],
  configured: () => !!(getSetting('meta.page_id') && getSetting('meta.access_token')),

  async sync({ from, to }) {
    const token = getSetting('meta.access_token');
    const rows = (await insights(getSetting('meta.page_id'), FB_MAP, { from, to, token })).map((r) => ({ ...r, source: 'facebook' }));
    const ig = getSetting('meta.ig_user_id');
    if (ig) {
      const igRows = await insights(ig, IG_MAP, { from, to, token, extra: '&metric_type=total_value' });
      rows.push(...igRows.map((r) => ({ ...r, source: 'instagram' })));
    }
    return rows;
  },
};

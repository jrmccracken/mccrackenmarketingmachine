import { getSetting } from '../settings.js';
import { getJson } from './google-auth.js';

// LinkedIn Community Management API - organization share + follower statistics.
// https://learn.microsoft.com/linkedin/marketing/community-management/organizations/share-statistics
export default {
  id: 'linkedin',
  name: 'LinkedIn company page',
  category: 'Social',
  docs: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics',
  fields: [
    { key: 'linkedin.organization_id', label: 'Organization ID (number from the admin URL)' },
    { key: 'linkedin.access_token', label: 'Access token (r_organization_social, rw_organization_admin)', secret: true },
    { key: 'linkedin.api_version', label: 'LinkedIn-Version header (YYYYMM, default 202509)' },
  ],
  configured: () => !!(getSetting('linkedin.organization_id') && getSetting('linkedin.access_token')),

  async sync({ from, to }) {
    const org = encodeURIComponent(`urn:li:organization:${getSetting('linkedin.organization_id')}`);
    const headers = {
      authorization: `Bearer ${getSetting('linkedin.access_token')}`,
      'LinkedIn-Version': getSetting('linkedin.api_version') || '202509',
      'X-Restli-Protocol-Version': '2.0.0',
    };
    const start = Date.parse(from + 'T00:00:00Z');
    const end = Date.parse(to + 'T00:00:00Z') + 86_400_000;
    const interval = `(timeRange:(start:${start},end:${end}),timeGranularityType:DAY)`;
    const rows = [];

    const shares = await getJson(`https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${org}&timeIntervals=${interval}`, { headers });
    for (const el of shares.elements || []) {
      const date = new Date(el.timeRange.start).toISOString().slice(0, 10);
      const s = el.totalShareStatistics || {};
      rows.push(
        { metric: 'impressions', date, value: s.impressionCount || 0 },
        { metric: 'engagements', date, value: (s.likeCount || 0) + (s.commentCount || 0) + (s.shareCount || 0) + (s.clickCount || 0) },
        { metric: 'clicks', date, value: s.clickCount || 0 },
      );
    }
    const followers = await getJson(`https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${org}&timeIntervals=${interval}`, { headers });
    for (const el of followers.elements || []) {
      const date = new Date(el.timeRange.start).toISOString().slice(0, 10);
      const g = el.followerGains || {};
      rows.push({ metric: 'followers_gained', date, value: (g.organicFollowerGain || 0) + (g.paidFollowerGain || 0) });
    }
    return rows;
  },
};

const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const gbp2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = {
  n: (v) => (v == null || !isFinite(v) ? '–' : Math.abs(v) >= 10000 ? compact.format(v) : whole.format(v)),
  money: (v) => (v == null || !isFinite(v) ? '–' : Math.abs(v) >= 10000 ? '£' + compact.format(v) : v < 100 ? gbp2.format(v) : gbp.format(v)),
  pct: (v, d = 1) => (v == null || !isFinite(v) ? '–' : `${(v * 100).toFixed(d)}%`),
  pos: (v) => (v == null || !isFinite(v) || !v ? '–' : v.toFixed(1)),
  date: (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '–'),
  dateTime: (s) => (s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–'),
  ago: (s) => {
    if (!s) return '–';
    const m = (Date.now() - new Date(s).getTime()) / 60000;
    if (m < 0) { const d = Math.ceil(-m / 1440); return d <= 1 ? 'tomorrow' : `in ${d}d`; }
    if (m < 60) return `${Math.max(1, Math.round(m))}m ago`;
    if (m < 1440) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  },
};

// How each KPI should be formatted and whether "up" is good.
export const KPI = {
  sent: { label: 'Emails sent', f: fmt.n, up: true },
  opens: { label: 'Opens', f: fmt.n, up: true },
  replies: { label: 'Replies', f: fmt.n, up: true },
  clicks: { label: 'Clicks', f: fmt.n, up: true },
  bounces: { label: 'Bounces', f: fmt.n, up: false },
  opportunities: { label: 'Opportunities', f: fmt.n, up: true },
  open_rate: { label: 'Open rate', f: fmt.pct, up: true },
  reply_rate: { label: 'Reply rate', f: (v) => fmt.pct(v, 2), up: true },
  bounce_rate: { label: 'Bounce rate', f: fmt.pct, up: false },
  click_rate: { label: 'Click rate', f: fmt.pct, up: true },
  impressions: { label: 'Impressions', f: fmt.n, up: true },
  engagements: { label: 'Engagements', f: fmt.n, up: true },
  engagement_rate: { label: 'Engagement rate', f: (v) => fmt.pct(v, 2), up: true },
  followers_gained: { label: 'New followers', f: fmt.n, up: true },
  sessions: { label: 'Sessions', f: fmt.n, up: true },
  users: { label: 'Users', f: fmt.n, up: true },
  new_users: { label: 'New users', f: fmt.n, up: true },
  engaged_sessions: { label: 'Engaged sessions', f: fmt.n, up: true },
  conversions: { label: 'Conversions', f: fmt.n, up: true },
  conversion_rate: { label: 'Conversion rate', f: (v) => fmt.pct(v, 2), up: true },
  ctr: { label: 'CTR', f: (v) => fmt.pct(v, 2), up: true },
  position: { label: 'Avg. position', f: fmt.pos, up: false },
  cost: { label: 'Spend', f: fmt.money, up: null },
  cpc: { label: 'CPC', f: fmt.money, up: false },
  cpa: { label: 'Cost / conversion', f: fmt.money, up: false },
  conv_rate: { label: 'Conv. rate', f: fmt.pct, up: true },
  conv_value: { label: 'Conv. value', f: fmt.money, up: true },
  roas: { label: 'ROAS', f: (v) => (v ? `${v.toFixed(2)}x` : '–'), up: true },
};

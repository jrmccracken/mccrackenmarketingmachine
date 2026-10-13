// Illustrative demo data so the workspace is usable before integrations are connected.
// Every demo metric row is flagged demo=1 and is replaced automatically the first time a live sync succeeds.
import { db, now, tx } from './db.js';
import { writeMetrics, daysAgo, dateRange } from './metrics.js';
import { scoreLead } from './services/outreach.js';

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = (base, spread = 0.25) => Math.max(0, base * (1 + (rand() - 0.5) * 2 * spread));
const weekday = (date) => [0, 6].includes(new Date(date).getUTCDay()) ? 0.35 : 1;
const trend = (i, n, growth) => 1 + growth * (i / n);

export function seedDemoMetrics(days = 90) {
  const from = daysAgo(days), to = daysAgo(1);
  const dates = dateRange(from, to);
  const n = dates.length;
  const out = {};
  const push = (src, row) => (out[src] ||= []).push(row);

  // Outbound email: 3 campaigns, totals per day
  const camps = [
    { name: 'SaaS founders - pipeline audit', sent: 45, open: 0.52, reply: 0.042 },
    { name: 'Manufacturing MDs - trade show follow-up', sent: 35, open: 0.44, reply: 0.018 },
    { name: 'Agency switchers - Q4', sent: 30, open: 0.31, reply: 0.006 },
  ];
  dates.forEach((date, i) => {
    const t = { sent: 0, opens: 0, replies: 0, clicks: 0, bounces: 0, opportunities: 0 };
    for (const c of camps) {
      const sent = Math.round(noise(c.sent * weekday(date)));
      const m = { sent, opens: Math.round(sent * noise(c.open, 0.15)), replies: Math.round(sent * noise(c.reply, 0.6)),
        clicks: Math.round(sent * noise(0.02, 0.5)), bounces: Math.round(sent * noise(0.022, 0.5)) };
      m.opportunities = rand() < m.replies * 0.25 ? 1 : 0;
      for (const [metric, value] of Object.entries(m)) { push('email', { metric, date, dim_type: 'campaign', dim: c.name, value }); t[metric] += value; }
    }
    for (const [metric, value] of Object.entries(t)) push('email', { metric, date, value });
  });

  // Social
  const social = { linkedin: { imp: 1400, eng: 0.045, fol: 6, g: 0.4 }, facebook: { imp: 380, eng: 0.02, fol: 1, g: -0.2 }, instagram: { imp: 650, eng: 0.032, fol: 2, g: 0.1 } };
  for (const [src, s] of Object.entries(social)) dates.forEach((date, i) => {
    const imp = Math.round(noise(s.imp * weekday(date) * trend(i, n, s.g), 0.45));
    // Engagement softens in the last month on Facebook to exercise the recommendation rules.
    const eng = Math.round(imp * noise(s.eng * (src === 'facebook' && i > n - 28 ? 0.6 : 1), 0.3));
    push(src, { metric: 'impressions', date, value: imp });
    push(src, { metric: 'engagements', date, value: eng });
    push(src, { metric: 'clicks', date, value: Math.round(eng * 0.3) });
    push(src, { metric: 'followers_gained', date, value: Math.round(noise(s.fol, 0.8)) });
  });

  // GA4 with channel split
  const channels = { 'Organic Search': 0.42, Direct: 0.2, 'Paid Search': 0.18, 'Organic Social': 0.09, Referral: 0.06, Email: 0.05 };
  dates.forEach((date, i) => {
    const sessions = Math.round(noise(210 * weekday(date) * trend(i, n, 0.15), 0.15));
    const t = { sessions: 0, users: 0, new_users: 0, engaged_sessions: 0, conversions: 0 };
    for (const [ch, share] of Object.entries(channels)) {
      const s = Math.round(sessions * share);
      const m = { sessions: s, users: Math.round(s * 0.82), new_users: Math.round(s * 0.64), engaged_sessions: Math.round(s * noise(0.58, 0.1)),
        conversions: Math.round(s * noise(ch === 'Paid Search' ? 0.022 : 0.012, 0.8)) };
      for (const [metric, value] of Object.entries(m)) { push('ga4', { metric, date, dim_type: 'channel', dim: ch, value }); t[metric] += value; }
    }
    for (const [metric, value] of Object.entries(t)) push('ga4', { metric, date, value });
  });

  // Search Console with queries
  const queries = [
    ['b2b marketing agency', 70, 9.2], ['b2b marketing agency uk', 45, 6.1], ['outbound lead generation agency', 38, 11.4],
    ['saas marketing agency', 52, 14.8], ['mccracken marketing', 12, 1.2], ['linkedin ads agency', 30, 7.5],
    ['google ads for b2b', 26, 4.3], ['chatgpt ads', 60, 18.5], ['manufacturing marketing agency', 22, 5.4], ['cold email agency', 33, 12.9],
  ];
  dates.forEach((date, i) => {
    const t = { clicks: 0, impressions: 0, position_weighted: 0 };
    for (const [q, imp, pos] of queries) {
      const impressions = Math.round(noise(imp * weekday(date) * trend(i, n, 0.3), 0.3));
      const position = noise(pos, 0.08);
      const ctr = position < 2 ? 0.35 : position < 4 ? 0.09 : position < 6 ? 0.018 : position < 11 ? 0.012 : 0.003;
      const clicks = Math.round(impressions * noise(ctr, 0.4));
      push('gsc', { metric: 'clicks', date, dim_type: 'query', dim: q, value: clicks });
      push('gsc', { metric: 'impressions', date, dim_type: 'query', dim: q, value: impressions });
      push('gsc', { metric: 'position_weighted', date, dim_type: 'query', dim: q, value: position * impressions });
      t.clicks += clicks; t.impressions += impressions; t.position_weighted += position * impressions;
    }
    for (const [metric, value] of Object.entries(t)) push('gsc', { metric, date, value });
  });

  // Paid
  const ads = {
    google_ads: [
      { name: 'Search - B2B agency (exact)', cost: 38, cpc: 4.2, cvr: 0.07 },
      { name: 'Search - Lead gen services', cost: 26, cpc: 5.1, cvr: 0.035 },
      { name: 'PMax - Remarketing', cost: 14, cpc: 0.9, cvr: 0 },
    ],
    openai_ads: [
      { name: 'ChatGPT - B2B growth questions', cost: 18, cpc: 2.6, cvr: 0.05 },
      { name: 'ChatGPT - Agency comparison', cost: 9, cpc: 3.1, cvr: 0.02 },
    ],
  };
  for (const [src, list] of Object.entries(ads)) dates.forEach((date, i) => {
    const t = { cost: 0, impressions: 0, clicks: 0, conversions: 0, conv_value: 0 };
    for (const c of list) {
      if (src === 'openai_ads' && i < n - 45) continue; // newer channel
      const cost = noise(c.cost * (weekday(date) > 0.5 ? 1 : 0.6), 0.2);
      const clicks = Math.round(cost / noise(c.cpc, 0.15));
      const conv = rand() < clicks * c.cvr ? Math.max(1, Math.round(clicks * c.cvr)) : 0;
      const m = { cost, impressions: Math.round(clicks / noise(src === 'google_ads' ? 0.045 : 0.012, 0.2)), clicks, conversions: conv, conv_value: conv * 400 };
      for (const [metric, value] of Object.entries(m)) { push(src, { metric, date, dim_type: 'campaign', dim: c.name, value }); t[metric] += value; }
    }
    for (const [metric, value] of Object.entries(t)) push(src, { metric, date, value });
  });

  for (const [src, rows] of Object.entries(out)) {
    const live = db.prepare('SELECT 1 FROM metrics WHERE source = ? AND demo = 0 LIMIT 1').get(src);
    if (!live) writeMetrics(src, rows, { from, to, demo: true });
  }
}

export function seedWorkspace() {
  const ts = now();
  tx(() => {
    if (!db.prepare('SELECT COUNT(*) n FROM templates').get().n) {
      const tpl = db.prepare('INSERT INTO templates(name, subject, body) VALUES (?,?,?)');
      const a = tpl.run('Intro - pipeline audit', '{{company}} pipeline', "Hi {{first_name}},\n\nQuick one: I had a look at how {{company}} generates demand and spotted two things that are probably costing you meetings each month.\n\nWe've fixed the same issues for similar B2B teams, typically adding 8-15 qualified conversations a month.\n\nWould a 15-minute walkthrough be useful?\n\n{{sender_name}}").lastInsertRowid;
      const b = tpl.run('Follow-up 1 - proof', 'Re: {{company}} pipeline', "Hi {{first_name}},\n\nFollowing up with something concrete: for a {{industry}} client we rebuilt their outbound and paid search together and cut cost per lead by 38% in 90 days.\n\nHappy to share the playbook if it's relevant to {{company}}.\n\n{{sender_name}}").lastInsertRowid;
      const c = tpl.run('Follow-up 2 - breakup', 'Close the loop?', "Hi {{first_name}},\n\nI'll assume the timing isn't right. If pipeline becomes a priority later this year, just reply to this email and I'll send over the ideas for {{company}}.\n\n{{sender_name}}").lastInsertRowid;
      db.prepare('INSERT INTO sequences(name, steps) VALUES (?,?)').run('Standard 3-touch (0 / 3 / 8 days)', JSON.stringify([{ day: 0, template_id: a }, { day: 3, template_id: b }, { day: 8, template_id: c }]));
    }
  });
}

export function seedDemoLeads() {
  if (db.prepare('SELECT COUNT(*) n FROM leads').get().n) return;
  const people = [
    ['Sarah', 'Okafor', 'Founder & CEO', 'Ledgerly', 'SaaS', 'replied', 12000],
    ['Tom', 'Reid', 'Marketing Director', 'Hargreaves Engineering', 'Manufacturing', 'meeting', 24000],
    ['Priya', 'Shah', 'Head of Growth', 'Finch Payments', 'Fintech', 'contacted', 18000],
    ['James', 'Whitlock', 'Managing Director', 'Whitlock & Co Solicitors', 'Professional services', 'proposal', 30000],
    ['Emma', 'Lindqvist', 'CMO', 'Northbeam Analytics', 'SaaS', 'new', 20000],
    ['Daniel', 'Murphy', 'Sales Director', 'Apex Fabrication', 'Manufacturing', 'new', 9000],
    ['Hannah', 'Price', 'Head of Marketing', 'Cobalt HR', 'SaaS', 'contacted', 15000],
    ['Oliver', 'Grant', 'Founder', 'Grant Logistics', 'Logistics', 'lost', 8000],
    ['Aisha', 'Bello', 'Marketing Manager', 'Verdant Energy', 'Energy', 'new', 11000],
    ['Mark', 'Ellison', 'CEO', 'Ellison Robotics', 'Manufacturing', 'won', 36000],
  ];
  const ins = db.prepare(`INSERT INTO leads(first_name, last_name, email, company, title, industry, source, stage, value, website, created_at, updated_at, next_follow_up_at, score, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  tx(() => people.forEach(([f, l, title, company, industry, stage, value], i) => {
    const domain = company.toLowerCase().replace(/[^a-z]/g, '') + '.example';
    const created = new Date(Date.now() - (40 - i * 3) * 864e5).toISOString();
    const follow = ['replied', 'meeting', 'proposal', 'contacted'].includes(stage) ? new Date(Date.now() + (i % 3 - 1) * 2 * 864e5).toISOString() : null;
    const lead = { first_name: f, email: `${f.toLowerCase()}@${domain}`, title, industry, stage, website: `https://${domain}` };
    const id = ins.run(f, l, lead.email, company, title, industry, 'Demo data', stage, value, lead.website, created, created, follow, scoreLead(lead), 'Demo lead - delete when you add real ones.').lastInsertRowid;
    db.prepare('INSERT INTO activities(lead_id, type, subject, body, created_at) VALUES (?,?,?,?,?)').run(id, 'note', 'Lead created', 'Added from demo data', created);
  }));
}

export function seedDemoOpportunities() {
  if (db.prepare('SELECT COUNT(*) n FROM opportunities').get().n) return;
  const items = [
    ['pr', 'Journalist request: B2B marketers wanted to comment on ChatGPT advertising', 'Expert comment request for a trade title feature on ads in AI assistants. Deadline Friday.', 88],
    ['pr', 'Call for speakers: B2B Growth Summit 2027 opens submissions', 'Organisers looking for practitioner talks on pipeline, AI search and outbound.', 64],
    ['outbound', 'Ledger startup raises £6m Series A to expand into UK mid-market', 'The SaaS company plans to triple its sales and marketing team over the next year.', 79],
    ['outbound', 'Midlands manufacturer appoints first Marketing Director after record year', 'The engineering group is investing in brand and digital lead generation.', 72],
    ['outbound', 'Fintech scale-up announces rebrand ahead of European expansion', 'New brand identity and website launch planned for Q1.', 58],
    ['pr', 'Podcast seeking guests: agency founders on AI and search', 'Weekly show for B2B marketing leaders, 30-minute remote interviews.', 47],
  ];
  const ins = db.prepare(`INSERT INTO opportunities(kind, source, title, url, summary, published_at, found_at, score, keywords, demo) VALUES (?,?,?,?,?,?,?,?,?,1)`);
  items.forEach(([kind, title, summary, score], i) => ins.run(kind, 'Demo data', title, `https://example.com/demo-opportunity-${i + 1}`, summary,
    new Date(Date.now() - i * 9 * 3600e3).toISOString(), now(), score, kind === 'pr' ? 'expert comment, b2b marketing' : 'funding, saas'));
}

export function clearDemo() {
  tx(() => {
    db.prepare('DELETE FROM metrics WHERE demo = 1').run();
    db.prepare('DELETE FROM opportunities WHERE demo = 1').run();
    db.prepare(`DELETE FROM leads WHERE source = 'Demo data'`).run();
    db.prepare(`DELETE FROM recommendations WHERE status = 'open'`).run();
  });
}

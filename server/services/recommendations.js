import { db, now } from '../db.js';
import { snapshot, campaigns, searchQueries } from './insights.js';
import { daysAgo } from '../metrics.js';
import { ask, aiEnabled, MODEL } from './ai.js';

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const money = (x) => `£${x.toFixed(x < 100 ? 2 : 0)}`;

/**
 * Rule-based recommendations. Every rule is deterministic and cheap, so this runs after every sync.
 * Each recommendation has a stable fingerprint so dismissing it sticks until the underlying issue changes.
 */
export function ruleRecommendations() {
  const snap = snapshot(28);
  const S = snap.sources;
  const recs = [];
  const add = (r) => recs.push(r);
  const from14 = daysAgo(14), to = daysAgo(1);

  // ---------- Outbound email
  if (S.email) {
    const c = S.email.current;
    if (c.sent > 200 && c.bounce_rate > 0.03) add({ fp: 'email:bounce', source: 'email', priority: 'high',
      title: `Bounce rate is ${pct(c.bounce_rate)}: clean your lists before sending more`,
      detail: `Over 3% bounces damages sender reputation across every mailbox you send from. ${Math.round(c.bounces)} bounces out of ${Math.round(c.sent)} sends in the last 28 days.`,
      action: 'Run the remaining contacts through an email verifier, drop catch-alls from cold campaigns and pause the worst-bouncing campaign.',
      impact: 'Protects deliverability for every campaign' });
    if (c.sent > 300 && c.reply_rate < 0.01) add({ fp: 'email:low-reply', source: 'email', priority: 'high',
      title: `Reply rate is only ${pct(c.reply_rate, 2)}: the offer or targeting isn't landing`,
      detail: `Healthy B2B cold email usually gets 2-5% replies. Opens are ${pct(c.open_rate)}, so ${c.open_rate > 0.35 ? 'people are reading it but the message or offer is not compelling' : 'the problem starts at deliverability and subject lines'}.`,
      action: 'Narrow the list to one tight segment, lead with a specific outcome you got a similar client, and A/B test a softer, low-friction CTA.',
      impact: 'Doubling reply rate doubles pipeline from the same send volume' });
    if (S.email.change.open_rate < -0.2 && c.sent > 200) add({ fp: 'email:open-drop', source: 'email', priority: 'medium',
      title: `Open rate fell ${pct(-S.email.change.open_rate, 0)} on the previous 28 days`,
      detail: 'A sudden open-rate drop usually means emails are landing in spam (or tracking pixels are being blocked).',
      action: 'Check SPF/DKIM/DMARC, warm-up status and per-inbox volume; slow each inbox to 30-40 sends a day for a week.',
      impact: 'Recovers reach on all live campaigns' });
    for (const camp of campaigns('email', snap.window.from, to)) {
      if (camp.sent >= 150 && camp.reply_rate >= Math.max(0.03, (c.reply_rate || 0) * 2)) add({ fp: `email:winner:${camp.name}`, source: 'email', priority: 'medium',
        title: `"${camp.name}" is replying at ${pct(camp.reply_rate)}: scale it`,
        detail: `That's well above your ${pct(c.reply_rate)} average across campaigns.`,
        action: 'Add more leads that match this campaign\'s segment and reuse its angle in the weaker campaigns.',
        impact: 'More meetings from proven copy' });
      if (camp.sent >= 200 && camp.replies === 0) add({ fp: `email:dead:${camp.name}`, source: 'email', priority: 'medium',
        title: `"${camp.name}" has ${Math.round(camp.sent)} sends and no replies`,
        detail: 'At this volume, zero replies means the campaign is burning leads and inbox reputation.',
        action: 'Pause it, rewrite the first email around one pain point, and relaunch to a fresh slice of the list.',
        impact: 'Stops wasting leads' });
    }
  }

  // ---------- Paid: Google Ads + ChatGPT Ads
  for (const source of ['google_ads', 'openai_ads']) {
    if (!S[source]) continue;
    const label = S[source].label;
    const c = S[source].current;
    for (const camp of campaigns(source, from14, to)) {
      if (camp.cost > 150 && camp.conversions === 0) add({ fp: `${source}:no-conv:${camp.name}`, source, priority: 'high',
        title: `${label}: "${camp.name}" spent ${money(camp.cost)} in 14 days with no conversions`,
        detail: `${Math.round(camp.clicks)} clicks at ${money(camp.cpc)} CPC and nothing converted.`,
        action: 'Check conversion tracking first, then the search terms report. Add negatives, tighten match types or pause it and move the budget to your best CPA campaign.',
        impact: `Up to ${money(camp.cost * 2)}/month reallocated` });
      if (c.cpa && camp.conversions >= 3 && camp.cpa < c.cpa * 0.6) add({ fp: `${source}:scale:${camp.name}`, source, priority: 'medium',
        title: `${label}: "${camp.name}" converts at ${money(camp.cpa)} CPA, ${pct(1 - camp.cpa / c.cpa, 0)} under your average`,
        detail: 'Cheap conversions are usually limited by budget or impression share.',
        action: 'Raise its daily budget 20-30% and check lost impression share (budget). Keep raising until CPA starts climbing.',
        impact: 'More leads at below-average cost' });
    }
    if (S[source].change.cpa > 0.25 && c.conversions >= 5) add({ fp: `${source}:cpa-up`, source, priority: 'high',
      title: `${label}: cost per conversion rose ${pct(S[source].change.cpa, 0)} to ${money(c.cpa)}`,
      detail: `Previous 28 days: ${money(S[source].previous.cpa)}.`,
      action: 'Look for new broad-match search terms, auction-insight changes and landing page conversion drops. Revert recent bid strategy changes if they line up.',
      impact: 'Brings CPA back to target' });
    if (c.impressions > 2000 && c.ctr < (source === 'google_ads' ? 0.02 : 0.005)) add({ fp: `${source}:low-ctr`, source, priority: 'low',
      title: `${label}: CTR is ${pct(c.ctr, 2)}`,
      detail: 'A low CTR raises CPCs and suggests ads don\'t match intent.',
      action: 'Write new headlines that echo the query and lead with a concrete outcome. Use sitelinks for case studies.',
      impact: 'Lower CPC, more clicks for the same spend' });
  }
  if (S.google_ads && S.openai_ads) {
    const g = S.google_ads.current, o = S.openai_ads.current;
    if (g.conversions >= 3 && o.conversions >= 3) {
      const [better, worse, bl, wl] = g.cpa < o.cpa ? [g, o, 'Google Ads', 'ChatGPT Ads'] : [o, g, 'ChatGPT Ads', 'Google Ads'];
      if (worse.cpa > better.cpa * 1.5) add({ fp: 'paid:shift', source: 'paid', priority: 'medium',
        title: `${bl} converts ${pct(1 - better.cpa / worse.cpa, 0)} cheaper than ${wl}`,
        detail: `${bl} CPA ${money(better.cpa)} vs ${wl} ${money(worse.cpa)} over 28 days.`,
        action: `Move 15-20% of ${wl} budget to ${bl} for two weeks and compare blended CPA.`,
        impact: 'Lower blended cost per lead' });
    }
  }
  if (S.google_ads && !S.openai_ads) add({ fp: 'paid:try-chatgpt', source: 'paid', priority: 'low',
    title: 'Test ChatGPT ads alongside Google Ads',
    detail: 'Buyers increasingly research suppliers in ChatGPT. An early, small test gives you CPA benchmarks before competitors push prices up.',
    action: 'Ring-fence 10% of search budget for a 30-day ChatGPT ads test on your two highest-intent service themes.',
    impact: 'New channel benchmark' });

  // ---------- Search Console
  if (S.gsc) {
    const qs = searchQueries(snap.window.from, to, 500);
    const striking = qs.filter((q) => q.impressions >= 100 && q.position > 4 && q.position <= 15).sort((a, b) => b.impressions - a.impressions).slice(0, 5);
    if (striking.length) add({ fp: `gsc:striking:${striking.map((q) => q.name).join('|')}`, source: 'gsc', priority: 'high',
      title: `${striking.length} queries are close to page one or top three`,
      detail: striking.map((q) => `"${q.name}": position ${q.position.toFixed(1)}, ${Math.round(q.impressions)} impressions`).join('; '),
      action: 'For each: strengthen the ranking page with a dedicated section answering the query, add internal links from related pages and refresh the title tag to include the phrase.',
      impact: 'Moving from position 8 to 3 typically triples clicks' });
    const lowCtr = qs.filter((q) => q.impressions >= 200 && q.position <= 5 && q.ctr < 0.03).slice(0, 5);
    if (lowCtr.length) add({ fp: `gsc:lowctr:${lowCtr.map((q) => q.name).join('|')}`, source: 'gsc', priority: 'medium',
      title: `${lowCtr.length} top-5 quer${lowCtr.length > 1 ? "ies have" : "y has"} under 3% CTR`,
      detail: lowCtr.map((q) => `"${q.name}": ${pct(q.ctr)} CTR at position ${q.position.toFixed(1)}`).join('; '),
      action: 'Rewrite title tags and meta descriptions to promise a specific outcome. Add FAQ or review schema where it fits.',
      impact: 'More clicks without ranking changes' });
    if (S.gsc.change.clicks < -0.2 && S.gsc.previous.clicks > 50) add({ fp: 'gsc:clicks-drop', source: 'gsc', priority: 'high',
      title: `Organic clicks are down ${pct(-S.gsc.change.clicks, 0)}`,
      detail: `${Math.round(S.gsc.current.clicks)} clicks vs ${Math.round(S.gsc.previous.clicks)} in the previous 28 days.`,
      action: 'Compare pages in Search Console to find which pages lost clicks, check for indexing issues, and see whether AI Overviews now answer those queries.',
      impact: 'Recovers organic pipeline' });
  }

  // ---------- Website
  if (S.ga4) {
    const c = S.ga4.current;
    if (S.ga4.change.sessions < -0.2 && S.ga4.previous.sessions > 200) add({ fp: 'ga4:traffic-drop', source: 'ga4', priority: 'high',
      title: `Website sessions fell ${pct(-S.ga4.change.sessions, 0)}`,
      detail: `${Math.round(c.sessions)} sessions vs ${Math.round(S.ga4.previous.sessions)} in the previous 28 days.`,
      action: 'Break it down by channel on the Website page to find where the drop came from (organic, paid or referral) and fix that channel first.',
      impact: 'Restores top-of-funnel' });
    if (c.sessions > 500 && c.conversion_rate < 0.01) add({ fp: 'ga4:low-cvr', source: 'ga4', priority: 'medium',
      title: `Only ${pct(c.conversion_rate, 2)} of sessions convert`,
      detail: 'B2B service sites usually convert 1.5-3% of sessions into an enquiry.',
      action: 'Add a clear primary CTA above the fold on service pages, a lower-commitment offer (audit, teardown, benchmark) and social proof near every form.',
      impact: 'More leads from the traffic you already have' });
    if (S.ga4.change.conversions > 0.2 && c.conversions >= 10) add({ fp: 'ga4:conv-up', source: 'ga4', priority: 'low',
      title: `Website conversions are up ${pct(S.ga4.change.conversions, 0)}`,
      detail: 'Find what changed (new page, campaign or post) so you can do more of it.',
      action: 'Check the landing-page breakdown for the pages driving the lift and push more traffic to them.',
      impact: 'Compounds a win' });
  }

  // ---------- Social
  for (const source of ['linkedin', 'facebook', 'instagram']) {
    if (!S[source]) continue;
    const s = S[source];
    if (s.change.engagement_rate < -0.25 && s.previous.impressions > 1000) add({ fp: `${source}:eng-drop`, source, priority: 'medium',
      title: `${s.label} engagement rate fell ${pct(-s.change.engagement_rate, 0)}`,
      detail: `Now ${pct(s.current.engagement_rate, 2)} (was ${pct(s.previous.engagement_rate, 2)}).`,
      action: 'Post more native formats (document carousels, short video, opinion posts from a named person) and fewer link posts.',
      impact: 'Reach recovers when engagement does' });
    if (s.current.impressions < s.previous.impressions * 0.7 && s.previous.impressions > 1000) add({ fp: `${source}:reach-drop`, source, priority: 'low',
      title: `${s.label} impressions down ${pct(1 - s.current.impressions / s.previous.impressions, 0)}`,
      detail: 'Usually a posting-frequency problem.',
      action: 'Get back to 3-4 posts a week and have the team engage in the first hour after posting.',
      impact: 'Restores reach' });
  }
  if (S.linkedin && S.linkedin.current.engagement_rate > 0.04) add({ fp: 'linkedin:repurpose', source: 'linkedin', priority: 'low',
    title: `LinkedIn engagement is strong at ${pct(S.linkedin.current.engagement_rate, 1)}: reuse it in outbound`,
    detail: 'Posts that perform well on LinkedIn make strong cold-email hooks and ad creatives.',
    action: 'Take the top two posts this month and turn them into a cold email opener and a paid social ad.',
    impact: 'Cheaper creative testing' });

  // ---------- Pipeline hygiene
  const overdue = db.prepare(`SELECT COUNT(*) n FROM leads WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at < ? AND stage NOT IN ('won','lost')`).get(now()).n;
  if (overdue) add({ fp: `leads:overdue:${overdue}`, source: 'leads', priority: 'high',
    title: `${overdue} lead follow-up${overdue > 1 ? 's are' : ' is'} overdue`,
    detail: 'Most deals are lost to slow follow-up, not to competitors.',
    action: 'Open Leads → "Follow-up due" and clear the list today, starting with the highest score.',
    impact: 'Saves warm pipeline' });
  const stale = db.prepare(`SELECT COUNT(*) n FROM leads WHERE stage IN ('replied','meeting','proposal') AND updated_at < ?`).get(new Date(Date.now() - 14 * 864e5).toISOString()).n;
  if (stale) add({ fp: `leads:stale:${stale}`, source: 'leads', priority: 'medium',
    title: `${stale} active deal${stale > 1 ? 's have' : ' has'} had no activity for 14+ days`,
    detail: 'Leads in replied/meeting/proposal stages go cold quickly.',
    action: 'Send a short, useful nudge: a relevant case study, a benchmark or a specific idea for their business.',
    impact: 'Revives stalled deals' });
  // Website enquiries (Netlify Forms) that nobody has answered yet.
  const unanswered = db.prepare(`SELECT COUNT(*) n, MIN(created_at) oldest FROM leads
    WHERE external_id LIKE 'netlify:%' AND stage = 'new' AND last_contacted_at IS NULL`).get();
  if (unanswered.n) add({ fp: `forms:unanswered:${unanswered.n}`, source: 'leads', priority: 'high',
    title: `${unanswered.n} website enquir${unanswered.n > 1 ? 'ies are' : 'y is'} waiting for a reply`,
    detail: `The oldest came in ${Math.max(0, Math.round((Date.now() - Date.parse(unanswered.oldest)) / 864e5))} day(s) ago. Inbound leads go cold within hours, not days.`,
    action: 'Open Leads, search "inbound", and reply to each one today. Log the reply on the lead so it drops off this list.',
    impact: 'Your warmest leads, converted' });
  // Lead pipeline: Gmail drafts written by the Monday research run that haven't gone out yet.
  const waiting = db.prepare(`SELECT COUNT(*) n, SUM(fit = 'A') a FROM leads WHERE pipeline_status = 'Drafted' AND created_at < ?`)
    .get(new Date(Date.now() - 2 * 864e5).toISOString());
  if (waiting.n) add({ fp: `pipeline:drafted:${waiting.n}`, source: 'email', priority: waiting.a ? 'high' : 'medium',
    title: `${waiting.n} pipeline email${waiting.n > 1 ? 's are' : ' is'} drafted in Gmail but not sent${waiting.a ? ` (${waiting.a} fit A)` : ''}`,
    detail: 'Trigger-based emails lose their hook within a couple of weeks of the news they mention.',
    action: 'Open Gmail drafts and schedule two or three a day, fit A first. Then mark each one Sent in the Lead pipeline and re-import.',
    impact: 'Turns this week\'s research into conversations' });
  const cold = db.prepare(`SELECT COUNT(*) n FROM leads WHERE pipeline_status = 'Sent' AND last_contacted_at < ?`)
    .get(new Date(Date.now() - 14 * 864e5).toISOString()).n;
  if (cold) add({ fp: `pipeline:cold:${cold}`, source: 'email', priority: 'low',
    title: `${cold} pipeline lead${cold > 1 ? 's have' : ' has'} had no reply for 14+ days`,
    detail: 'After a first email and a follow-up, more chasing rarely helps and can annoy.',
    action: 'Move them to Parked in the Lead pipeline and revisit when they have new news.',
    impact: 'Keeps the pipeline honest' });
  const drafts = db.prepare(`SELECT COUNT(*) n FROM outbox WHERE status = 'draft'`).get().n;
  if (drafts) add({ fp: `outbox:drafts:${drafts}`, source: 'leads', priority: 'medium',
    title: `${drafts} outreach email${drafts > 1 ? 's are' : ' is'} waiting for your approval`,
    detail: 'Sequence emails are held for review before they send.',
    action: 'Open Outreach → Approval queue, review and approve.',
    impact: 'Keeps sequences on schedule' });
  const hot = db.prepare(`SELECT COUNT(*) n FROM opportunities WHERE status = 'new' AND score >= 60`).get().n;
  if (hot) add({ fp: `radar:hot:${hot}`, source: 'radar', priority: 'medium',
    title: `${hot} high-scoring PR/outbound opportunit${hot > 1 ? 'ies' : 'y'} on the Market Radar`,
    detail: 'Timely opportunities lose value fast. Journalist requests often close within 24-48 hours.',
    action: 'Review the Market Radar, and draft a pitch or add the company as a lead.',
    impact: 'Earned media and warm outbound' });
  return recs;
}

const upsert = () => db.prepare(`INSERT INTO recommendations(fingerprint, source, priority, title, detail, action, impact, origin, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(fingerprint) DO UPDATE SET priority=excluded.priority, title=excluded.title, detail=excluded.detail,
    action=excluded.action, impact=excluded.impact, updated_at=excluded.updated_at`);

/** Regenerate rule-based recommendations; open ones that no longer apply are retired. */
export function refreshRecommendations() {
  const recs = ruleRecommendations();
  const stmt = upsert();
  const ts = now();
  for (const r of recs) stmt.run(r.fp, r.source, r.priority, r.title, r.detail, r.action || '', r.impact || '', 'rules', ts, ts);
  const fps = recs.map((r) => r.fp);
  const placeholders = fps.map(() => '?').join(',') || "''";
  db.prepare(`DELETE FROM recommendations WHERE origin = 'rules' AND status = 'open' AND fingerprint NOT IN (${placeholders})`).run(...fps);
  return recs.length;
}

/** AI strategist: reads the whole snapshot + pipeline and writes a weekly plan plus extra recommendations. */
export async function aiBrief() {
  if (!aiEnabled()) throw new Error('Add an Anthropic API key in Settings to enable the AI strategist.');
  const snap = snapshot(28);
  const to = daysAgo(1);
  const context = {
    window: snap.window,
    channels: Object.fromEntries(Object.entries(snap.sources).map(([k, v]) => [k, {
      label: v.label, demo_data: v.demo, current: round(v.current), previous: round(v.previous),
    }])),
    top_email_campaigns: snap.sources.email ? campaigns('email', snap.window.from, to).slice(0, 8).map(round) : [],
    google_ads_campaigns: snap.sources.google_ads ? campaigns('google_ads', snap.window.from, to).slice(0, 8).map(round) : [],
    chatgpt_ads_campaigns: snap.sources.openai_ads ? campaigns('openai_ads', snap.window.from, to).slice(0, 8).map(round) : [],
    top_search_queries: snap.sources.gsc ? searchQueries(snap.window.from, to, 25).map(round) : [],
    pipeline: db.prepare(`SELECT stage, COUNT(*) n, SUM(value) value FROM leads GROUP BY stage`).all(),
    open_opportunities: db.prepare(`SELECT kind, title, score FROM opportunities WHERE status IN ('new','saved') ORDER BY score DESC LIMIT 10`).all(),
    existing_recommendations: db.prepare(`SELECT title FROM recommendations WHERE status = 'open'`).all().map((r) => r.title),
  };
  const schema = {
    type: 'object', additionalProperties: false, required: ['brief', 'recommendations'],
    properties: {
      brief: { type: 'string', description: 'Markdown weekly brief: headline, what is working, what is not, and the plan for this week.' },
      recommendations: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['source', 'priority', 'title', 'detail', 'action', 'impact'],
        properties: {
          source: { type: 'string', enum: ['email', 'linkedin', 'facebook', 'instagram', 'ga4', 'gsc', 'google_ads', 'openai_ads', 'paid', 'leads', 'radar', 'strategy'] },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' }, detail: { type: 'string' }, action: { type: 'string' }, impact: { type: 'string' },
        },
      } },
    },
  };
  const out = await ask({
    system: 'You are the head of growth for a B2B marketing agency, reviewing the agency\'s own marketing. Be specific and quantitative, cite the numbers you were given, and prioritise ruthlessly: what one person can do this week for the most pipeline. Do not repeat the existing recommendations. If a channel is marked demo_data, say the numbers are illustrative.',
    prompt: `Here is this week's data as JSON. Write the weekly brief and 3-6 new recommendations.\n\n${JSON.stringify(context)}`,
    effort: 'high',
    schema,
  });
  const ts = now();
  db.prepare('INSERT INTO briefs(created_at, body, model) VALUES (?,?,?)').run(ts, out.brief, MODEL);
  const stmt = upsert();
  for (const r of out.recommendations) {
    stmt.run(`ai:${ts}:${r.title}`, r.source, r.priority, r.title, r.detail, r.action, r.impact, 'ai', ts, ts);
  }
  return out;
}

function round(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1000) / 1000 : v]));
}

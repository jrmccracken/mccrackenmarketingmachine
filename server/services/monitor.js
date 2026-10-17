import { XMLParser } from 'fast-xml-parser';
import { db, now } from '../db.js';
import { getSetting, listSetting } from '../settings.js';
import { ask, aiEnabled } from './ai.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

// Phrases that usually mean "a journalist / publication wants input" or "a company just hit a buying trigger".
const PR_SIGNALS = ['journorequest', 'journalist request', 'looking for experts', 'seeking comment', 'call for experts', 'expert comment', 'call for speakers', 'award entries', 'podcast guests', 'contributors wanted', 'write for us'];
const OUTBOUND_SIGNALS = ['raises', 'raised', 'funding', 'series a', 'series b', 'seed round', 'appoints', 'hires', 'hiring', 'new cmo', 'marketing director', 'head of marketing', 'rebrand', 'launches', 'expands', 'acquires', 'acquisition', 'opens new office'];

export function googleNewsUrl(q) {
  const region = getSetting('monitor.region') || 'GB';
  const lang = region === 'US' ? 'en-US' : `en-${region}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=${lang}&gl=${region}&ceid=${region}:en`;
}

function strip(html = '') {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

export function parseFeed(xml) {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  return (Array.isArray(items) ? items : [items]).map((it) => ({
    title: strip(typeof it.title === 'object' ? it.title['#text'] : it.title),
    url: typeof it.link === 'object' ? (Array.isArray(it.link) ? it.link[0].href : it.link.href) : it.link,
    summary: strip(it.description || it.summary || it.content || '').slice(0, 600),
    published_at: it.pubDate || it.published || it.updated || null,
    publisher: typeof it.source === 'object' ? it.source['#text'] : it.source,
  })).filter((i) => i.title && i.url);
}

/** Score 0-100: keyword matches, buying/PR signal strength, ICP fit and recency. */
export function scoreItem(item, { kindHint, keywords }) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const matched = keywords.filter((k) => text.includes(k.toLowerCase()));
  const pr = PR_SIGNALS.filter((s) => text.includes(s));
  const ob = OUTBOUND_SIGNALS.filter((s) => text.includes(s));
  const icp = listSetting('monitor.icp_terms').filter((t) => text.includes(t.toLowerCase()));
  const kind = kindHint !== 'auto' ? kindHint : (pr.length >= ob.length && pr.length ? 'pr' : ob.length ? 'outbound' : 'pr');
  const ageDays = item.published_at ? (Date.now() - Date.parse(item.published_at)) / 864e5 : 3;
  let score = 15 + matched.length * 12 + (kind === 'pr' ? pr.length : ob.length) * 14 + icp.length * 8;
  score -= Math.max(0, Math.min(25, (ageDays - 1) * 4));
  return { kind, score: Math.max(0, Math.min(100, Math.round(score))), keywords: [...new Set([...matched, ...pr, ...ob, ...icp])] };
}

/** Bing News RSS for the same search, used when Google News refuses a request (it sometimes blocks cloud servers). */
export function bingNewsUrl(q) {
  const region = getSetting('monitor.region') || 'GB';
  return `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=en-${region}&cc=${region}&qft=interval%3d%228%22`;
}

export async function fetchFeed(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (McCracken Marketing Machine; RSS monitor)' } });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return parseFeed(await res.text());
}

/** Queries built from settings plus any custom feeds the user added. */
export function monitorQueries() {
  const out = [];
  for (const kw of listSetting('monitor.pr_keywords')) out.push({ name: `News: ${kw}`, url: googleNewsUrl(`"${kw}"`), fallback: bingNewsUrl(`"${kw}"`), kind: 'pr', keywords: [kw] });
  for (const kw of listSetting('monitor.outbound_keywords')) out.push({ name: `News: ${kw}`, url: googleNewsUrl(kw), fallback: bingNewsUrl(kw), kind: 'outbound', keywords: [kw] });
  for (const f of db.prepare('SELECT * FROM feeds WHERE enabled = 1').all()) out.push({ name: f.name, url: f.url, kind: f.kind, keywords: [] });
  return out;
}

export async function runMonitor() {
  const insert = db.prepare(`INSERT OR IGNORE INTO opportunities(kind, source, title, url, summary, published_at, found_at, score, keywords)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const allKeywords = [...listSetting('monitor.pr_keywords'), ...listSetting('monitor.outbound_keywords')];
  const queries = monitorQueries();
  let added = 0, found = 0, ok = 0;
  const errors = [];
  for (const q of queries) {
    try {
      let items;
      try { items = await fetchFeed(q.url); } catch (err) {
        if (!q.fallback) throw err;
        items = await fetchFeed(q.fallback);
      }
      ok++;
      found += items.length;
      for (const item of items.slice(0, 30)) {
        const s = scoreItem(item, { kindHint: q.kind, keywords: [...q.keywords, ...allKeywords] });
        if (s.score < 20) continue;
        const parsed = item.published_at ? new Date(item.published_at) : null;
        const published = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
        const r = insert.run(s.kind, item.publisher || q.name, item.title, item.url, item.summary, published, now(), s.score, s.keywords.join(', '));
        added += r.changes;
      }
    } catch (err) {
      errors.push(`${q.name}: ${err.cause?.code || err.cause?.message || err.message}`);
    }
  }
  // Real results replace the demo examples.
  if (ok) db.prepare('DELETE FROM opportunities WHERE demo = 1').run();
  // Keep the radar lean: drop untouched items older than 30 days.
  db.prepare(`DELETE FROM opportunities WHERE status IN ('new','dismissed') AND found_at < ?`).run(new Date(Date.now() - 30 * 864e5).toISOString());
  const result = { at: now(), added, found, sources: queries.length, failed: errors.length, errors: errors.slice(0, 10) };
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('state.monitor_last_scan', JSON.stringify(result));
  return result;
}

export function lastScan() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'state.monitor_last_scan'`).get();
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}

/** Draft a pitch (PR) or first-touch email (outbound) for an opportunity. */
export async function draftForOpportunity(opp) {
  if (!aiEnabled()) {
    return opp.kind === 'pr'
      ? `Hi,\n\nI saw "${opp.title}". I run ${getSetting('company.name')}, a B2B marketing agency, and can give you a sharp, quotable view on this from what we see across our clients.\n\nHappy to send 150 words today. What's your deadline?\n\nThanks,\n${getSetting('sender.name')}`
      : `Hi {{first_name}},\n\nCongrats on the news: "${opp.title}".\n\nMoments like this usually come with a push for pipeline. We help B2B teams like yours turn that into predictable demand through ${getSetting('company.services').toLowerCase()}.\n\nWorth a 20-minute chat to compare notes?\n\n${getSetting('sender.name')}`;
  }
  return ask({
    system: opp.kind === 'pr'
      ? 'You write short, high-signal pitches to journalists and editors on behalf of a B2B marketing agency. Lead with the angle, offer a specific insight, keep it under 140 words, no fluff. Output only the email (subject line first as "Subject: ...").'
      : 'You write short, personalised cold emails for a B2B marketing agency. Reference the trigger event naturally, make one relevant point about how it affects their marketing, and end with a low-friction question. Under 110 words. Use {{first_name}} for the name. Output only the email (subject line first as "Subject: ...").',
    prompt: `Opportunity: ${opp.title}\nSource: ${opp.source}\nURL: ${opp.url}\nSummary: ${opp.summary || '(none)'}`,
    effort: 'low',
    maxTokens: 4000,
  });
}

// Company visitor intelligence: which organisations are reading the website, how keenly, and who has identified
// themselves through a form. Scoring mirrors the "McCracken Visitor Insights" page so both agree.
import { db } from '../db.js';

const RULES = [
  { re: /\/contact|\/book|\/enquir/i, label: 'Contact', pts: 25 },
  { re: /\/(services|fractional|interim|pricing|packages|work-with|consult)/i, label: 'Services', pts: 10 },
  { re: /\/(case-stud|clients|results|testimonials|work\/)/i, label: 'Case studies', pts: 8 },
  { re: /\/about/i, label: 'About', pts: 5 },
  { re: /\/(blog|insights|news|articles|resources)/i, label: 'Content', pts: 2 },
];
export const rule = (p) => RULES.find((r) => r.re.test(p)) || { label: 'Other', pts: 1 };
export const band = (s) => (s >= 60 ? 'High' : s >= 25 ? 'Medium' : 'Low');

// Home broadband, mobile and cloud/VPN networks say nothing about the visitor's employer.
const ISP = /british telecom|\bbt\b|virgin media|\bsky\b|talktalk|vodafone|\bee\b|everything everywhere|hutchison|three uk|telefonica|\bo2\b|plusnet|hyperoptic|community fibre|zen internet|kcom|gigaclear|cityfibre|trooli|brsk|toob|youfibre|lit fibre|giganet|truespeed|starlink|spacex|comcast|verizon|at&t|t-mobile|charter|deutsche telekom|orange|bouygues|broadband|mobile|telecom|cable|wireless|fibre|fiber/i;
const CLOUD = /amazon|aws|google|microsoft|azure|digitalocean|\bovh|hetzner|cloudflare|linode|akamai|fastly|apple|oracle|alibaba|tencent|vultr|choopa|leaseweb|m247|datacamp|cdn77|nord|expressvpn|proton|mullvad|private internet|hosting|datacent|data cent|server|zscaler|netskope|iboss|forcepoint/i;
export const orgName = (o) => String(o || '').replace(/^AS\d+\s+/i, '').trim();
export const orgKind = (o) => (!o ? 'none' : CLOUD.test(o) ? 'cloud' : ISP.test(o) ? 'isp' : 'business');

/** Rows from the sheet (header + values) -> events. */
export function rowsToEvents(rows) {
  if (!rows?.length) return [];
  const h = rows[0].map((x) => String(x).trim().toLowerCase());
  const out = [];
  for (const row of rows.slice(1)) {
    const g = (n) => { const k = h.indexOf(n); return k < 0 ? '' : String(row[k] ?? '').replace(/^'/, ''); };
    const t = Date.parse(g('time'));
    if (!t || !g('visitor_id')) continue;
    out.push({ t, vid: g('visitor_id'), type: g('type'), path: g('path') || '/', title: g('title'), ref: g('referrer'),
      secs: Number(g('seconds')) || 0, org: g('organisation'), city: g('city'), country: g('country'),
      email: g('email').toLowerCase(), name: g('name'), phone: g('phone'), company: g('company'), form: g('form') });
  }
  return out.sort((a, b) => a.t - b.t);
}

function buildVisitors(events) {
  const map = new Map();
  for (const e of events) {
    let v = map.get(e.vid);
    if (!v) { v = { vid: e.vid, first: e.t, last: 0, sessions: 0, pvs: [], org: '', city: '', country: '', id: null }; map.set(e.vid, v); }
    if (e.type === 'view') {
      if (!v.sessions || e.t - v.last > 30 * 60000) v.sessions++;
      v.pvs.push({ t: e.t, path: e.path, title: e.title, secs: 0 });
      if (e.org) { v.org = e.org; v.city = e.city; v.country = e.country; }
    } else if (e.type === 'dwell') {
      for (let i = v.pvs.length - 1; i >= 0; i--) if (v.pvs[i].path === e.path) { v.pvs[i].secs = Math.min(3600, v.pvs[i].secs + e.secs); break; }
    } else if (e.type === 'identify' && e.email) {
      v.id = { email: e.email, name: e.name, phone: e.phone, company: e.company, form: e.form };
    }
    v.last = Math.max(v.last, e.t);
  }
  return [...map.values()].filter((v) => v.pvs.length);
}

function score(v, now) {
  const per = {};
  let pts = 0;
  for (const p of v.pvs) {
    per[p.path] = (per[p.path] || 0) + 1;
    if (per[p.path] <= 2) pts += rule(p.path).pts;
    if (p.secs >= 60) pts += 3;
  }
  pts += Math.max(0, v.sessions - 1) * 10;
  if (v.id) pts += 100;
  const days = (now - v.last) / 864e5;
  return Math.round(pts * (days > 90 ? 0.25 : days > 30 ? 0.5 : 1));
}

function topPages(pvs) {
  const m = new Map();
  for (const p of pvs) {
    const c = m.get(p.path) || { path: p.path, title: p.title, views: 0, secs: 0, label: rule(p.path).label, hot: rule(p.path).pts >= 10 };
    c.views++; c.secs += p.secs; m.set(p.path, c);
  }
  return [...m.values()].sort((a, b) => rule(b.path).pts - rule(a.path).pts || b.views - a.views).slice(0, 6);
}

/** Organisations and identified people for the last `days`, highest intent first. */
export function visitorInsights(days = 90, now = Date.now()) {
  const events = db.prepare('SELECT * FROM visitor_events WHERE t >= ? ORDER BY t').all(now - days * 864e5);
  const vs = buildVisitors(events);
  const orgs = new Map();
  const people = [];
  let unresolved = 0, visits = 0;
  const leadByCompany = new Map(db.prepare(`SELECT id, lower(company) c FROM leads WHERE company IS NOT NULL`).all().map((l) => [l.c, l.id]));
  const leadByEmail = new Map(db.prepare(`SELECT id, lower(email) e FROM leads WHERE email IS NOT NULL`).all().map((l) => [l.e, l.id]));

  for (const v of vs) {
    const s = score(v, now);
    visits += v.sessions;
    const name = orgName(v.org), kind = orgKind(name);
    if (v.id) people.push({ ...v.id, score: s, band: band(s), visits: v.sessions, pages: v.pvs.length, first: v.first, last: v.last,
      org: kind === 'business' ? name : '', top: topPages(v.pvs), leadId: leadByEmail.get(v.id.email) || null });
    if (kind !== 'business') { if (!v.id) unresolved++; continue; }
    const key = name.toLowerCase();
    const o = orgs.get(key) || { name, city: v.city, country: v.country, people: 0, visits: 0, pages: 0, first: v.first, last: 0, best: 0, pvs: [], contacts: [] };
    o.people++; o.visits += v.sessions; o.pages += v.pvs.length;
    o.first = Math.min(o.first, v.first); o.last = Math.max(o.last, v.last); o.best = Math.max(o.best, s);
    o.pvs.push(...v.pvs);
    if (v.id) o.contacts.push(v.id);
    orgs.set(key, o);
  }
  const list = [...orgs.values()].map((o) => {
    const scoreAll = o.best + Math.max(0, o.people - 1) * 8;
    const recent = [...o.pvs].sort((a, b) => b.t - a.t).slice(0, 15);
    const leadId = leadByCompany.get(o.name.toLowerCase()) || [...leadByCompany].find(([c]) => c && (o.name.toLowerCase().includes(c) || c.includes(o.name.toLowerCase())))?.[1] || null;
    return { name: o.name, city: o.city, country: o.country, people: o.people, visits: o.visits, pages: o.pages, first: o.first, last: o.last,
      contacts: o.contacts, score: scoreAll, band: band(scoreAll), top: topPages(o.pvs), recent, leadId };
  }).sort((a, b) => b.score - a.score || b.last - a.last);
  people.sort((a, b) => b.score - a.score || b.last - a.last);
  return {
    orgs: list, people, visitors: vs.length, visits, unresolved,
    high: list.filter((o) => o.band === 'High').length,
    totalEvents: db.prepare('SELECT COUNT(*) n FROM visitor_events').get().n,
  };
}

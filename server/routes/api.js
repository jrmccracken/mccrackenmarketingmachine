import express from 'express';
import { db, now, tx } from '../db.js';
import { allSettings, setSettings, getSetting } from '../settings.js';
import { connectors, connectorById, SOURCES } from '../connectors/index.js';
import { adRowsToMetrics } from '../connectors/openai-ads.js';
import { series, breakdown, daysAgo, sourceInfo, writeMetrics } from '../metrics.js';
import { snapshot, campaigns, searchQueries, searchPages, derive } from '../services/insights.js';
import { refreshRecommendations, aiBrief } from '../services/recommendations.js';
import { runMonitor, draftForOpportunity, googleNewsUrl } from '../services/monitor.js';
import { syncConnector, syncAll, lastRuns } from '../services/sync.js';
import { STAGES, scoreLead, logActivity, queueEmail, flushOutbox, runSequences, enroll, draftEmail, render, sentToday } from '../services/outreach.js';
import { aiEnabled, MODEL } from '../services/ai.js';
import { smtpConfigured } from '../services/mailer.js';
import { jobState } from '../services/scheduler.js';
import { parseCsv, withIsoDates, toNumber, socialMetrics } from '../csv.js';
import { importPipeline, pipelineStatus } from '../services/pipeline.js';
import { clearDemo, seedDemoMetrics, seedDemoLeads, seedDemoOpportunities, seedWorkspace } from '../demo.js';

export const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const window = (req) => {
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 28));
  return { days, from: daysAgo(days), to: daysAgo(1) };
};

// Which metrics each source charts, in order of importance.
const SOURCE_METRICS = {
  forms: ['enquiries'],
  email: ['prospects', 'sent', 'opens', 'replies', 'clicks', 'bounces', 'opportunities'],
  linkedin: ['impressions', 'engagements', 'clicks', 'followers_gained'],
  facebook: ['impressions', 'engagements', 'clicks', 'followers_gained'],
  instagram: ['impressions', 'engagements', 'clicks', 'followers_gained'],
  ga4: ['sessions', 'users', 'new_users', 'engaged_sessions', 'conversions'],
  gsc: ['clicks', 'impressions', 'position_weighted'],
  google_ads: ['cost', 'impressions', 'clicks', 'conversions', 'conv_value'],
  openai_ads: ['cost', 'impressions', 'clicks', 'conversions', 'conv_value'],
};
const HEADLINE = { forms: 'enquiries', email: 'replies', linkedin: 'impressions', facebook: 'impressions', instagram: 'impressions', ga4: 'sessions', gsc: 'clicks', google_ads: 'conversions', openai_ads: 'conversions' };

// ---------------------------------------------------------------- status & overview
api.get('/status', (req, res) => {
  res.json({
    company: getSetting('company.name'),
    ai: aiEnabled(), model: MODEL, smtp: smtpConfigured(),
    demo: !!db.prepare('SELECT 1 FROM metrics WHERE demo = 1 LIMIT 1').get(),
    jobs: jobState,
    counts: {
      recommendations: db.prepare(`SELECT COUNT(*) n FROM recommendations WHERE status='open'`).get().n,
      opportunities: db.prepare(`SELECT COUNT(*) n FROM opportunities WHERE status='new'`).get().n,
      drafts: db.prepare(`SELECT COUNT(*) n FROM outbox WHERE status='draft'`).get().n,
      due: db.prepare(`SELECT COUNT(*) n FROM leads WHERE next_follow_up_at <= ? AND stage NOT IN ('won','lost')`).get(now()).n,
    },
  });
});

api.get('/overview', (req, res) => {
  const { days, from, to } = window(req);
  const snap = snapshot(days);
  const sparks = Object.fromEntries(Object.keys(snap.sources).map((s) => [s, series(s, [HEADLINE[s]], from, to).map((r) => r[HEADLINE[s]])]));
  const pipeline = db.prepare(`SELECT stage, COUNT(*) n, COALESCE(SUM(value),0) value FROM leads GROUP BY stage`).all();
  res.json({
    snapshot: snap, sparks, headline: HEADLINE,
    recommendations: db.prepare(`SELECT * FROM recommendations WHERE status='open' ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, updated_at DESC LIMIT 6`).all(),
    followUps: db.prepare(`SELECT id, first_name, last_name, company, stage, next_follow_up_at, score FROM leads
      WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= ? AND stage NOT IN ('won','lost') ORDER BY next_follow_up_at LIMIT 8`).all(new Date(Date.now() + 864e5).toISOString()),
    opportunities: db.prepare(`SELECT * FROM opportunities WHERE status='new' ORDER BY score DESC, found_at DESC LIMIT 6`).all(),
    brief: db.prepare('SELECT * FROM briefs ORDER BY id DESC LIMIT 1').get() || null,
    pipeline: STAGES.map((s) => pipeline.find((p) => p.stage === s) || { stage: s, n: 0, value: 0 }),
  });
});

// ---------------------------------------------------------------- channels
api.get('/channel/:source', (req, res) => {
  const { source } = req.params;
  if (!SOURCES[source]) return res.status(404).json({ error: 'Unknown source' });
  const { days, from, to } = window(req);
  const snap = snapshot(days).sources[source] || null;
  const out = { source, label: SOURCES[source].label, info: sourceInfo(source), snapshot: snap,
    series: series(source, SOURCE_METRICS[source], from, to), window: { from, to, days } };
  if (['email', 'google_ads', 'openai_ads', 'forms'].includes(source)) out.campaigns = campaigns(source, from, to);
  if (source === 'email') out.pipeline = pipelineStatus();
  if (source === 'ga4') {
    out.channels = breakdown('ga4', 'channel', from, to, { orderBy: 'sessions' }).map((c) => ({ ...derive('ga4', c), name: c.name }));
    out.pages = breakdown('ga4', 'page', from, to, { orderBy: 'sessions', limit: 25 }).map((c) => ({ ...derive('ga4', c), name: c.name }));
  }
  if (source === 'gsc') { out.queries = searchQueries(from, to, 200); out.pages = searchPages(from, to, 50); }
  res.json(out);
});

// ---------------------------------------------------------------- recommendations & AI brief
api.get('/recommendations', (req, res) => {
  const status = req.query.status || 'open';
  res.json(db.prepare(`SELECT * FROM recommendations WHERE status = ? ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, updated_at DESC`).all(status));
});
api.patch('/recommendations/:id', (req, res) => {
  db.prepare('UPDATE recommendations SET status = ?, updated_at = ? WHERE id = ?').run(req.body.status, now(), req.params.id);
  res.json({ ok: true });
});
api.post('/recommendations/refresh', (req, res) => res.json({ count: refreshRecommendations() }));
api.post('/brief', wrap(async (req, res) => res.json(await aiBrief())));
api.get('/briefs', (req, res) => res.json(db.prepare('SELECT * FROM briefs ORDER BY id DESC LIMIT 10').all()));

// ---------------------------------------------------------------- market radar
api.get('/opportunities', (req, res) => {
  const where = [], args = [];
  if (req.query.kind) { where.push('kind = ?'); args.push(req.query.kind); }
  where.push(req.query.status ? 'status = ?' : "status IN ('new','saved')");
  if (req.query.status) args.push(req.query.status);
  if (req.query.q) { where.push('(title LIKE ? OR summary LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  res.json(db.prepare(`SELECT * FROM opportunities WHERE ${where.join(' AND ')} ORDER BY score DESC, found_at DESC LIMIT 300`).all(...args));
});
api.patch('/opportunities/:id', (req, res) => {
  db.prepare('UPDATE opportunities SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.json({ ok: true });
});
api.post('/opportunities/run', wrap(async (req, res) => {
  const out = await runMonitor();
  refreshRecommendations();
  res.json(out);
}));
api.post('/opportunities/:id/draft', wrap(async (req, res) => {
  const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!opp) return res.status(404).json({ error: 'Not found' });
  res.json({ draft: await draftForOpportunity(opp) });
}));
api.post('/opportunities/:id/lead', (req, res) => {
  const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!opp) return res.status(404).json({ error: 'Not found' });
  const id = createLead({ ...req.body, source: `Market radar: ${opp.source}`, notes: `${opp.title}\n${opp.url}\n\n${req.body.notes || ''}`.trim() });
  db.prepare(`UPDATE opportunities SET status='actioned', lead_id=? WHERE id=?`).run(id, opp.id);
  res.json({ id });
});
api.get('/feeds', (req, res) => res.json({
  feeds: db.prepare('SELECT * FROM feeds ORDER BY id').all(),
  example: googleNewsUrl('"your keyword"'),
}));
api.post('/feeds', (req, res) => {
  const { name, url, kind = 'auto' } = req.body;
  if (!name || !/^https?:\/\//.test(url || '')) return res.status(400).json({ error: 'Name and a http(s) URL are required' });
  db.prepare('INSERT OR IGNORE INTO feeds(name, url, kind) VALUES (?,?,?)').run(name, url, kind);
  res.json({ ok: true });
});
api.delete('/feeds/:id', (req, res) => { db.prepare('DELETE FROM feeds WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

// ---------------------------------------------------------------- leads
const LEAD_FIELDS = ['first_name', 'last_name', 'email', 'company', 'title', 'website', 'linkedin', 'phone', 'industry', 'source', 'stage', 'value', 'tags', 'notes', 'next_follow_up_at', 'unsubscribed'];

function createLead(body) {
  const lead = Object.fromEntries(LEAD_FIELDS.map((f) => [f, body[f] ?? null]));
  lead.stage = STAGES.includes(lead.stage) ? lead.stage : 'new';
  lead.email = lead.email ? String(lead.email).trim().toLowerCase() : null;
  lead.unsubscribed = lead.unsubscribed ? 1 : 0;
  lead.value = Number(lead.value) || 0;
  const ts = now();
  const id = db.prepare(`INSERT INTO leads(${LEAD_FIELDS.join(',')}, score, created_at, updated_at) VALUES (${LEAD_FIELDS.map(() => '?').join(',')}, ?, ?, ?)`)
    .run(...LEAD_FIELDS.map((f) => lead[f]), scoreLead(lead), ts, ts).lastInsertRowid;
  logActivity(id, { type: 'note', subject: 'Lead created', body: lead.source ? `Source: ${lead.source}` : null });
  return id;
}

api.get('/leads', (req, res) => {
  const where = ['1=1'], args = [];
  if (req.query.stage) { where.push('stage = ?'); args.push(req.query.stage); }
  if (req.query.due) { where.push(`next_follow_up_at <= ? AND stage NOT IN ('won','lost')`); args.push(now()); }
  if (req.query.q) {
    where.push(`(first_name || ' ' || last_name LIKE ? OR company LIKE ? OR email LIKE ? OR tags LIKE ?)`);
    args.push(...Array(4).fill(`%${req.query.q}%`));
  }
  res.json(db.prepare(`SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY score DESC, updated_at DESC LIMIT 1000`).all(...args));
});
api.post('/leads', (req, res) => {
  try { res.json({ id: createLead(req.body) }); }
  catch (err) { res.status(400).json({ error: /UNIQUE/.test(err.message) ? 'A lead with that email already exists' : err.message }); }
});
api.get('/leads/:id', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  res.json({
    lead,
    activities: db.prepare('SELECT * FROM activities WHERE lead_id = ? ORDER BY id DESC').all(lead.id),
    outbox: db.prepare('SELECT * FROM outbox WHERE lead_id = ? ORDER BY id DESC').all(lead.id),
    enrollments: db.prepare('SELECT e.*, s.name FROM enrollments e JOIN sequences s ON s.id = e.sequence_id WHERE lead_id = ?').all(lead.id),
  });
});
api.patch('/leads/:id', (req, res) => {
  const before = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  const fields = LEAD_FIELDS.filter((f) => f in req.body);
  const merged = { ...before, ...req.body };
  try {
    db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = ?`).join(', ')}${fields.length ? ',' : ''} score = ?, updated_at = ? WHERE id = ?`)
      .run(...fields.map((f) => (f === 'unsubscribed' ? (req.body[f] ? 1 : 0) : req.body[f])), scoreLead(merged), now(), before.id);
  } catch (err) { return res.status(400).json({ error: err.message }); }
  if (req.body.stage && req.body.stage !== before.stage) {
    logActivity(before.id, { type: 'stage', subject: `${before.stage} → ${req.body.stage}` });
    if (['replied', 'meeting', 'won', 'lost'].includes(req.body.stage)) {
      db.prepare(`UPDATE enrollments SET status='stopped' WHERE lead_id = ? AND status = 'active'`).run(before.id);
      db.prepare(`UPDATE outbox SET status='cancelled' WHERE lead_id = ? AND status IN ('draft','approved') AND enrollment_id IS NOT NULL`).run(before.id);
    }
  }
  res.json({ ok: true });
});
api.delete('/leads/:id', (req, res) => { db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

api.post('/leads/import', (req, res) => {
  const rows = parseCsv(String(req.body.csv || ''));
  const alias = { firstname: 'first_name', first: 'first_name', lastname: 'last_name', last: 'last_name', surname: 'last_name',
    email_address: 'email', organisation: 'company', organization: 'company', company_name: 'company', job_title: 'title', position: 'title',
    linkedin_url: 'linkedin', url: 'website', domain: 'website', phone_number: 'phone' };
  let created = 0, skipped = 0;
  tx(() => {
    for (const raw of rows) {
      const r = {};
      for (const [k, v] of Object.entries(raw)) r[alias[k] || k] = v;
      if (r.name && !r.first_name) [r.first_name, ...r.last_name] = r.name.split(' '), r.last_name = [].concat(r.last_name).join(' ');
      if (!r.email && !r.company) { skipped++; continue; }
      if (r.email && db.prepare('SELECT 1 FROM leads WHERE lower(email) = lower(?)').get(r.email)) { skipped++; continue; }
      createLead({ ...r, source: r.source || req.body.source || 'CSV import', tags: r.tags || req.body.tags });
      created++;
    }
  });
  res.json({ created, skipped });
});

api.post('/leads/:id/activities', (req, res) => {
  const { type = 'note', direction = null, subject = null, body = null, next_follow_up_at } = req.body;
  logActivity(req.params.id, { type, direction, subject, body });
  const sets = ['updated_at = ?'], args = [now()];
  if (['email', 'call', 'linkedin', 'meeting'].includes(type) && direction !== 'in') { sets.push('last_contacted_at = ?'); args.push(now()); }
  if (direction === 'in') { sets.push(`stage = CASE WHEN stage IN ('new','contacted') THEN 'replied' ELSE stage END`); }
  if (next_follow_up_at !== undefined) { sets.push('next_follow_up_at = ?'); args.push(next_follow_up_at || null); }
  db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...args, req.params.id);
  if (direction === 'in') {
    db.prepare(`UPDATE enrollments SET status='stopped' WHERE lead_id = ? AND status='active'`).run(req.params.id);
    db.prepare(`UPDATE outbox SET status='cancelled' WHERE lead_id = ? AND status IN ('draft','approved') AND enrollment_id IS NOT NULL`).run(req.params.id);
  }
  res.json({ ok: true });
});
api.post('/leads/:id/draft', wrap(async (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  res.json(await draftEmail(lead, req.body || {}));
}));
api.post('/leads/:id/email', wrap(async (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const id = queueEmail({ lead, subject: render(req.body.subject, lead), body: render(req.body.body, lead), approve: !!req.body.approve });
  const flushed = req.body.approve ? await flushOutbox() : null;
  res.json({ id, flushed });
}));

// ---------------------------------------------------------------- outreach: outbox, templates, sequences
api.get('/outbox', (req, res) => {
  const status = req.query.status || 'draft';
  res.json({
    items: db.prepare(`SELECT o.*, l.first_name, l.last_name, l.company FROM outbox o JOIN leads l ON l.id = o.lead_id WHERE o.status = ? ORDER BY o.id DESC LIMIT 500`).all(status),
    sentToday: sentToday(), dailyLimit: Number(getSetting('outreach.daily_limit') || 40), smtp: smtpConfigured(),
  });
});
api.patch('/outbox/:id', (req, res) => {
  const { subject, body, status } = req.body;
  db.prepare('UPDATE outbox SET subject = COALESCE(?, subject), body = COALESCE(?, body), status = COALESCE(?, status) WHERE id = ?')
    .run(subject ?? null, body ?? null, status ?? null, req.params.id);
  res.json({ ok: true });
});
api.post('/outbox/approve-all', (req, res) => res.json({ changed: db.prepare(`UPDATE outbox SET status='approved' WHERE status='draft'`).run().changes }));
api.post('/outbox/flush', wrap(async (req, res) => { runSequences(); res.json(await flushOutbox()); }));

api.get('/templates', (req, res) => res.json(db.prepare('SELECT * FROM templates ORDER BY id').all()));
api.post('/templates', (req, res) => {
  const { id, name, subject, body } = req.body;
  if (!name || !subject || !body) return res.status(400).json({ error: 'Name, subject and body are required' });
  if (id) db.prepare('UPDATE templates SET name=?, subject=?, body=? WHERE id=?').run(name, subject, body, id);
  else return res.json({ id: db.prepare('INSERT INTO templates(name, subject, body) VALUES (?,?,?)').run(name, subject, body).lastInsertRowid });
  res.json({ id });
});
api.delete('/templates/:id', (req, res) => { db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

api.get('/sequences', (req, res) => res.json(db.prepare(`SELECT s.*,
  (SELECT COUNT(*) FROM enrollments e WHERE e.sequence_id = s.id AND e.status = 'active') active,
  (SELECT COUNT(*) FROM enrollments e WHERE e.sequence_id = s.id) total FROM sequences s ORDER BY id`).all()
  .map((s) => ({ ...s, steps: JSON.parse(s.steps) }))));
api.post('/sequences', (req, res) => {
  const { id, name, steps } = req.body;
  if (!name || !Array.isArray(steps) || !steps.length) return res.status(400).json({ error: 'Name and at least one step are required' });
  const clean = steps.map((s) => ({ day: Number(s.day) || 0, template_id: Number(s.template_id) })).sort((a, b) => a.day - b.day);
  if (id) db.prepare('UPDATE sequences SET name=?, steps=? WHERE id=?').run(name, JSON.stringify(clean), id);
  else return res.json({ id: db.prepare('INSERT INTO sequences(name, steps) VALUES (?,?)').run(name, JSON.stringify(clean)).lastInsertRowid });
  res.json({ id });
});
api.delete('/sequences/:id', (req, res) => { db.prepare('DELETE FROM sequences WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
api.post('/sequences/:id/enroll', (req, res) => {
  const n = enroll((req.body.lead_ids || []).map(Number), Number(req.params.id));
  const r = runSequences();
  res.json({ enrolled: n, queued: r.queued });
});

// ---------------------------------------------------------------- integrations, settings, data
api.get('/integrations', (req, res) => {
  const runs = Object.fromEntries(lastRuns().map((r) => [r.source, r]));
  res.json(connectors.map((c) => ({
    id: c.id, name: c.name, category: c.category, docs: c.docs, fields: c.fields, configured: c.configured(),
    lastRun: runs[c.id] || null,
    sources: Object.entries(SOURCES).filter(([, s]) => s.connector === c.id).map(([id, s]) => ({ id, label: s.label, ...sourceInfo(id) })),
  })));
});
api.post('/integrations/:id/sync', wrap(async (req, res) => {
  const r = await syncConnector(req.params.id, { days: Number(req.body?.days) || 30 });
  refreshRecommendations();
  res.json(r);
}));
api.post('/integrations/sync-all', wrap(async (req, res) => {
  const r = await syncAll({ days: Number(req.body?.days) || 30 });
  refreshRecommendations();
  res.json(r);
}));

// Lead pipeline (Claude artifact) sync: paste or upload its "Export for dashboard" JSON.
api.get('/pipeline', (req, res) => res.json(pipelineStatus()));
api.post('/pipeline/import', (req, res) => {
  try {
    const out = importPipeline(req.body.json ?? req.body);
    refreshRecommendations();
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err instanceof SyntaxError ? 'That doesn\'t look like a pipeline export. Copy it again with "Export for dashboard".' : err.message });
  }
});

// CSV import for any source (useful for ChatGPT ads exports or channels without API access).
api.post('/import/metrics', (req, res) => {
  const { source, csv } = req.body;
  if (!SOURCES[source]) return res.status(400).json({ error: 'Unknown source' });
  const social = ['linkedin', 'facebook', 'instagram'].includes(source);
  // LinkedIn exports write dates US-style (10/13/2026).
  const list = withIsoDates(parseCsv(String(csv || '')), { defaultOrder: source === 'linkedin' ? 'mdy' : 'dmy' });
  if (!list.length) return res.status(400).json({ error: 'No dated rows found. Export a daily breakdown with a "Date" or "Day" column.' });
  let rows;
  if (['google_ads', 'openai_ads'].includes(source)) rows = adRowsToMetrics(list);
  else if (social) rows = list.flatMap((r) => Object.entries(socialMetrics(r)).map(([metric, value]) => ({ metric, date: r.date, value })));
  else {
    rows = [];
    for (const r of list) for (const m of SOURCE_METRICS[source]) if (r[m] !== undefined && r[m] !== '') rows.push({ metric: m, date: r.date, value: toNumber(r[m]) });
  }
  if (!rows.length) return res.status(400).json({ error: `Found dates but no columns I recognise. Expected something like: ${SOURCE_METRICS[source].join(', ')}.` });
  const dates = list.map((r) => r.date).sort();
  const metricsIn = [...new Set(rows.map((r) => r.metric))];
  const n = writeMetrics(source, rows, { from: dates[0], to: dates.at(-1), onlyMetrics: social ? metricsIn : null });
  refreshRecommendations();
  res.json({ rows: n, from: dates[0], to: dates.at(-1), columns: metricsIn });
});

api.get('/settings', (req, res) => res.json(allSettings()));
api.put('/settings', (req, res) => { setSettings(req.body || {}); res.json(allSettings()); });

api.post('/demo/clear', (req, res) => { clearDemo(); refreshRecommendations(); res.json({ ok: true }); });
api.post('/demo/seed', (req, res) => {
  seedWorkspace(); seedDemoMetrics(); seedDemoLeads(); seedDemoOpportunities();
  res.json({ recommendations: refreshRecommendations() });
});

api.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

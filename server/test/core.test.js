import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-test-'));
process.env.MMM_DB_PATH = path.join(dir, 'test.db');

const { parseCsv } = await import('../csv.js');
const { parseFeed, scoreItem } = await import('../services/monitor.js');
const { render, scoreLead, runSequences, queueEmail } = await import('../services/outreach.js');
const { writeMetrics, totals, daysAgo } = await import('../metrics.js');
const { ruleRecommendations } = await import('../services/recommendations.js');
const { snapshot } = await import('../services/insights.js');
const { db, now } = await import('../db.js');
const { seedWorkspace } = await import('../demo.js');

before(() => seedWorkspace());

test('CSV parser handles quotes, commas, CRLF and header normalisation', () => {
  const rows = parseCsv('First Name,Email,"Company, Inc"\r\n"Doe, Jane",jane@x.com,"Say ""hi"""\r\n\r\n');
  assert.deepEqual(rows, [{ first_name: 'Doe, Jane', email: 'jane@x.com', company_inc: 'Say "hi"' }]);
});

test('RSS and Atom feeds parse into items', () => {
  const rss = `<rss><channel><item><title>Acme raises £5m Series A</title><link>https://n.example/a</link>
    <description>&lt;b&gt;SaaS&lt;/b&gt; firm grows</description><pubDate>${new Date().toUTCString()}</pubDate><source url="x">Trade Weekly</source></item></channel></rss>`;
  const [item] = parseFeed(rss);
  assert.equal(item.title, 'Acme raises £5m Series A');
  assert.equal(item.url, 'https://n.example/a');
  assert.equal(item.publisher, 'Trade Weekly');
  const atom = '<feed><entry><title>Journalist request: experts wanted</title><link href="https://n.example/b"/><updated>2026-01-01</updated></entry></feed>';
  assert.equal(parseFeed(atom)[0].url, 'https://n.example/b');
});

test('opportunity scoring classifies PR vs outbound and rewards fresh, relevant items', () => {
  const fresh = new Date().toISOString();
  const ob = scoreItem({ title: 'SaaS startup raises Series A funding', summary: '', published_at: fresh }, { kindHint: 'auto', keywords: ['series a'] });
  assert.equal(ob.kind, 'outbound');
  const pr = scoreItem({ title: '#journorequest: looking for experts on B2B marketing', summary: '', published_at: fresh }, { kindHint: 'auto', keywords: ['b2b marketing'] });
  assert.equal(pr.kind, 'pr');
  const stale = scoreItem({ title: 'SaaS startup raises Series A funding', summary: '', published_at: '2020-01-01' }, { kindHint: 'auto', keywords: ['series a'] });
  assert.ok(ob.score > stale.score);
});

test('template rendering and lead scoring', () => {
  assert.equal(render('Hi {{first_name}} at {{company}} {{unknown}}', { first_name: 'Sam', company: 'Acme' }), 'Hi Sam at Acme {{unknown}}');
  assert.equal(render('Hi {{first_name}}', {}), 'Hi there');
  assert.ok(scoreLead({ email: 'a@b.c', title: 'CMO', industry: 'SaaS', stage: 'meeting' }) > scoreLead({ title: 'Intern', stage: 'new' }));
});

test('metrics: live data replaces demo rows; totals aggregate the window', () => {
  const d = daysAgo(2);
  writeMetrics('linkedin', [{ metric: 'impressions', date: d, value: 999 }], { from: d, to: d, demo: true });
  writeMetrics('linkedin', [{ metric: 'impressions', date: d, value: 100 }, { metric: 'engagements', date: d, value: 7 }], { from: d, to: d });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM metrics WHERE source = ? AND demo = 1').get('linkedin').n, 0);
  assert.deepEqual(totals('linkedin', d, d), { engagements: 7, impressions: 100 });
  assert.equal(snapshot(28).sources.linkedin.current.engagement_rate, 0.07);
});

test('recommendations flag ad campaigns that spend without converting', () => {
  const rows = [];
  for (let i = 1; i <= 14; i++) {
    const date = daysAgo(i);
    for (const [metric, value] of Object.entries({ cost: 20, clicks: 10, impressions: 300, conversions: 0, conv_value: 0 })) {
      rows.push({ metric, date, dim_type: 'campaign', dim: 'Wasteful', value }, { metric, date, value });
    }
  }
  writeMetrics('google_ads', rows, { from: daysAgo(14), to: daysAgo(1) });
  const recs = ruleRecommendations();
  assert.ok(recs.some((r) => r.fp === 'google_ads:no-conv:Wasteful' && r.priority === 'high'));
});

test('sequences queue the first step and stop when the lead replies', () => {
  const ts = now();
  const leadId = db.prepare(`INSERT INTO leads(first_name, email, company, stage, created_at, updated_at) VALUES ('Ana','ana@x.example','Xco','new',?,?)`).run(ts, ts).lastInsertRowid;
  const seq = db.prepare('SELECT id FROM sequences LIMIT 1').get().id;
  db.prepare(`INSERT INTO enrollments(lead_id, sequence_id, next_run_at, created_at) VALUES (?,?,?,?)`).run(leadId, seq, ts, ts);
  assert.equal(runSequences().queued, 1);
  const draft = db.prepare('SELECT * FROM outbox WHERE lead_id = ?').get(leadId);
  assert.equal(draft.status, 'draft');
  assert.match(draft.body, /Hi Ana/);
  // A pending draft blocks the next step from stacking.
  db.prepare(`UPDATE enrollments SET next_run_at = ? WHERE lead_id = ?`).run(ts, leadId);
  assert.equal(runSequences().queued, 0);
  db.prepare(`UPDATE leads SET stage = 'replied' WHERE id = ?`).run(leadId);
  runSequences();
  assert.equal(db.prepare('SELECT status FROM enrollments WHERE lead_id = ?').get(leadId).status, 'stopped');
});

test('unsubscribed leads cannot be emailed', () => {
  const ts = now();
  const id = db.prepare(`INSERT INTO leads(first_name, email, stage, unsubscribed, created_at, updated_at) VALUES ('U','u@x.example','new',1,?,?)`).run(ts, ts).lastInsertRowid;
  assert.throws(() => queueEmail({ lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(id), subject: 's', body: 'b' }), /unsubscribed/);
});

test('ad-manager CSV exports import with UK dates, currency symbols and a totals row', async () => {
  const { withIsoDates, toIsoDate } = await import('../csv.js');
  const { adRowsToMetrics } = await import('../connectors/openai-ads.js');
  assert.equal(toIsoDate('13/10/2026'), '2026-10-13');
  assert.equal(toIsoDate('13 Oct 2026'), '2026-10-13');
  assert.equal(toIsoDate('Oct 13, 2026'), '2026-10-13');
  assert.equal(toIsoDate('Total'), null);
  const csv = 'Day,Campaign name,Spend (GBP),Impressions,Clicks,CTR,Conversions\n12/10/2026,B2B growth,"£1,204.50","10,000",120,1.2%,3\nTotal,,"£1,204.50","10,000",120,1.2%,3\n';
  const list = withIsoDates(parseCsv(csv));
  assert.equal(list.length, 1);
  const rows = adRowsToMetrics(list);
  const get = (metric, dim = '') => rows.find((r) => r.metric === metric && (r.dim || '') === dim)?.value;
  assert.equal(get('cost', 'B2B growth'), 1204.5);
  assert.equal(get('impressions'), 10000);
  assert.equal(get('conversions'), 3);
});

test('Lead pipeline import creates leads once, follows stage changes and builds email metrics', async () => {
  const { importPipeline } = await import('../services/pipeline.js');
  const lead = (status, extra = {}) => ({ id: 'acme-ltd', company: 'Acme Ltd', contact: 'Jo Bloggs', role: 'MD', email: 'jo@acme.example',
    fit: 'A', status, addedOn: daysAgo(5), subject: 'Well done', body: 'Hi Jo', followup1: 'Hi again',
    emailNote: 'Best guess, unverified. If it bounces, use info@acme.example.', ...extra });
  assert.equal(importPipeline({ leads: [lead('Drafted')] }).created, 1);
  const again = importPipeline(JSON.stringify([lead('Sent', { sentOn: daysAgo(3) })]));
  assert.equal(again.created, 0);
  assert.equal(again.stageChanges, 1);
  const row = db.prepare(`SELECT * FROM leads WHERE external_id = 'pipeline:acme-ltd'`).get();
  assert.equal(row.stage, 'contacted');
  assert.equal(row.last_contacted_at.slice(0, 10), daysAgo(3));
  const t = totals('email', daysAgo(10), daysAgo(0));
  assert.equal(t.sent, 1);
  assert.equal(t.prospects >= 1, true);
  assert.equal(t.bounces, undefined); // "If it bounces" is advice, not a bounce
  // A stage set only in the dashboard survives a re-import where the pipeline stage hasn't changed.
  db.prepare(`UPDATE leads SET stage = 'meeting' WHERE id = ?`).run(row.id);
  importPipeline([lead('Sent', { sentOn: daysAgo(3) })]);
  assert.equal(db.prepare('SELECT stage FROM leads WHERE id = ?').get(row.id).stage, 'meeting');
});

test('Netlify form submissions become inbound leads once, and enquiry counts become metrics', async () => {
  const http = await import('node:http');
  const today = new Date().toISOString();
  const subs = [
    { id: 's1', form_id: 'f1', created_at: today, email: 'Kate@Widgets.example', name: 'Kate Moss',
      data: { name: 'Kate Moss', email: 'Kate@Widgets.example', 'Company name': 'Widgets Ltd', Message: 'Can we book a call?', ip: '1.2.3.4' } },
    { id: 's2', form_id: 'f1', created_at: today, data: { 'first-name': 'Ana', email: 'ana@x.example', message: 'Following up on your email' } },
  ];
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer test-token') { res.statusCode = 401; return res.end('{"message":"Access denied"}'); }
    if (req.url.endsWith('/forms')) return res.end(JSON.stringify([{ id: 'f1', name: 'contact' }]));
    if (req.url.includes('/submissions')) return res.end(JSON.stringify(req.url.includes('page=1') ? subs : []));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => server.listen(0, r));
  process.env.NETLIFY_API_URL = `http://localhost:${server.address().port}`;
  process.env.NETLIFY_TOKEN = 'test-token';
  const { syncConnector } = await import('../services/sync.js');
  try {
    // ana@x.example is already a lead (from the sequence test), so her enquiry marks her as replied instead.
    const first = await syncConnector('netlify', { days: 30 });
    assert.equal(first.status, 'ok');
    await syncConnector('netlify', { days: 30 }); // second run must not duplicate
    const kate = db.prepare(`SELECT * FROM leads WHERE email = 'kate@widgets.example'`).all();
    assert.equal(kate.length, 1);
    assert.equal(kate[0].company, 'Widgets Ltd');
    assert.equal(kate[0].source, 'Website: contact');
    assert.match(kate[0].notes, /book a call/);
    assert.equal(db.prepare(`SELECT stage FROM leads WHERE email = 'ana@x.example'`).get().stage, 'replied');
    const rows = db.prepare(`SELECT SUM(value) v FROM metrics WHERE source = 'forms' AND dim_type = ''`).get();
    assert.equal(rows.v, 2);
  } finally {
    server.close();
    delete process.env.NETLIFY_TOKEN;
  }
});

test('saving a card with a blank secret box keeps the saved secret', async () => {
  const { setSettings, getSetting } = await import('../settings.js');
  setSettings({ 'google.service_account_json': '{"client_email":"a@b"}' });
  setSettings({ 'gsc.site_url': 'sc-domain:example.com', 'google.service_account_json': '' });
  assert.equal(getSetting('google.service_account_json'), '{"client_email":"a@b"}');
});

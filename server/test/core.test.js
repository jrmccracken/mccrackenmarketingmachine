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

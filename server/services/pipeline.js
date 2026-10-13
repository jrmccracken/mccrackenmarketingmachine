// Sync from the "McCracken Lead Pipeline" Claude artifact. Its Monday research run finds prospects, writes
// first-touch and follow-up emails, and leaves them as Gmail drafts; James sends them and moves each lead's
// stage in the pipeline. Importing an export of that pipeline keeps the dashboard's leads and outbound email
// numbers in step with it.
import { db, now, tx } from '../db.js';
import { setSettings, getSetting } from '../settings.js';
import { writeMetrics, daysAgo, isoDate } from '../metrics.js';
import { scoreLead, logActivity } from './outreach.js';

export const PIPELINE_URL = 'https://claude.ai/artifact/KkZdbgtE5g3hZtga5DPpjp';

const STAGE = { New: 'new', Drafted: 'new', Sent: 'contacted', Replied: 'replied', Meeting: 'meeting', Proposal: 'proposal', Won: 'won', Lost: 'lost', Parked: 'lost' };
const RANK = { New: 0, Drafted: 1, Sent: 2, Replied: 3, Meeting: 4, Proposal: 5, Won: 6, Lost: -1, Parked: -1 };
const FIT_LABEL = { A: 'Fit A: approach now', B: 'Fit B: closer look', C: 'Fit C: lower priority' };

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const day = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** Accepts the dashboard export ({ leads: [...] }), a bare array, or ArtifactData-style { id, data } rows. */
export function normaliseExport(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  const list = Array.isArray(raw) ? raw : raw?.leads || raw?.documents || raw?.docs || [];
  if (!Array.isArray(list) || !list.length) throw new Error('No leads found in that export.');
  return list.map((d) => {
    const doc = d && typeof d.data === 'object' && !d.company ? { id: d.id || d.doc_id, ...d.data } : d;
    return { ...doc, id: doc.id || slug(doc.company) };
  }).filter((d) => d.id && d.company);
}

/** Upsert pipeline leads. A stage change made in the pipeline wins; stages changed only in the dashboard are kept. */
export function importPipeline(input) {
  const docs = normaliseExport(input);
  const today = isoDate(new Date());
  const stats = { created: 0, updated: 0, stageChanges: 0, total: docs.length };

  tx(() => {
    for (const d of docs) {
      const externalId = `pipeline:${d.id}`;
      const status = STAGE[d.status] ? d.status : 'New';
      const [first, ...rest] = String(d.contact || '').trim().split(/\s+/);
      const fields = {
        first_name: first || null,
        last_name: rest.join(' ') || null,
        email: d.email ? String(d.email).trim().toLowerCase() : null,
        company: d.company,
        title: d.role || null,
        website: d.website ? (/^https?:/.test(d.website) ? d.website : `https://${d.website}`) : null,
        industry: d.sector || null,
        fit: d.fit || null,
        pipeline: JSON.stringify(d),
      };
      let lead = db.prepare('SELECT * FROM leads WHERE external_id = ?').get(externalId)
        || (fields.email ? db.prepare('SELECT * FROM leads WHERE lower(email) = ? AND external_id IS NULL').get(fields.email) : null);

      if (!lead) {
        const created = day(d.addedOn) ? `${day(d.addedOn)}T09:00:00.000Z` : now();
        const row = {
          ...fields, external_id: externalId, source: 'Lead pipeline', stage: STAGE[status], pipeline_status: status,
          tags: [d.fit && `fit-${d.fit}`, d.location].filter(Boolean).join(', '),
          notes: [d.trigger, d.angle].filter(Boolean).join('\n\n'),
          next_follow_up_at: day(d.followUp) ? `${day(d.followUp)}T09:00:00.000Z` : null,
          last_contacted_at: day(d.sentOn) ? `${day(d.sentOn)}T09:00:00.000Z` : null,
          replied_at: RANK[status] >= 3 ? `${day(d.repliedOn) || today}T09:00:00.000Z` : null,
          meeting_at: RANK[status] >= 4 ? `${day(d.meetingOn) || today}T09:00:00.000Z` : null,
          created_at: created, updated_at: now(),
        };
        row.score = scoreLead(row);
        const cols = Object.keys(row);
        const id = db.prepare(`INSERT INTO leads(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row)).lastInsertRowid;
        logActivity(id, { type: 'note', subject: 'Added from Lead pipeline', body: [d.trigger, d.source].filter(Boolean).join('\n') });
        stats.created++;
        continue;
      }

      const sets = { ...fields, external_id: externalId, updated_at: now() };
      if (lead.pipeline_status !== status) {
        sets.pipeline_status = status;
        sets.stage = STAGE[status];
        if (RANK[status] >= 2 && !lead.last_contacted_at) sets.last_contacted_at = `${day(d.sentOn) || today}T09:00:00.000Z`;
        if (RANK[status] >= 3 && !lead.replied_at) sets.replied_at = `${day(d.repliedOn) || today}T09:00:00.000Z`;
        if (RANK[status] >= 4 && !lead.meeting_at) sets.meeting_at = `${day(d.meetingOn) || today}T09:00:00.000Z`;
        if (lead.pipeline_status) {
          logActivity(lead.id, { type: 'stage', subject: `Pipeline: ${lead.pipeline_status} → ${status}` });
          stats.stageChanges++;
        }
      }
      if (day(d.followUp)) sets.next_follow_up_at = `${day(d.followUp)}T09:00:00.000Z`;
      sets.score = scoreLead({ ...lead, ...sets });
      const cols = Object.keys(sets);
      db.prepare(`UPDATE leads SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(sets), lead.id);
      stats.updated++;
    }
  });

  stats.metrics = rebuildEmailMetrics();
  setSettings({ 'pipeline.last_import': now(), 'pipeline.last_count': String(docs.length) });
  return stats;
}

/**
 * Outbound email numbers come from the pipeline: prospects researched, emails sent, replies, meetings and bounces,
 * each on the day it happened, overall and split by fit grade. There is no open tracking on Gmail sends.
 */
export function rebuildEmailMetrics() {
  const leads = db.prepare(`SELECT * FROM leads WHERE external_id LIKE 'pipeline:%'`).all();
  const events = [];
  for (const l of leads) {
    const p = JSON.parse(l.pipeline || '{}');
    const fit = FIT_LABEL[l.fit] || 'Unscored';
    const add = (metric, date) => date && events.push({ metric, date: date.slice(0, 10), fit });
    add('prospects', day(p.addedOn) || l.created_at);
    add('sent', l.last_contacted_at);
    add('replies', l.replied_at);
    add('opportunities', l.meeting_at);
    if (/\bbounced\b/i.test(`${p.emailNote || ''} ${p.notes || ''}`)) add('bounces', l.updated_at);
  }
  if (!events.length) return 0;
  const totals = new Map();
  const bump = (key, row) => { const r = totals.get(key) || { ...row, value: 0 }; r.value++; totals.set(key, r); };
  for (const e of events) {
    bump(`${e.metric}|${e.date}|`, { metric: e.metric, date: e.date });
    bump(`${e.metric}|${e.date}|${e.fit}`, { metric: e.metric, date: e.date, dim_type: 'campaign', dim: e.fit });
  }
  const dates = events.map((e) => e.date).sort();
  return writeMetrics('email', [...totals.values()], { from: dates[0], to: daysAgo(-1) });
}

export function pipelineStatus() {
  const counts = db.prepare(`SELECT pipeline_status s, COUNT(*) n FROM leads WHERE external_id LIKE 'pipeline:%' GROUP BY pipeline_status`).all();
  return {
    url: PIPELINE_URL,
    lastImport: getSetting('pipeline.last_import') || null,
    total: counts.reduce((a, c) => a + c.n, 0),
    byStatus: Object.fromEntries(counts.map((c) => [c.s, c.n])),
  };
}

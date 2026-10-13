import { db, now, tx } from '../db.js';
import { getSetting } from '../settings.js';
import { sendMail, smtpConfigured } from './mailer.js';
import { ask, aiEnabled } from './ai.js';

export const STAGES = ['new', 'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost'];

export function render(text, lead) {
  const vars = {
    first_name: lead.first_name || 'there',
    last_name: lead.last_name || '',
    company: lead.company || 'your company',
    title: lead.title || '',
    industry: lead.industry || '',
    website: lead.website || '',
    sender_name: getSetting('sender.name'),
    my_company: getSetting('company.name'),
  };
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Simple fit + engagement score, 0-100. */
export function scoreLead(lead) {
  let s = 0;
  if (lead.email) s += 20;
  if (lead.title && /(founder|ceo|owner|managing director|md|cmo|marketing director|head of (marketing|growth)|vp)/i.test(lead.title)) s += 25;
  else if (lead.title && /marketing|growth|sales/i.test(lead.title)) s += 12;
  const icp = getSetting('monitor.icp_terms').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
  if (lead.industry && icp.some((t) => lead.industry.toLowerCase().includes(t))) s += 15;
  if (lead.website) s += 5;
  if (lead.linkedin) s += 5;
  s += { new: 0, contacted: 5, replied: 20, meeting: 25, proposal: 30, won: 30, lost: 0 }[lead.stage] || 0;
  return Math.min(100, s);
}

export function logActivity(leadId, { type, direction = null, subject = null, body = null }) {
  db.prepare('INSERT INTO activities(lead_id, type, direction, subject, body, created_at) VALUES (?,?,?,?,?,?)')
    .run(leadId, type, direction, subject, body, now());
}

/** Queue an email for a lead. Drafts wait for approval unless auto-send is on. */
export function queueEmail({ lead, subject, body, enrollmentId = null, approve = false }) {
  if (!lead.email) throw new Error('Lead has no email address');
  if (lead.unsubscribed) throw new Error('Lead has unsubscribed');
  const status = approve || getSetting('outreach.auto_send') === 'true' ? 'approved' : 'draft';
  return db.prepare('INSERT INTO outbox(lead_id, enrollment_id, to_email, subject, body, status, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(lead.id, enrollmentId, lead.email, subject, body, status, now()).lastInsertRowid;
}

export function sentToday() {
  return db.prepare(`SELECT COUNT(*) n FROM outbox WHERE status = 'sent' AND sent_at >= ?`).get(new Date().toISOString().slice(0, 10)).n;
}

/** Send approved emails, respecting the daily limit. */
export async function flushOutbox() {
  if (!smtpConfigured()) return { sent: 0, skipped: 'SMTP not configured' };
  const limit = Number(getSetting('outreach.daily_limit') || 40);
  const room = Math.max(0, limit - sentToday());
  const items = db.prepare(`SELECT o.*, l.unsubscribed FROM outbox o JOIN leads l ON l.id = o.lead_id WHERE o.status = 'approved' ORDER BY o.id LIMIT ?`).all(room);
  let sent = 0;
  for (const o of items) {
    if (o.unsubscribed) { db.prepare(`UPDATE outbox SET status='cancelled', error='unsubscribed' WHERE id=?`).run(o.id); continue; }
    try {
      await sendMail({ to: o.to_email, subject: o.subject, text: o.body });
      tx(() => {
        db.prepare(`UPDATE outbox SET status='sent', sent_at=?, error=NULL WHERE id=?`).run(now(), o.id);
        db.prepare(`UPDATE leads SET last_contacted_at=?, updated_at=?, stage=CASE WHEN stage='new' THEN 'contacted' ELSE stage END WHERE id=?`).run(now(), now(), o.lead_id);
        logActivity(o.lead_id, { type: 'email', direction: 'out', subject: o.subject, body: o.body });
      });
      sent++;
    } catch (err) {
      db.prepare(`UPDATE outbox SET status='failed', error=? WHERE id=?`).run(String(err.message).slice(0, 300), o.id);
    }
  }
  return { sent };
}

/** Advance active sequence enrollments whose next step is due. Replies/won/lost stop the sequence. */
export function runSequences() {
  const due = db.prepare(`SELECT e.*, s.steps FROM enrollments e JOIN sequences s ON s.id = e.sequence_id
    WHERE e.status = 'active' AND e.next_run_at <= ?`).all(now());
  let queued = 0;
  for (const e of due) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(e.lead_id);
    const steps = JSON.parse(e.steps);
    if (!lead || lead.unsubscribed || ['replied', 'meeting', 'proposal', 'won', 'lost'].includes(lead.stage)) {
      db.prepare(`UPDATE enrollments SET status='stopped' WHERE id=?`).run(e.id);
      continue;
    }
    // Don't stack a new step on top of one still waiting for approval.
    const pending = db.prepare(`SELECT COUNT(*) n FROM outbox WHERE enrollment_id = ? AND status IN ('draft','approved')`).get(e.id).n;
    if (pending) continue;
    const step = steps[e.step];
    if (!step) { db.prepare(`UPDATE enrollments SET status='finished' WHERE id=?`).run(e.id); continue; }
    const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(step.template_id);
    if (tpl && lead.email) {
      queueEmail({ lead, subject: render(tpl.subject, lead), body: render(tpl.body, lead), enrollmentId: e.id });
      queued++;
    }
    const next = steps[e.step + 1];
    if (next) {
      const at = new Date(Date.now() + (next.day - step.day) * 864e5).toISOString();
      db.prepare('UPDATE enrollments SET step = step + 1, next_run_at = ? WHERE id = ?').run(at, e.id);
    } else {
      db.prepare(`UPDATE enrollments SET step = step + 1, status = 'finished' WHERE id = ?`).run(e.id);
    }
  }
  return { queued };
}

export function enroll(leadIds, sequenceId) {
  const stmt = db.prepare(`INSERT INTO enrollments(lead_id, sequence_id, step, next_run_at, status, created_at) VALUES (?,?,0,?, 'active', ?)
    ON CONFLICT(lead_id, sequence_id) DO UPDATE SET status='active', step=0, next_run_at=excluded.next_run_at`);
  let n = 0;
  tx(() => { for (const id of leadIds) { stmt.run(id, sequenceId, now(), now()); n++; } });
  return n;
}

/** AI-personalised email for a lead; falls back to a template-style draft without an API key. */
export async function draftEmail(lead, { goal = 'book an intro call', notes = '' } = {}) {
  const history = db.prepare('SELECT type, direction, subject, body, created_at FROM activities WHERE lead_id = ? ORDER BY id DESC LIMIT 8').all(lead.id);
  if (!aiEnabled()) {
    return {
      subject: `${lead.company || 'Quick idea'}: pipeline idea`,
      body: render(`Hi {{first_name}},\n\nI've been looking at how {{company}} shows up online and think there's a quick win in how you turn traffic and outbound into meetings.\n\nAt {{my_company}} we help B2B teams with ${getSetting('company.services').toLowerCase()}. Would it be useful if I sent over two or three specific ideas for {{company}}?\n\n{{sender_name}}`, lead),
    };
  }
  return ask({
    system: 'You write concise, personalised B2B sales emails for a marketing agency. Be specific to the prospect, never generic. Max 120 words, one clear ask, no buzzwords, no exclamation marks. If there is history, write the right next message in that thread.',
    prompt: `Goal: ${goal}\nExtra notes: ${notes || '(none)'}\n\nProspect:\n${JSON.stringify({ ...lead, notes: lead.notes }, null, 1)}\n\nRecent activity (newest first):\n${JSON.stringify(history, null, 1)}`,
    effort: 'low',
    maxTokens: 4000,
    schema: { type: 'object', additionalProperties: false, required: ['subject', 'body'], properties: { subject: { type: 'string' }, body: { type: 'string' } } },
  });
}

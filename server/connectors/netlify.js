import { getSetting } from '../settings.js';
import { getJson } from './google-auth.js';
import { db, now, tx } from '../db.js';
import { scoreLead, logActivity } from '../services/outreach.js';

// Netlify Forms: enquiries from the website's contact / "book a call" forms become leads, and daily submission
// counts become the "Website enquiries" metrics. API: GET /api/v1/sites/{site}/submissions (verified, non-spam).
const API = () => process.env.NETLIFY_API_URL || 'https://api.netlify.com/api/v1';

const pickField = (data, ...names) => {
  const keys = Object.keys(data || {});
  for (const n of names) {
    const k = keys.find((key) => key.toLowerCase().replace(/[^a-z]/g, '') === n);
    if (k && String(data[k]).trim()) return String(data[k]).trim();
  }
  return '';
};

/** Normalise one submission into lead fields, whatever the form's field names are. */
export function submissionToLead(s, formName) {
  const d = s.data || {};
  const full = s.name || pickField(d, 'name', 'fullname', 'yourname', 'contactname');
  const [first, ...rest] = full.split(/\s+/);
  const email = (s.email || pickField(d, 'email', 'emailaddress', 'youremail', 'workemail')).toLowerCase();
  const message = s.body || pickField(d, 'message', 'enquiry', 'inquiry', 'comments', 'details', 'howcanwehelp', 'tellusmore');
  return {
    first_name: s.first_name || pickField(d, 'firstname', 'first') || first || null,
    last_name: s.last_name || pickField(d, 'lastname', 'surname', 'last') || rest.join(' ') || null,
    email: email || null,
    company: s.company || pickField(d, 'company', 'companyname', 'business', 'organisation', 'organization') || null,
    title: pickField(d, 'role', 'jobtitle', 'title', 'position') || null,
    phone: pickField(d, 'phone', 'telephone', 'phonenumber', 'mobile', 'tel') || null,
    website: pickField(d, 'website', 'url', 'companywebsite') || null,
    message,
    formName: formName || s.form_name || 'Website form',
    details: Object.entries(d).filter(([k]) => !['ip', 'user_agent', 'referrer', 'bot-field', 'form-name'].includes(k))
      .map(([k, v]) => `${k}: ${v}`).join('\n'),
  };
}

/** Create a lead per new enquiry; an enquiry from someone already in the pipeline marks them as replied. */
export function upsertEnquiries(subs) {
  let created = 0, matched = 0;
  tx(() => {
    for (const { sub, lead } of subs) {
      const externalId = `netlify:${sub.id}`;
      if (db.prepare('SELECT 1 FROM leads WHERE external_id = ?').get(externalId)) continue;
      if (db.prepare(`SELECT 1 FROM activities WHERE subject = ?`).get(`Website enquiry #${sub.id}`)) continue;
      const when = sub.created_at || now();
      const body = [lead.message, lead.details && `\n${lead.details}`].filter(Boolean).join('\n');
      const existing = lead.email ? db.prepare('SELECT * FROM leads WHERE lower(email) = ?').get(lead.email) : null;
      if (existing) {
        logActivity(existing.id, { type: 'email', direction: 'in', subject: `Website enquiry #${sub.id}`, body: `Via ${lead.formName}\n\n${body}` });
        db.prepare(`UPDATE leads SET stage = CASE WHEN stage IN ('new','contacted') THEN 'replied' ELSE stage END,
          next_follow_up_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), existing.id);
        db.prepare(`UPDATE enrollments SET status='stopped' WHERE lead_id = ? AND status='active'`).run(existing.id);
        matched++;
        continue;
      }
      const row = {
        first_name: lead.first_name, last_name: lead.last_name, email: lead.email, company: lead.company, title: lead.title,
        phone: lead.phone, website: lead.website, source: `Website: ${lead.formName}`, stage: 'new', external_id: externalId,
        tags: 'inbound', notes: lead.message || null,
        // Inbound enquiries are the hottest leads there are: due for a reply straight away.
        next_follow_up_at: when, created_at: when, updated_at: now(),
      };
      row.score = Math.min(100, scoreLead(row) + 30);
      const cols = Object.keys(row);
      const id = db.prepare(`INSERT INTO leads(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row)).lastInsertRowid;
      db.prepare('INSERT INTO activities(lead_id, type, direction, subject, body, created_at) VALUES (?,?,?,?,?,?)')
        .run(id, 'email', 'in', `Website enquiry #${sub.id}`, `Via ${lead.formName}\n\n${body}`, when);
      created++;
    }
  });
  return { created, matched };
}

export default {
  id: 'netlify',
  name: 'Website enquiries (Netlify Forms)',
  category: 'Inbound leads',
  docs: 'https://app.netlify.com/user/applications#personal-access-tokens',
  fields: [
    { key: 'netlify.site', label: 'Site (your domain, e.g. mccrackenmarketing.co.uk, or the Netlify site ID)' },
    { key: 'netlify.token', label: 'Netlify personal access token', secret: true },
  ],
  configured: () => !!getSetting('netlify.token'),

  async sync({ from }) {
    const site = encodeURIComponent(getSetting('netlify.site') || 'mccrackenmarketing.co.uk');
    const headers = { authorization: `Bearer ${getSetting('netlify.token')}` };
    const forms = await getJson(`${API()}/sites/${site}/forms`, { headers });
    const formNames = Object.fromEntries((forms || []).map((f) => [f.id, f.name]));

    const subs = [];
    for (let page = 1; page <= 20; page++) {
      const batch = await getJson(`${API()}/sites/${site}/submissions?per_page=100&page=${page}`, { headers });
      if (!Array.isArray(batch) || !batch.length) break;
      subs.push(...batch);
      if (batch.length < 100) break;
    }

    // Every enquiry ever received becomes a lead (once); metrics cover the sync window.
    upsertEnquiries(subs.map((s) => ({ sub: s, lead: submissionToLead(s, formNames[s.form_id]) })));
    const counts = new Map();
    for (const s of subs) {
      const date = String(s.created_at || '').slice(0, 10);
      if (!date || date < from) continue;
      const form = formNames[s.form_id] || s.form_name || 'Website form';
      for (const key of [`${date}|`, `${date}|${form}`]) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts].map(([key, value]) => {
      const [date, dim] = key.split('|');
      return { source: 'forms', metric: 'enquiries', date, value, ...(dim ? { dim_type: 'campaign', dim } : {}) };
    });
  },
};

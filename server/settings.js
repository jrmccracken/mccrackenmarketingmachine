import { db } from './db.js';

// Defaults for the editable workspace settings. Secrets live alongside but are masked on read.
export const DEFAULTS = {
  'company.name': 'McCracken Marketing',
  'company.website': '',
  'company.services': 'Strategy, paid media, SEO, content and outbound for B2B companies',
  'company.icp': 'B2B companies with 20-500 staff that need predictable pipeline, typically SaaS, professional services and manufacturing.',
  'company.tone': 'Plain-spoken, confident, specific. No fluff, no buzzwords.',
  'sender.name': '',
  'sender.email': '',
  'sender.signature': '',
  'monitor.pr_keywords': 'marketing agency, B2B marketing, journalist request, #journorequest, expert comment, marketing trends, AI search, ChatGPT ads',
  'monitor.outbound_keywords': 'raises seed, series A funding, appoints marketing director, hiring head of marketing, rebrand, launches new product, expands into UK',
  'monitor.icp_terms': 'SaaS, B2B, software, manufacturing, professional services, fintech',
  'monitor.region': 'GB',
  'outreach.auto_send': 'false',
  'outreach.daily_limit': '40',
};

export const SECRET_KEYS = new Set([
  'instantly.api_key',
  'netlify.token',
  'google.service_account_json',
  'google_ads.developer_token', 'google_ads.client_secret', 'google_ads.refresh_token',
  'openai_ads.api_key',
  'linkedin.access_token',
  'meta.access_token',
  'smtp.pass',
  'anthropic.api_key',
]);

// Settings keys can also be supplied through the environment: 'google_ads.customer_id' -> GOOGLE_ADS_CUSTOMER_ID.
const envName = (key) => key.toUpperCase().replace(/[.\s-]/g, '_');

export function getSetting(key) {
  const env = process.env[envName(key)];
  if (env !== undefined && env !== '') return env;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value !== null && row.value !== '') return row.value;
  return DEFAULTS[key] ?? '';
}

export function setSettings(obj) {
  const upsert = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(obj)) {
    // A masked secret coming back from the UI means "unchanged".
    if (SECRET_KEYS.has(key) && typeof value === 'string' && value.startsWith('••••')) continue;
    upsert.run(key, value == null ? '' : String(value));
  }
}

export function allSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  for (const key of SECRET_KEYS) out[key] = out[key] ?? '';
  for (const key of Object.keys(out)) {
    const env = process.env[envName(key)];
    if (env) out[key] = env;
    if (SECRET_KEYS.has(key) && out[key]) out[key] = '••••' + String(out[key]).slice(-4);
  }
  return out;
}

export const listSetting = (key) => getSetting(key).split(',').map((s) => s.trim()).filter(Boolean);

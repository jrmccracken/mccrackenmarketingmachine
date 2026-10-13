import crypto from 'node:crypto';
import { getSetting } from '../settings.js';

const cache = new Map();

/** Access token for a Google service account (GA4 + Search Console). */
export async function serviceAccountToken(scope) {
  const raw = getSetting('google.service_account_json');
  if (!raw) throw new Error('Google service account JSON is not configured');
  const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  const key = `${sa.client_email}|${scope}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;

  const iat = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
  })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${body.error_description || body.error || res.status}`);
  cache.set(key, { token: body.access_token, expires: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

/** Access token from an OAuth refresh token (Google Ads). */
export async function refreshToken({ clientId, clientSecret, refreshToken }) {
  const key = `rt|${clientId}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google OAuth error: ${body.error_description || body.error || res.status}`);
  cache.set(key, { token: body.access_token, expires: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

export async function getJson(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || body?.error_description || text.slice(0, 300);
    throw new Error(`${res.status} from ${new URL(url).host}: ${msg}`);
  }
  return body;
}

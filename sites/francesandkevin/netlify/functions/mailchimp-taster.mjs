import crypto from 'node:crypto';

const AUDIENCE_ID = 'e05bb9a0bf';
const SERVER_PREFIX = 'us3';
const TAG_NAME = 'Marketing Director Taster';

export const config = {
  path: "/.netlify/functions/mailchimp-taster",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip"] },
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed' });

  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey) return response(500, { ok: false, error: 'Mailchimp is not configured' });

  if ((event.body || '').length > 12000) return response(413, { ok: false, error: 'Request too large' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return response(400, { ok: false, error: 'Invalid request' }); }

  const email = String(payload.email || '').trim().toLowerCase();
  const firstName = String(payload.firstName || '').trim().slice(0, 100);
  const consent = payload.consent === true;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email) || email.length > 254) return response(400, { ok: false, error: 'A valid email is required' });
  if (!consent) return response(400, { ok: false, error: 'Email opt-in is required for Mailchimp sync' });

  const subscriberHash = crypto.createHash('md5').update(email).digest('hex');
  const base = `https://${SERVER_PREFIX}.api.mailchimp.com/3.0`;
  const auth = `Basic ${Buffer.from(`francesandkevin:${apiKey}`).toString('base64')}`;
  const headers = { 'Authorization': auth, 'Content-Type': 'application/json' };

  const memberBody = {
    email_address: email,
    status_if_new: 'subscribed',
  };
  if (firstName) memberBody.merge_fields = { FNAME: firstName };

  let memberRes = await fetch(`${base}/lists/${AUDIENCE_ID}/members/${subscriberHash}`, {
    method: 'PUT', headers, body: JSON.stringify(memberBody),
  });
  let memberData = await memberRes.json().catch(() => ({}));

  // Some audiences do not use the default FNAME merge field. Retry without it rather than lose the lead.
  if (!memberRes.ok && firstName && /merge/i.test(JSON.stringify(memberData))) {
    delete memberBody.merge_fields;
    memberRes = await fetch(`${base}/lists/${AUDIENCE_ID}/members/${subscriberHash}`, {
      method: 'PUT', headers, body: JSON.stringify(memberBody),
    });
    memberData = await memberRes.json().catch(() => ({}));
  }

  if (!memberRes.ok) {
    console.error('Mailchimp member error', memberRes.status, memberData);
    return response(502, { ok: false, error: 'Mailchimp contact sync failed' });
  }

  const tagRes = await fetch(`${base}/lists/${AUDIENCE_ID}/members/${subscriberHash}/tags`, {
    method: 'POST', headers, body: JSON.stringify({ tags: [{ name: TAG_NAME, status: 'active' }] }),
  });
  if (!tagRes.ok) {
    const tagData = await tagRes.json().catch(() => ({}));
    console.error('Mailchimp tag error', tagRes.status, tagData);
    return response(502, { ok: false, error: 'Contact saved but tag could not be applied', status: memberData.status });
  }

  return response(200, {
    ok: true,
    status: memberData.status,
    tag: TAG_NAME,
  });
}

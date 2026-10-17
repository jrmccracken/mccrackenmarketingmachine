import nodemailer from 'nodemailer';
import { getSetting } from '../settings.js';

export function smtpConfigured() {
  return !!(getSetting('smtp.host') && getSetting('smtp.user') && getSetting('smtp.pass'));
}

let transport;
let transportKey;
function getTransport() {
  const key = ['smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass'].map(getSetting).join('|');
  if (!transport || key !== transportKey) {
    const port = Number(getSetting('smtp.port') || 587);
    transport = nodemailer.createTransport({
      host: getSetting('smtp.host'),
      port,
      secure: port === 465,
      auth: { user: getSetting('smtp.user'), pass: getSetting('smtp.pass') },
      // Fail in seconds rather than minutes when the mail server can't be reached.
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
    transportKey = key;
  }
  return transport;
}

export async function sendMail({ to, subject, text }) {
  if (!smtpConfigured()) throw new Error('SMTP is not configured (Settings → Sending)');
  const fromEmail = getSetting('sender.email') || getSetting('smtp.user');
  const fromName = getSetting('sender.name');
  const signature = getSetting('sender.signature');
  try {
    return await getTransport().sendMail({
      from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
      to,
      subject,
      text: signature ? `${text}\n\n${signature}` : text,
    });
  } catch (err) {
    throw new Error(explainMailError(err));
  }
}

/** Turn raw SMTP errors into something a person can act on. */
export function explainMailError(err) {
  const msg = String(err?.message || err);
  const host = getSetting('smtp.host') || 'the mail server';
  if (err?.code === 'EAUTH' || /\b535\b|534|Username and Password not accepted|Invalid login|authentication failed/i.test(msg)) {
    return /gmail|google/i.test(host)
      ? 'Gmail rejected the login. Use a Google app password (myaccount.google.com/apppasswords) as the SMTP password, not your normal password, and your full email as the username.'
      : `${host} rejected the username or password. Check the SMTP username and password in Settings → Sending.`;
  }
  if (err?.code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(msg)) return `Couldn't find the mail server "${host}". Check the SMTP host in Settings → Sending (for Google Workspace it's smtp.gmail.com).`;
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED'].includes(err?.code) || /timeout|ECONNREFUSED|ECONNRESET/i.test(msg)) {
    return `Couldn't connect to ${host} on port ${getSetting('smtp.port') || 587}. Check the port (465 for Gmail). If the dashboard is on Render's free plan, Render blocks email ports, so switch the service to the Starter plan or use "Open in Gmail" instead.`;
  }
  if (/wrong version number|SSL routines/i.test(msg)) return 'The SMTP port and security don\'t match. Use port 465 for Gmail (or 587 for Microsoft 365).';
  return msg;
}

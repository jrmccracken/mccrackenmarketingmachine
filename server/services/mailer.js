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
  return getTransport().sendMail({
    from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
    to,
    subject,
    text: signature ? `${text}\n\n${signature}` : text,
  });
}

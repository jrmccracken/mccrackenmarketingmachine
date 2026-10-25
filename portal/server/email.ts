import { config } from './env.ts';

export interface Email { to: string; subject: string; text: string; html: string; tag: string }

/** Emails "sent" while EMAIL_MODE=capture. Used by tests and local development; nothing leaves the machine. */
export const capturedEmails: Email[] = [];

export async function sendEmail(email: Email): Promise<void> {
  const c = config();
  if (c.emailMode === 'capture') {
    capturedEmails.push(email);
    if (process.env.NODE_ENV !== 'test' && !process.env.QUIET_EMAIL) console.log(`[email captured] to=${email.to} subject="${email.subject}"\n${email.text}\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${c.resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: c.fromEmail, to: [email.to], subject: email.subject, text: email.text, html: email.html, tags: [{ name: 'type', value: email.tag }] }),
  });
  if (!res.ok) throw new Error(`Email could not be sent (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** Plain, branded email. Paragraphs are plain text; one optional button. */
export function layout({ heading, paragraphs, button, list, footer }: {
  heading: string; paragraphs: string[]; button?: { label: string; url: string }; list?: string[]; footer?: string;
}): { html: string; text: string } {
  const foot = footer || 'You are receiving this because you have access to a McCracken Marketing client workspace.';
  const html = `<!doctype html><html lang="en-GB"><body style="margin:0;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;color:#14261b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1e7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4dccb">
<tr><td style="background:#1b3d2b;padding:18px 24px;color:#ffffff;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold">McCracken Marketing · Marketing Control Centre</td></tr>
<tr><td style="padding:28px 24px 8px"><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:24px;line-height:1.25;color:#14261b">${esc(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55">${esc(p)}</p>`).join('')}
${list?.length ? `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.55">${list.map((li) => `<li style="margin-bottom:6px">${esc(li)}</li>`).join('')}</ul>` : ''}
${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#67df3e;color:#0c1f13;font-weight:bold;font-size:16px;text-decoration:none;padding:13px 22px">${esc(button.label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#4a5a50">If the button doesn't work, copy this address into your browser:<br><span style="word-break:break-all">${esc(button.url)}</span></p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px 24px;font-size:13px;line-height:1.5;color:#4a5a50;border-top:1px solid #e4dccb">${esc(foot)}<br>McCracken Marketing · mccrackenmarketing.co.uk</td></tr>
</table></td></tr></table></body></html>`;
  const text = [heading, '', ...paragraphs.flatMap((p) => [p, '']), ...(list?.length ? [...list.map((l) => `- ${l}`), ''] : []),
    ...(button ? [`${button.label}: ${button.url}`, ''] : []), '--', foot, 'McCracken Marketing · mccrackenmarketing.co.uk'].join('\n');
  return { html, text };
}

// ---------------------------------------------------------------- templates

export function signInEmail(to: string, url: string, firstTime: boolean): Email {
  const body = layout({
    heading: firstTime ? 'Your Marketing Control Centre workspace' : 'Your sign-in link',
    paragraphs: firstTime
      ? ['James McCracken has set up a private Marketing Control Centre workspace for you. It is where we will share onboarding tasks, priorities, findings and documents.',
        'Use the button below to sign in. The link works once and expires after 15 minutes. You can request a new one at any time from the sign-in page.']
      : ['Use the button below to sign in to the Marketing Control Centre. The link works once and expires after 15 minutes.',
        "If you didn't ask for this, you can ignore this email."],
    button: { label: 'Sign in', url },
  });
  return { to, subject: firstTime ? "You've been invited to the McCracken Marketing Control Centre" : 'Your Marketing Control Centre sign-in link', tag: firstTime ? 'invitation' : 'sign_in', ...body };
}

export function actionAssignedEmail(to: string, workspace: string, url: string): Email {
  const body = layout({
    heading: 'A new action needs your attention',
    paragraphs: [`McCracken Marketing has added an important action for you in the ${workspace} workspace.`, 'Sign in to see the details and update its progress.'],
    button: { label: 'View the action', url },
  });
  return { to, subject: 'New action in your Marketing Control Centre workspace', tag: 'action_assigned', ...body };
}

export function weeklyReminderEmail(to: string, sections: { workspace: string; url: string; lines: string[] }[]): Email {
  const list = sections.flatMap((s) => (sections.length > 1 ? [`${s.workspace}:`] : []).concat(s.lines));
  const body = layout({
    heading: 'Your outstanding items this week',
    paragraphs: [sections.length === 1
      ? `Here is what is still outstanding in the ${sections[0].workspace} workspace.`
      : 'Here is what is still outstanding in your workspaces.'],
    list,
    button: { label: 'Open your workspace', url: sections[0].url },
    footer: 'You receive this reminder on Mondays while you have outstanding items. Reply to this email if anything is out of date.',
  });
  return { to, subject: 'Your weekly Marketing Control Centre update', tag: 'weekly_reminder', ...body };
}

export function adminAlertEmail(to: string, workspace: string, url: string, lines: string[]): Email {
  const body = layout({
    heading: `Client activity: ${workspace}`,
    paragraphs: [`There ${lines.length === 1 ? 'is 1 new update' : `are ${lines.length} new updates`} in the ${workspace} workspace.`],
    list: lines.slice(0, 20).concat(lines.length > 20 ? [`…and ${lines.length - 20} more`] : []),
    button: { label: 'Open the workspace', url },
    footer: 'Sent to the Marketing Control Centre administrator. Updates are grouped so rapid edits arrive as one email.',
  });
  return { to, subject: 'Marketing Control Centre: new client activity', tag: 'admin_alert', ...body };
}

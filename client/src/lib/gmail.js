/** A Gmail compose link with the email filled in. Works without any SMTP setup. */
export function gmailLink({ to, subject, body }) {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to || '')}&su=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
}

/** Fill {{variables}} from a lead, matching the server's render(). */
export function fillVars(text, lead, extra = {}) {
  const vars = {
    first_name: lead.first_name || 'there', last_name: lead.last_name || '', company: lead.company || 'your company',
    title: lead.title || '', industry: lead.industry || '', website: lead.website || '', ...extra,
  };
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

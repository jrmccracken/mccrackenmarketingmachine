import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, PageHead, useFetch, useAction, Loading } from '../components/ui.jsx';

const SECTIONS = [
  ['Company', 'Used by the AI strategist, lead scoring and drafts.', [
    ['company.name', 'Company name'], ['company.website', 'Website'],
    ['company.services', 'What you sell', 'area'], ['company.icp', 'Ideal customer profile', 'area'], ['company.tone', 'Tone of voice', 'area'],
  ]],
  ['Market radar', 'Comma-separated. Each keyword becomes a Google News search scanned every 2 hours.', [
    ['monitor.pr_keywords', 'PR keywords (journalist requests, topics you can comment on)', 'area'],
    ['monitor.outbound_keywords', 'Outbound triggers (funding, hires, launches)', 'area'],
    ['monitor.icp_terms', 'ICP terms that boost a score (industries, company types)', 'area'],
    ['monitor.region', 'News region (GB, US, IE, AU…)'],
  ]],
  ['Sending', 'Outreach sends through your own mailbox over SMTP. For Google Workspace use smtp.gmail.com, port 465 and an app password.', [
    ['sender.name', 'From name'], ['sender.email', 'From email'], ['sender.signature', 'Signature', 'area'],
    ['smtp.host', 'SMTP host'], ['smtp.port', 'SMTP port'], ['smtp.user', 'SMTP username'], ['smtp.pass', 'SMTP password', 'secret'],
    ['outreach.daily_limit', 'Daily send limit'],
    ['outreach.auto_send', 'Auto-approve sequence emails (true / false)'],
  ]],
  ['AI strategist', 'Writes weekly briefs, extra recommendations, pitches and personalised emails using Claude.', [
    ['anthropic.api_key', 'Anthropic API key', 'secret'],
  ]],
];

export default function Settings() {
  const { data } = useFetch('/settings');
  const [vals, setVals] = useState(null);
  const [busy, run] = useAction();
  useEffect(() => { if (data) setVals(data); }, [data]);
  if (!vals) return <Loading />;
  const save = () => run('s', () => api.put('/settings', vals).then(setVals), 'Settings saved');
  return (
    <div className="stack">
      <PageHead title="Settings" sub="Workspace configuration.">
        <button className="btn primary" disabled={!!busy} onClick={save}>Save settings</button>
      </PageHead>
      {SECTIONS.map(([title, sub, fields]) => (
        <Card key={title} title={title} sub={sub}>
          <div className="grid cols-2">
            {fields.map(([k, label, type]) => (
              <label className="field" key={k} style={type === 'area' ? { gridColumn: '1 / -1' } : undefined}>{label}
                {type === 'area'
                  ? <textarea className="input" rows={2} value={vals[k] || ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
                  : <input className="input" type={type === 'secret' ? 'password' : 'text'} autoComplete="off" value={vals[k] || ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />}
              </label>
            ))}
          </div>
        </Card>
      ))}
      <div><button className="btn primary" disabled={!!busy} onClick={save}>Save settings</button></div>
    </div>
  );
}

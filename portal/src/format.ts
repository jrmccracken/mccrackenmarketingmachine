const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtDate = (d?: string | null) => (d ? dateFmt.format(new Date(d.length === 10 ? `${d}T12:00:00` : d)) : '');
export const fmtDateTime = (d?: string | null) => (d ? dateTimeFmt.format(new Date(d)) : '');
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const isOverdue = (due?: string | null, status?: string) => !!due && due < todayIso() && !['done', 'not_applicable', 'completed', 'cancelled'].includes(status || '');

export function fmtSize(bytes?: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ago(d: string) {
  const mins = Math.round((Date.now() - Date.parse(d)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return fmtDate(d);
}

export const LABELS: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', done: 'Done', not_applicable: 'Not applicable', blocked: 'Blocked',
  to_schedule: 'To schedule', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled',
  draft: 'Draft (only you)', shared: 'Shared', agreed: 'Agreed', closed: 'Closed',
  active: 'Active', suspended: 'Suspended', archived: 'Archived',
  pending: 'Not invited yet', invited: 'Invited', accepted: 'Signed in', revoked: 'Removed',
  client: 'Client', mccracken: 'McCracken Marketing', high: 'High', medium: 'Medium', low: 'Low', overdue: 'Overdue',
};
export const label = (v?: string | null) => (v ? LABELS[v] || v : '');

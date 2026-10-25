import { config } from './env.ts';
import { serviceClient } from './supabase.ts';
import { adminAlertEmail, sendEmail, weeklyReminderEmail } from './email.ts';
import { cleanStalePending } from './workspace.ts';

// ---------------------------------------------------------------- administrator alerts

/** Wait this long after a client's last change before emailing, so a burst of edits becomes one email. */
export const QUIET_MINUTES = 5;
/** ...but never hold an update back longer than this. */
export const MAX_DELAY_MINUTES = 30;

/**
 * Groups unalerted client activity by workspace and emails the administrator once per workspace.
 * Runs every 5 minutes from a Netlify scheduled function.
 */
export async function sendAdminAlerts(now = new Date()): Promise<{ emails: number; entries: number }> {
  const service = serviceClient();
  const { data: rows, error } = await service.from('activity')
    .select('id, workspace_id, description, created_at').is('alerted_at', null).eq('actor_role', 'client').order('created_at').limit(1000);
  if (error) throw error;
  const groups = new Map<string, typeof rows>();
  for (const r of rows || []) groups.set(r.workspace_id, [...(groups.get(r.workspace_id) || []), r]);

  let emails = 0, entries = 0;
  for (const [ws, items] of groups) {
    const newest = Date.parse(items[items.length - 1].created_at);
    const oldest = Date.parse(items[0].created_at);
    const quiet = now.getTime() - newest >= QUIET_MINUTES * 60_000;
    const overdue = now.getTime() - oldest >= MAX_DELAY_MINUTES * 60_000;
    if (!quiet && !overdue) continue;
    // Claim the rows first so an overlapping run can't email them again.
    const { data: claimed } = await service.from('activity').update({ alerted_at: now.toISOString() })
      .in('id', items.map((i) => i.id)).is('alerted_at', null).select('id, description');
    if (!claimed?.length) continue;
    const { data: workspace } = await service.from('workspaces').select('name').eq('id', ws).single();
    try {
      await sendEmail(adminAlertEmail(config().adminEmail, workspace?.name || 'a client', `${config().siteUrl}/workspaces/${ws}?tab=activity`, claimed.map((c) => c.description)));
      emails++; entries += claimed.length;
    } catch (err) {
      // Release the claim so the next run retries.
      await service.from('activity').update({ alerted_at: null }).in('id', claimed.map((c) => c.id));
      console.error('[admin alert]', (err as Error).message);
    }
  }
  await cleanStalePending();
  return { emails, entries };
}

// ---------------------------------------------------------------- weekly reminders

const LONDON = 'Europe/London';

/** The hour (0-23) and ISO date in London for a given instant. */
export function londonParts(d: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday as string };
}

/** Monday of the London week containing d, as YYYY-MM-DD. */
export function weekStart(d: Date): string {
  const { date } = londonParts(d);
  const day = new Date(`${date}T12:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

export interface ReminderPlan { user_id: string; email: string; sections: { workspace_id: string; workspace: string; url: string; lines: string[] }[] }

/** Works out who has something outstanding. Pure read; sends nothing. */
export async function planReminders(now = new Date()): Promise<ReminderPlan[]> {
  const service = serviceClient();
  const today = londonParts(now).date;
  const { data: workspaces } = await service.from('workspaces').select('id, name').eq('status', 'active');
  const plans = new Map<string, ReminderPlan>();
  for (const w of workspaces || []) {
    const [{ data: items }, { data: actions }, { data: members }] = await Promise.all([
      service.from('checklist_items').select('item, due_date').eq('workspace_id', w.id).eq('owner_type', 'client').is('deleted_at', null)
        .in('status', ['not_started', 'in_progress']).order('sort_order'),
      service.from('actions').select('action, due_date, owner_id').eq('workspace_id', w.id).eq('owner_type', 'client').is('deleted_at', null)
        .neq('status', 'done').lt('due_date', today),
      service.from('workspace_members').select('user_id, profile:profiles(email, role)').eq('workspace_id', w.id).in('invitation_status', ['invited', 'accepted']),
    ]);
    for (const m of (members || []) as any[]) {
      if (m.profile?.role !== 'client') continue;
      const mine = (actions || []).filter((a) => !a.owner_id || a.owner_id === m.user_id);
      const lines = [
        ...(items || []).length ? [`${items!.length} onboarding checklist item${items!.length === 1 ? '' : 's'} still to complete`] : [],
        ...mine.map((a) => `Overdue action: ${a.action} (due ${a.due_date})`),
      ];
      if (!lines.length) continue;
      const plan: ReminderPlan = plans.get(m.user_id) || { user_id: m.user_id, email: m.profile.email, sections: [] };
      plan.sections.push({ workspace_id: w.id, workspace: w.name, url: `${config().siteUrl}/workspaces/${w.id}`, lines });
      plans.set(m.user_id, plan);
    }
  }
  return [...plans.values()];
}

/**
 * Sends one consolidated reminder per client. Safe to call repeatedly: reminder_log allows one send
 * per person per week. Scheduled for 08:00 and 09:00 UTC on Mondays; only the run at 09:00 London time sends.
 */
export async function sendWeeklyReminders({ now = new Date(), dryRun = false, ignoreClock = false } = {}) {
  const london = londonParts(now);
  if (!ignoreClock && (london.weekday !== 'Mon' || london.hour !== 9)) {
    return { skipped: `Not 09:00 on a Monday in London (it is ${london.weekday} ${london.hour}:00)`, sent: 0, planned: [] as ReminderPlan[] };
  }
  const plans = await planReminders(now);
  if (dryRun) return { dryRun: true, sent: 0, planned: plans };
  const service = serviceClient();
  const week = weekStart(now);
  let sent = 0, alreadySent = 0;
  for (const plan of plans) {
    const count = plan.sections.reduce((n, s) => n + s.lines.length, 0);
    // Claim this person's slot for the week before sending, so a second run can't send twice.
    const { data: claimed } = await service.from('reminder_log').upsert({ user_id: plan.user_id, week_start: week, item_count: count },
      { onConflict: 'user_id,week_start', ignoreDuplicates: true }).select('user_id');
    if (!claimed?.length) { alreadySent++; continue; }
    try {
      await sendEmail(weeklyReminderEmail(plan.email, plan.sections));
      sent++;
      for (const s of plan.sections) {
        await service.from('activity').insert({ workspace_id: s.workspace_id, action_type: 'reminder_sent', description: `Weekly reminder emailed to ${plan.email} (${s.lines.length} item${s.lines.length === 1 ? '' : 's'})`, alerted_at: new Date().toISOString() });
        await service.from('notifications').upsert({ recipient_id: plan.user_id, workspace_id: s.workspace_id, type: 'weekly_reminder', title: 'Weekly reminder: you have outstanding items', link: `/workspaces/${s.workspace_id}`, dedupe_key: `weekly:${week}:${s.workspace_id}`, emailed_at: new Date().toISOString() },
          { onConflict: 'recipient_id,dedupe_key', ignoreDuplicates: true });
      }
    } catch (err) {
      await service.from('reminder_log').delete().eq('user_id', plan.user_id).eq('week_start', week);
      console.error('[weekly reminder]', plan.email, (err as Error).message);
    }
  }
  return { sent, alreadySent, week, planned: plans };
}

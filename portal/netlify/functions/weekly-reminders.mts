import type { Config } from '@netlify/functions';
import { sendWeeklyReminders } from '../../server/jobs.ts';

// Netlify schedules run in UTC. Running at 08:00 and 09:00 UTC on Mondays covers 09:00 in London in
// both British Summer Time and GMT; the function only sends on the run that is 09:00 in London.
// Scheduled functions can't be called by URL in production, so this can't be triggered publicly.
export default async () => {
  const result = await sendWeeklyReminders();
  console.log('[weekly-reminders]', JSON.stringify({ ...result, planned: result.planned.length }));
};

export const config: Config = { schedule: '0 8,9 * * 1' };

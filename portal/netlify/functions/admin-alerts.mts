import type { Config } from '@netlify/functions';
import { sendAdminAlerts } from '../../server/jobs.ts';

// Scheduled functions can't be called by URL in production, so this can't be triggered publicly.
export default async () => {
  const result = await sendAdminAlerts();
  console.log('[admin-alerts]', JSON.stringify(result));
};

export const config: Config = { schedule: '*/5 * * * *' };

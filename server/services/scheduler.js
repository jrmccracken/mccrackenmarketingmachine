import { syncAll } from './sync.js';
import { refreshRecommendations } from './recommendations.js';
import { runMonitor } from './monitor.js';
import { runSequences, flushOutbox } from './outreach.js';

const HOUR = 3_600_000;
const jobs = [
  { name: 'sync', every: 6 * HOUR, run: async () => { await syncAll({ days: 30 }); refreshRecommendations(); } },
  { name: 'monitor', every: 2 * HOUR, run: runMonitor },
  { name: 'outreach', every: 0.25 * HOUR, run: async () => { runSequences(); await flushOutbox(); } },
  { name: 'recommendations', every: 1 * HOUR, run: refreshRecommendations },
];

export const jobState = Object.fromEntries(jobs.map((j) => [j.name, { lastRun: null, lastError: null, running: false }]));

async function runJob(job) {
  const st = jobState[job.name];
  if (st.running) return;
  st.running = true;
  try { await job.run(); st.lastError = null; } catch (err) { st.lastError = err.message; console.error(`[${job.name}]`, err.message); }
  st.lastRun = new Date().toISOString();
  st.running = false;
}

export function startScheduler() {
  if (process.env.MMM_DISABLE_SCHEDULER === '1') return;
  for (const job of jobs) {
    setTimeout(() => runJob(job), 5_000 + Math.random() * 10_000);
    setInterval(() => runJob(job), job.every).unref();
  }
}

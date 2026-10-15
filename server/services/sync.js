import { db, now } from '../db.js';
import { connectors, connectorById } from '../connectors/index.js';
import { writeMetrics, daysAgo } from '../metrics.js';

/** Pull the last `days` of data from one connector into the metrics store. */
export async function syncConnector(id, { days = 30, force = false } = {}) {
  const c = connectorById[id];
  if (!c) throw new Error(`Unknown connector ${id}`);
  if (!c.configured()) return { id, status: 'skipped', message: 'Not configured' };
  const from = daysAgo(days);
  const to = daysAgo(1);
  const run = db.prepare('INSERT INTO sync_runs(source, started_at, status) VALUES (?,?,?)').run(id, now(), 'running');
  try {
    const rows = await c.sync({ from, to, force });
    const n = rows.length ? writeMetrics(id, rows, c.keepsHistory ? {} : { from, to }) : 0;
    db.prepare('UPDATE sync_runs SET finished_at=?, status=?, rows=?, message=? WHERE id=?').run(now(), 'ok', n, `${from} → ${to}`, run.lastInsertRowid);
    return { id, status: 'ok', rows: n };
  } catch (err) {
    db.prepare('UPDATE sync_runs SET finished_at=?, status=?, message=? WHERE id=?').run(now(), 'error', String(err.message).slice(0, 500), run.lastInsertRowid);
    return { id, status: 'error', message: err.message };
  }
}

export async function syncAll(opts) {
  const results = [];
  for (const c of connectors) results.push(await syncConnector(c.id, opts));
  return results;
}

export function lastRuns() {
  return db.prepare(`SELECT r.* FROM sync_runs r JOIN (SELECT source, MAX(id) id FROM sync_runs GROUP BY source) m ON m.id = r.id`).all();
}

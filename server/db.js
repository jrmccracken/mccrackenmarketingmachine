import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The database lives outside the app folder (in the user's home folder) so that downloading a new version of the
// app never loses connections, leads or settings. MMM_DB_PATH overrides it.
export const DATA_DIR = path.join(os.homedir(), 'Marketing Machine data');
const DB_PATH = process.env.MMM_DB_PATH || path.join(DATA_DIR, 'mmm.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
if (!process.env.MMM_DB_PATH && !fs.existsSync(DB_PATH)) adoptOldDatabase(DB_PATH);

/**
 * Earlier versions kept the database at <app folder>/data/mmm.db, and each download of the app made a new folder.
 * Find those copies (this folder and its neighbours, e.g. other extracted downloads) and bring over the one with
 * the most real content. VACUUM INTO folds in any unsaved write-ahead log, so nothing saved is lost.
 */
function adoptOldDatabase(target) {
  const candidates = new Set([path.resolve('data/mmm.db')]);
  const ls = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)); } catch { return []; } };
  for (const sibling of ls(path.resolve('..'))) {
    candidates.add(path.join(sibling, 'data', 'mmm.db'));
    for (const inner of ls(sibling)) candidates.add(path.join(inner, 'data', 'mmm.db'));
  }
  let best = null;
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const old = new DatabaseSync(file);
      const count = (sql) => { try { return old.prepare(sql).get().n; } catch { return 0; } };
      // Saved connections and settings matter most, then real (non-demo) leads and data.
      const score = count('SELECT COUNT(*) n FROM settings') * 100
        + count(`SELECT COUNT(*) n FROM leads WHERE source IS NOT 'Demo data'`) * 10
        + count('SELECT COUNT(*) n FROM metrics WHERE demo = 0');
      old.close();
      if (score > 0 && (!best || score > best.score || (score === best.score && fs.statSync(file).mtimeMs > best.mtime))) {
        best = { file, score, mtime: fs.statSync(file).mtimeMs };
      }
    } catch { /* not a readable database: skip */ }
  }
  if (!best) return;
  const src = new DatabaseSync(best.file);
  src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  src.close();
  console.log(`Brought your saved data across from ${best.file}`);
}

export const db = new DatabaseSync(DB_PATH);
export const DB_FILE = DB_PATH;
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- One row per source / metric / day / dimension. dim_type '' + dim '' is the daily total.
CREATE TABLE IF NOT EXISTS metrics (
  source   TEXT NOT NULL,
  metric   TEXT NOT NULL,
  date     TEXT NOT NULL,
  dim_type TEXT NOT NULL DEFAULT '',
  dim      TEXT NOT NULL DEFAULT '',
  value    REAL NOT NULL,
  demo     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source, metric, date, dim_type, dim)
);
CREATE INDEX IF NOT EXISTS metrics_by_date ON metrics(source, date);

CREATE TABLE IF NOT EXISTS sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,
  message     TEXT,
  rows        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recommendations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT UNIQUE NOT NULL,
  source      TEXT NOT NULL,
  priority    TEXT NOT NULL,          -- high | medium | low
  title       TEXT NOT NULL,
  detail      TEXT NOT NULL,
  action      TEXT,
  impact      TEXT,
  status      TEXT NOT NULL DEFAULT 'open',  -- open | done | dismissed
  origin      TEXT NOT NULL DEFAULT 'rules', -- rules | ai
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS briefs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  body       TEXT NOT NULL,
  model      TEXT
);

CREATE TABLE IF NOT EXISTS opportunities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,      -- pr | outbound
  source        TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT UNIQUE NOT NULL,
  summary       TEXT,
  published_at  TEXT,
  found_at      TEXT NOT NULL,
  score         REAL NOT NULL DEFAULT 0,
  keywords      TEXT,
  status        TEXT NOT NULL DEFAULT 'new',  -- new | saved | actioned | dismissed
  lead_id       INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  demo          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS feeds (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  url     TEXT UNIQUE NOT NULL,
  kind    TEXT NOT NULL DEFAULT 'auto',  -- auto | pr | outbound
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS leads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name        TEXT,
  last_name         TEXT,
  email             TEXT,
  company           TEXT,
  title             TEXT,
  website           TEXT,
  linkedin          TEXT,
  phone             TEXT,
  industry          TEXT,
  source            TEXT,
  stage             TEXT NOT NULL DEFAULT 'new', -- new | contacted | replied | meeting | proposal | won | lost
  score             INTEGER NOT NULL DEFAULT 0,
  value             REAL DEFAULT 0,
  tags              TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_contacted_at TEXT,
  next_follow_up_at TEXT,
  unsubscribed      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS leads_email ON leads(lower(email)) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- email | call | linkedin | meeting | note | stage
  direction  TEXT,            -- out | in
  subject    TEXT,
  body       TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  subject TEXT NOT NULL,
  body    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sequences (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,
  steps  TEXT NOT NULL   -- JSON: [{ "day": 0, "template_id": 1 }, ...]
);

CREATE TABLE IF NOT EXISTS enrollments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step        INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active', -- active | paused | finished | stopped
  created_at  TEXT NOT NULL,
  UNIQUE (lead_id, sequence_id)
);

CREATE TABLE IF NOT EXISTS outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  enrollment_id INTEGER REFERENCES enrollments(id) ON DELETE SET NULL,
  to_email      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | approved | sent | failed | cancelled
  error         TEXT,
  created_at    TEXT NOT NULL,
  sent_at       TEXT
);
`);

export const now = () => new Date().toISOString();

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Additive migrations for databases created by earlier versions.
const leadCols = new Set(db.prepare('PRAGMA table_info(leads)').all().map((c) => c.name));
for (const [col, type] of [
  ['external_id', 'TEXT'], ['fit', 'TEXT'], ['pipeline', 'TEXT'], ['pipeline_status', 'TEXT'],
  ['replied_at', 'TEXT'], ['meeting_at', 'TEXT'],
]) if (!leadCols.has(col)) db.exec(`ALTER TABLE leads ADD COLUMN ${col} ${type}`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS leads_external ON leads(external_id) WHERE external_id IS NOT NULL');

// Website visitor log (from the "Website Visitor Log" Google Sheet fed by the site's tracking snippet).
db.exec(`CREATE TABLE IF NOT EXISTS visitor_events (
  t INTEGER NOT NULL, vid TEXT NOT NULL, type TEXT NOT NULL, path TEXT, title TEXT, ref TEXT, secs REAL,
  org TEXT, city TEXT, country TEXT, email TEXT, name TEXT, phone TEXT, company TEXT, form TEXT
);
CREATE INDEX IF NOT EXISTS visitor_events_t ON visitor_events(t);`);

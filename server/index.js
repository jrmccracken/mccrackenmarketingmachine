import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, DB_FILE } from './db.js';
import { api } from './routes/api.js';
import { startScheduler } from './services/scheduler.js';
import { seedWorkspace, seedDemoMetrics, seedDemoLeads, seedDemoOpportunities } from './demo.js';
import { refreshRecommendations } from './services/recommendations.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

// Health check for the hosting platform (no data, so it sits before the password check).
app.get('/healthz', (req, res) => res.send('ok'));

// Password protection. Required when hosted (credentials and leads live in the database); optional on a laptop.
const password = process.env.MMM_PASSWORD;
const hosted = !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME || process.env.MMM_HOSTED);
if (hosted && !password) {
  app.use((req, res) => res.status(503).send('Set the MMM_PASSWORD environment variable to finish setting up the Marketing Machine.'));
} else if (password) {
  const expected = crypto.createHash('sha256').update(password).digest();
  app.use((req, res, next) => {
    const [, b64] = (req.headers.authorization || '').split(' ');
    const decoded = Buffer.from(b64 || '', 'base64').toString();
    const given = decoded.slice(decoded.indexOf(':') + 1); // any username; passwords may contain ':'
    if (b64 && crypto.timingSafeEqual(crypto.createHash('sha256').update(given).digest(), expected)) return next();
    // A short pause on failure slows down password guessing.
    setTimeout(() => res.set('WWW-Authenticate', 'Basic realm="Marketing Machine", charset="UTF-8"').status(401).send('Password required'), b64 ? 800 : 0);
  });
}

app.use('/api', api);

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// First run: templates always; demo data unless disabled.
seedWorkspace();
const empty = !db.prepare('SELECT 1 FROM metrics LIMIT 1').get();
if (empty && process.env.MMM_DEMO !== '0') {
  seedDemoMetrics(); seedDemoLeads(); seedDemoOpportunities();
  console.log('Loaded demo data (set MMM_DEMO=0 to start empty).');
}
refreshRecommendations();
startScheduler();

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`Marketing Machine API on http://localhost:${port}`);
  console.log(`Your data is saved in ${DB_FILE}`);
});

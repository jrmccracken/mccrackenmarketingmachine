import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { db } from './db.js';
import { api } from './routes/api.js';
import { startScheduler } from './services/scheduler.js';
import { seedWorkspace, seedDemoMetrics, seedDemoLeads, seedDemoOpportunities } from './demo.js';
import { refreshRecommendations } from './services/recommendations.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

// Optional single-password protection for when this is deployed somewhere reachable.
const password = process.env.MMM_PASSWORD;
if (password) {
  app.use((req, res, next) => {
    const [, b64] = (req.headers.authorization || '').split(' ');
    const [, pass] = Buffer.from(b64 || '', 'base64').toString().split(':');
    if (pass === password) return next();
    res.set('WWW-Authenticate', 'Basic realm="Marketing Machine"').status(401).send('Authentication required');
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
app.listen(port, () => console.log(`Marketing Machine API on http://localhost:${port}`));

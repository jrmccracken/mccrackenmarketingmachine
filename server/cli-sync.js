import { syncAll } from './services/sync.js';
import { refreshRecommendations } from './services/recommendations.js';
import { runMonitor } from './services/monitor.js';

const days = Number(process.argv[2] || 30);
console.table(await syncAll({ days }));
console.log('Market radar:', await runMonitor());
console.log('Recommendations:', refreshRecommendations());

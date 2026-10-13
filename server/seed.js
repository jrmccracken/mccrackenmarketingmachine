import { seedDemoMetrics, seedWorkspace, seedDemoLeads, seedDemoOpportunities } from './demo.js';
import { refreshRecommendations } from './services/recommendations.js';

seedWorkspace();
seedDemoMetrics();
seedDemoLeads();
seedDemoOpportunities();
console.log(`Seeded demo data. ${refreshRecommendations()} recommendations generated.`);

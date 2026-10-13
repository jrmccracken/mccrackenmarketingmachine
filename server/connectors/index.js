import email from './instantly.js';
import ga4 from './ga4.js';
import gsc from './gsc.js';
import googleAds from './google-ads.js';
import openaiAds from './openai-ads.js';
import linkedin from './linkedin.js';
import meta from './meta.js';

export const connectors = [email, linkedin, meta, ga4, gsc, googleAds, openaiAds];
export const connectorById = Object.fromEntries(connectors.map((c) => [c.id, c]));

// Metric sources (what ends up in metrics.source) each connector writes.
export const SOURCES = {
  email: { label: 'Outbound email', connector: 'email' },
  linkedin: { label: 'LinkedIn', connector: 'linkedin' },
  facebook: { label: 'Facebook', connector: 'meta' },
  instagram: { label: 'Instagram', connector: 'meta' },
  ga4: { label: 'Website (GA4)', connector: 'ga4' },
  gsc: { label: 'Search Console', connector: 'gsc' },
  google_ads: { label: 'Google Ads', connector: 'google_ads' },
  openai_ads: { label: 'ChatGPT Ads', connector: 'openai_ads' },
};

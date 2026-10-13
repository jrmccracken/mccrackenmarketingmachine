import Anthropic from '@anthropic-ai/sdk';
import { getSetting } from '../settings.js';

export const MODEL = process.env.MMM_MODEL || 'claude-opus-5-5';

export function aiEnabled() {
  return !!(getSetting('anthropic.api_key') || process.env.ANTHROPIC_API_KEY);
}

function client() {
  return new Anthropic({ apiKey: getSetting('anthropic.api_key') || process.env.ANTHROPIC_API_KEY });
}

export function companyContext() {
  return [
    `Company: ${getSetting('company.name')} (${getSetting('company.website') || 'website not set'})`,
    `Services: ${getSetting('company.services')}`,
    `Ideal customer profile: ${getSetting('company.icp')}`,
    `Tone of voice: ${getSetting('company.tone')}`,
  ].join('\n');
}

/**
 * Single-turn call to Claude. Uses server-side refusal fallbacks so a declined request is retried on
 * Anthropic's recommended fallback model instead of failing.
 */
export async function ask({ system, prompt, effort = 'medium', maxTokens = 16000, schema }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system: `${system}\n\n${companyContext()}`,
    thinking: { type: 'adaptive' },
    output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: prompt }],
  };
  const res = await client().beta.messages.stream(params).finalMessage();
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return schema ? JSON.parse(text) : text;
}

/** Creates the administrator account (ADMIN_EMAIL) in Supabase. Safe to run more than once. */
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
process.env.EMAIL_MODE ||= 'capture';
const { ensureAdmin } = await import('../server/auth.ts');
await ensureAdmin();
console.log(`Administrator account ready for ${process.env.ADMIN_EMAIL}`);

/** Environment variables. Names are documented in .env.example and README.md. */
export interface Config {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  resendKey: string;
  fromEmail: string;
  adminEmail: string;
  siteUrl: string;
  /** 'send' delivers through Resend; 'capture' keeps emails in memory (tests and local development). */
  emailMode: 'send' | 'capture';
}

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_EMAIL', 'SITE_URL'] as const;

export function config(): Config {
  const env = process.env;
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  const emailMode = env.EMAIL_MODE === 'capture' ? 'capture' : 'send';
  if (emailMode === 'send' && (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL)) {
    throw new Error('Missing environment variables: RESEND_API_KEY, RESEND_FROM_EMAIL (or set EMAIL_MODE=capture for local testing)');
  }
  return {
    supabaseUrl: env.SUPABASE_URL!.replace(/\/$/, ''),
    anonKey: env.SUPABASE_ANON_KEY!,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!,
    resendKey: env.RESEND_API_KEY || '',
    fromEmail: env.RESEND_FROM_EMAIL || 'Marketing Control Centre <portal@example.invalid>',
    adminEmail: env.ADMIN_EMAIL!.trim().toLowerCase(),
    siteUrl: env.SITE_URL!.replace(/\/$/, ''),
    emailMode,
  };
}

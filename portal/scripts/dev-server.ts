/**
 * Local development: serves the React app through Vite and the API through the same handler
 * Netlify runs in production. Reads .env.local. Emails are captured, not sent, unless EMAIL_MODE=send.
 */
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer as createVite } from 'vite';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
process.env.EMAIL_MODE ||= 'capture';
const port = Number(process.env.PORT || 8888);
process.env.SITE_URL ||= `http://localhost:${port}`;

const { handle } = await import('../server/router.ts');
// --dist serves the production build with the same security headers as netlify.toml (npm run preview).
const serveDist = process.argv.includes('--dist');
const vite = serveDist ? null : await createVite({ server: { middlewareMode: true }, appType: 'spa' });

/** The [[headers]] for "/*" in netlify.toml, so local previews enforce the production CSP. */
function productionHeaders(): Record<string, string> {
  const toml = readFileSync('netlify.toml', 'utf8');
  const block = toml.split('[[headers]]').find((b) => b.includes('for = "/*"')) || '';
  return Object.fromEntries([...block.matchAll(/^\s+([A-Za-z-]+) = "(.*)"$/gm)].map((m) => [m[1], m[2]
    // Local only: plain http, and the local Supabase address for uploads.
    .replace('upgrade-insecure-requests', '').replace("connect-src 'self'", `connect-src 'self' ${new URL(process.env.SUPABASE_URL!).origin}`)]));
}
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
function serveStatic(url: string, res: ServerResponse) {
  const path = normalize(decodeURIComponent(url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join('dist', path);
  if (!existsSync(file) || !extname(file)) file = join('dist', 'index.html');
  res.writeHead(200, { ...productionHeaders(), 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  headers.set('x-nf-client-connection-ip', req.socket.remoteAddress || '');
  return new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method!) ? undefined : Buffer.concat(chunks) });
}

createHttp(async (req, res) => {
  if (req.url?.startsWith('/api/')) {
    const response = await handle(await toRequest(req));
    const headers: Record<string, string | string[]> = {};
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (vite) vite.middlewares(req, res);
  else serveStatic(req.url || '/', res);
}).listen(port, () => console.log(`Marketing Control Centre running at http://localhost:${port}`));

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, Browser, makeWorkspace, resetData, signIn, sql } from './helpers.ts';
import { checkUpload, contentMatches } from '../server/validate.ts';

let admin: Browser, alice: Browser, bob: Browser, wsA: string, wsB: string;
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');

before(async () => {
  resetData();
  admin = await signIn(ADMIN);
  ({ ws: wsA } = await makeWorkspace(admin, 'Alpha Ltd', 'alice@alpha.example'));
  ({ ws: wsB } = await makeWorkspace(admin, 'Beta Ltd', 'bob@beta.example'));
  alice = await signIn('alice@alpha.example');
  bob = await signIn('bob@beta.example');
});

async function upload(b: Browser, ws: string, name: string, mime: string, bytes: Uint8Array<ArrayBuffer>) {
  const start = await b.post(`/workspaces/${ws}/evidence/upload`, { file_name: name, mime_type: mime, size: bytes.length });
  if (start.status !== 201) return { start };
  const put = await fetch(start.data.upload_url, { method: 'PUT', headers: { 'content-type': start.data.content_type }, body: bytes });
  const done = await b.post(`/workspaces/${ws}/evidence/${start.data.id}/complete`);
  return { start, put, done };
}

test('file details are checked before an upload is allowed', async () => {
  assert.throws(() => checkUpload('virus.exe', 'application/octet-stream', 100), /isn't accepted/);
  assert.throws(() => checkUpload('page.html', 'text/html', 100), /isn't accepted/);
  assert.throws(() => checkUpload('big.pdf', 'application/pdf', 10 * 1024 * 1024 + 1), /10 MB/);
  assert.throws(() => checkUpload('report.pdf', 'image/png', 100), /doesn't match/);
  assert.throws(() => checkUpload('empty.pdf', 'application/pdf', 0), /empty/);
  assert.deepEqual(checkUpload('Plan.DOCX', '', 100), { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.ok(contentMatches('pdf', PDF));
  assert.ok(!contentMatches('pdf', new TextEncoder().encode('<html>not a pdf</html>')));
  assert.ok(!contentMatches('csv', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])));

  for (const [name, mime, size] of [['run.exe', 'application/x-msdownload', 10], ['big.pdf', 'application/pdf', 11 * 1024 * 1024], ['x.svg', 'image/svg+xml', 10]] as const) {
    const r = await alice.post(`/workspaces/${wsA}/evidence/upload`, { file_name: name, mime_type: mime, size });
    assert.equal(r.status, 400, name);
  }
});

test('a valid PDF uploads, is logged, and downloads through a short-lived signed link', async () => {
  const { done } = await upload(alice, wsA, 'Marketing plan 2026.pdf', 'application/pdf', PDF);
  assert.equal(done!.status, 200, JSON.stringify(done!.data));
  const id = done!.data.id;
  const path = sql(`select storage_path from evidence where id = '${id}'`);
  assert.match(path, new RegExp(`^${wsA}/[0-9a-f-]{36}\\.pdf$`), 'random, non-guessable storage path');
  assert.ok(sql(`select description from activity where record_id = '${id}'`).includes('uploaded "Marketing plan 2026.pdf"'));

  const dl = await alice.get(`/workspaces/${wsA}/evidence/${id}/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.data.expires_in, 60);
  const file = await fetch(dl.data.url);
  assert.equal(file.status, 200);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PDF);

  // Another client can't get a link, even by pairing the id with their own workspace.
  assert.equal((await bob.get(`/workspaces/${wsA}/evidence/${id}/download`)).status, 404);
  assert.equal((await bob.get(`/workspaces/${wsB}/evidence/${id}/download`)).status, 404);
  assert.equal((await new Browser().get(`/workspaces/${wsA}/evidence/${id}/download`)).status, 401);

  // The bucket is private: no public URL and no direct access with a client's own token.
  const base = process.env.SUPABASE_URL!;
  const pub = await fetch(`${base}/storage/v1/object/public/evidence/${path}`);
  assert.ok(pub.status >= 400, `public URL returned ${pub.status}`);
  const direct = await fetch(`${base}/storage/v1/object/authenticated/evidence/${path}`, {
    headers: { authorization: `Bearer ${alice.cookies.get('mcc_at')}`, apikey: process.env.SUPABASE_ANON_KEY! } });
  assert.ok(direct.status >= 400, `direct download with a client token returned ${direct.status}`);
  const list = await fetch(`${base}/storage/v1/object/list/evidence`, { method: 'POST',
    headers: { authorization: `Bearer ${bob.cookies.get('mcc_at')}`, apikey: process.env.SUPABASE_ANON_KEY!, 'content-type': 'application/json' }, body: JSON.stringify({ prefix: wsA }) });
  const listed = list.ok ? await list.json() : [];
  assert.equal(listed.length, 0, 'another client cannot list the files');
});

test('a file whose contents do not match its type is rejected and removed', async () => {
  const fake = new TextEncoder().encode('MZ this is really an executable');
  const { start, done } = await upload(alice, wsA, 'invoice.pdf', 'application/pdf', fake);
  assert.equal(done!.status, 400);
  assert.equal(sql(`select count(*) from evidence where id = '${start.data.id}'`), '0', 'record removed');
});

test('a file larger than declared cannot slip past the 10 MB limit', async () => {
  const big = new Uint8Array(11 * 1024 * 1024);
  big.set(PDF);
  const start = await alice.post(`/workspaces/${wsA}/evidence/upload`, { file_name: 'huge.pdf', mime_type: 'application/pdf', size: 1000 });
  assert.equal(start.status, 201);
  const put = await fetch(start.data.upload_url, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: big });
  const done = await alice.post(`/workspaces/${wsA}/evidence/${start.data.id}/complete`);
  assert.ok(!put.ok || done.status === 400, `storage accepted ${put.status} and completion returned ${done.status}`);
  assert.equal(done.status, 400);
  assert.equal(sql(`select count(*) from evidence where id = '${start.data.id}'`), '0');
});

test('a file cannot be stored with a disallowed type by changing the upload header', async () => {
  const start = await alice.post(`/workspaces/${wsA}/evidence/upload`, { file_name: 'note.txt', mime_type: 'text/plain', size: 20 });
  const put = await fetch(start.data.upload_url, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: '<script>alert(1)</script>' });
  assert.ok(!put.ok, `storage accepted text/html (${put.status})`);
});

test('links must use https, and are recorded', async () => {
  assert.equal((await alice.post(`/workspaces/${wsA}/evidence/link`, { url: 'http://example.com/doc' })).status, 400);
  assert.equal((await alice.post(`/workspaces/${wsA}/evidence/link`, { url: 'javascript:alert(1)' })).status, 400);
  const ok = await alice.post(`/workspaces/${wsA}/evidence/link`, { url: 'https://drive.google.com/file/d/abc', display_name: 'Budget sheet' });
  assert.equal(ok.status, 201);
  const dl = await alice.get(`/workspaces/${wsA}/evidence/${ok.data.id}/download`);
  assert.equal(dl.data.url, 'https://drive.google.com/file/d/abc');
});

test('removed evidence is hidden from the client but kept for the administrator', async () => {
  const link = (await alice.post(`/workspaces/${wsA}/evidence/link`, { url: 'https://example.com/old', display_name: 'Old doc' })).data;
  assert.equal((await alice.del(`/workspaces/${wsA}/evidence/${link.id}`)).status, 403, 'clients cannot remove');
  assert.equal((await admin.del(`/workspaces/${wsA}/evidence/${link.id}`)).status, 200);
  assert.ok(!(await alice.get(`/workspaces/${wsA}`)).data.evidence.some((e: any) => e.id === link.id));
  assert.equal((await alice.get(`/workspaces/${wsA}/evidence/${link.id}/download`)).status, 404);
  assert.ok((await admin.get(`/workspaces/${wsA}`)).data.evidence.some((e: any) => e.id === link.id && e.deleted_at));
});

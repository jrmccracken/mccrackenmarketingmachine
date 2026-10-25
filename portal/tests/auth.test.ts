import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, Browser, capturedEmails, linkFor, makeWorkspace, resetData, signIn, sql } from './helpers.ts';

before(() => resetData());

test('an unknown email address gets the same answer and no email', async () => {
  const b = new Browser();
  const known = await b.post('/auth/login', { email: ADMIN });
  const before = capturedEmails.length;
  const unknown = await b.post('/auth/login', { email: 'stranger@example.com' });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.data, known.data, 'responses must be identical');
  assert.equal(capturedEmails.length, before, 'no email for an unknown address');
  assert.equal(sql(`select count(*) from auth.users where email = 'stranger@example.com'`), '0', 'no account is created');
});

test('the administrator signs in with a one-time link, and the link cannot be reused', async () => {
  const b = new Browser();
  await b.post('/auth/login', { email: ADMIN });
  const mail = capturedEmails.at(-1)!;
  assert.equal(mail.to, ADMIN);
  assert.equal(mail.subject, 'Your Marketing Control Centre sign-in link');
  const token = new URL(linkFor(ADMIN)).searchParams.get('token');

  const first = await b.post('/auth/confirm', { token });
  assert.equal(first.status, 200);
  const setCookies = first.headers.getSetCookie();
  assert.ok(setCookies.every((c) => c.includes('HttpOnly') && c.includes('SameSite=Lax')), 'session cookies are HttpOnly');
  const me = await b.get('/me');
  assert.equal(me.data.user.email, ADMIN);
  assert.equal(me.data.user.role, 'admin');

  const again = await new Browser().post('/auth/confirm', { token });
  assert.equal(again.status, 400, 'a used link is rejected');
  const forged = await new Browser().post('/auth/confirm', { token: 'not-a-real-token' });
  assert.equal(forged.status, 400);
});

test('sign out ends the session on the server, not just in the browser', async () => {
  const b = await signIn(ADMIN);
  const saved = new Map(b.cookies);
  assert.equal((await b.get('/admin/overview')).status, 200);
  const out = await b.post('/auth/logout');
  assert.equal(out.status, 200);
  assert.equal(b.cookies.size, 0, 'cookies cleared');
  assert.equal((await b.get('/admin/overview')).status, 401);
  // Replaying the old cookies must not work either.
  const replay = new Browser();
  replay.cookies = saved;
  assert.equal((await replay.get('/admin/overview')).status, 401);
});

test('clients can only request a link while they are a member of an active workspace', async () => {
  const admin = await signIn(ADMIN);
  const { ws, data } = await makeWorkspace(admin, 'Acme Ltd', 'client@acme.example');
  const userId = data.members[0].user_id;
  const c = await signIn('client@acme.example');
  assert.equal((await c.get('/me')).data.user.role, 'client');

  // Suspended workspace: no link, and existing sessions see nothing.
  await admin.patch(`/admin/workspaces/${ws}`, { status: 'suspended' });
  const n = capturedEmails.length;
  await new Browser().post('/auth/login', { email: 'client@acme.example' });
  assert.equal(capturedEmails.length, n, 'no link for a suspended workspace');
  assert.equal((await c.get(`/workspaces/${ws}`)).status, 404);

  // Reactivated, then access removed.
  await admin.patch(`/admin/workspaces/${ws}`, { status: 'active' });
  assert.equal((await c.get(`/workspaces/${ws}`)).status, 200);
  await admin.del(`/admin/workspaces/${ws}/members/${userId}`);
  assert.equal((await c.get(`/workspaces/${ws}`)).status, 404, 'removed member loses access immediately');
  await new Browser().post('/auth/login', { email: 'client@acme.example' });
  assert.equal(capturedEmails.length, n, 'no link once access is removed');
});

test('repeated link requests are throttled without revealing anything', async () => {
  const b = new Browser('10.9.9.9');
  const n = capturedEmails.length;
  for (let i = 0; i < 7; i++) assert.equal((await b.post('/auth/login', { email: ADMIN })).status, 200);
  assert.ok(capturedEmails.length - n <= 5, `at most 5 links an hour, got ${capturedEmails.length - n}`);
});

test('cross-site requests are blocked', async () => {
  sql('truncate public.login_requests');
  const admin = await signIn(ADMIN);
  const noHeader = await admin.request('POST', '/admin/workspaces', { name: 'X' }, { 'x-mcc-request': '0' });
  assert.equal(noHeader.status, 403);
  const otherOrigin = await admin.request('POST', '/admin/workspaces', { name: 'X' }, { origin: 'https://evil.example' });
  assert.equal(otherOrigin.status, 403);
});

test('unauthenticated requests are rejected on every protected route', async () => {
  const anon = new Browser();
  const id = '00000000-0000-4000-8000-000000000000';
  for (const [m, p] of [['GET', '/admin/overview'], ['POST', '/admin/workspaces'], ['GET', `/workspaces/${id}`], ['POST', `/workspaces/${id}/comments`],
    ['GET', `/workspaces/${id}/evidence/${id}/download`], ['POST', `/workspaces/${id}/evidence/upload`], ['GET', '/notifications'], ['POST', '/admin/reminders/run']]) {
    const r = await anon.request(m, p, m === 'GET' ? undefined : {});
    assert.equal(r.status, 401, `${m} ${p}`);
  }
  assert.equal((await anon.get('/me')).data.user, null);
});

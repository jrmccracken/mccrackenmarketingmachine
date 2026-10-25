import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { ADMIN, Browser, makeWorkspace, resetData, signIn, sql } from './helpers.ts';

let admin: Browser, alice: Browser, bob: Browser;
let wsA: string, wsB: string, dataA: any, dataB: any;

before(async () => {
  resetData();
  admin = await signIn(ADMIN);
  ({ ws: wsA, data: dataA } = await makeWorkspace(admin, 'Alpha Ltd', 'alice@alpha.example'));
  ({ ws: wsB, data: dataB } = await makeWorkspace(admin, 'Beta Ltd', 'bob@beta.example'));
  alice = await signIn('alice@alpha.example');
  bob = await signIn('bob@beta.example');
});

test('each client sees only their own workspace', async () => {
  const me = await alice.get('/me');
  assert.deepEqual(me.data.workspaces.map((w: any) => w.name), ['Alpha Ltd']);
  assert.equal((await alice.get(`/workspaces/${wsA}`)).status, 200);
  assert.equal((await alice.get(`/workspaces/${wsB}`)).status, 404);
  assert.equal((await bob.get(`/workspaces/${wsA}`)).status, 404);
});

test('a client cannot change, comment on or add to another workspace', async () => {
  const itemB = dataB.checklist[0].id;
  const r1 = await alice.patch(`/workspaces/${wsB}/checklist/${itemB}`, { status: 'done' });
  assert.equal(r1.status, 404);
  // Even pairing their own workspace id with another workspace's item fails.
  const r2 = await alice.patch(`/workspaces/${wsA}/checklist/${itemB}`, { status: 'done' });
  assert.equal(r2.status, 404);
  assert.equal(sql(`select status from checklist_items where id = '${itemB}'`), 'not_started');
  assert.equal((await alice.post(`/workspaces/${wsB}/comments`, { body: 'hello' })).status, 404);
  // Commenting in your own workspace on a record that belongs to another workspace is refused.
  const cross = await alice.post(`/workspaces/${wsA}/comments`, { record_type: 'checklist', record_id: itemB, body: 'sneaky' });
  assert.equal(cross.status, 400);
  assert.equal((await alice.post(`/workspaces/${wsB}/evidence/link`, { url: 'https://example.com/x' })).status, 404);
  assert.equal((await alice.post(`/workspaces/${wsB}/evidence/upload`, { file_name: 'a.pdf', mime_type: 'application/pdf', size: 100 })).status, 404);
});

test('clients cannot use administrator functions', async () => {
  for (const [m, p, b] of [['GET', '/admin/overview', undefined], ['POST', '/admin/workspaces', { name: 'Mine' }], ['PATCH', `/admin/workspaces/${wsA}`, { status: 'archived' }],
    ['POST', `/admin/workspaces/${wsA}/members`, { email: 'friend@alpha.example' }], ['POST', '/admin/reminders/run', {}],
    ['DELETE', `/admin/workspaces/${wsA}`, { confirm_name: 'Alpha Ltd' }]] as [string, string, unknown][]) {
    assert.equal((await alice.request(m, p, b)).status, 403, `${m} ${p}`);
  }
  assert.equal(sql(`select count(*) from workspace_members where workspace_id = '${wsA}'`), '1', 'no member added');
  assert.equal(sql(`select status from workspaces where id = '${wsA}'`), 'active');
});

test('clients can update status and answers on their checklist, but nothing else', async () => {
  const item = dataA.checklist.find((c: any) => c.owner_type === 'client');
  const ok = await alice.patch(`/workspaces/${wsA}/checklist/${item.id}`, { status: 'done', notes: 'Access granted to James on 3 Nov' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.status, 'done');
  const wording = await alice.patch(`/workspaces/${wsA}/checklist/${item.id}`, { item: 'Changed wording' });
  assert.equal(wording.status, 403);
  const owner = await alice.patch(`/workspaces/${wsA}/checklist/${item.id}`, { client_editable: false });
  assert.equal(owner.status, 403);
  const mccrackenItem = dataA.checklist.find((c: any) => c.owner_type === 'mccracken');
  assert.equal((await alice.patch(`/workspaces/${wsA}/checklist/${mccrackenItem.id}`, { status: 'done' })).status, 404);
  assert.equal((await alice.post(`/workspaces/${wsA}/checklist`, { category: 'X', item: 'Y' })).status, 403);
  assert.equal((await alice.del(`/workspaces/${wsA}/checklist/${item.id}`)).status, 403);
});

test('clients can update actions assigned to them, not McCracken actions, and never see draft findings', async () => {
  const mine = (await admin.post(`/workspaces/${wsA}/actions`, { action: 'Send the brand guidelines', owner_type: 'client' })).data;
  const ours = (await admin.post(`/workspaces/${wsA}/actions`, { action: 'Audit the website', owner_type: 'mccracken' })).data;
  assert.equal((await alice.patch(`/workspaces/${wsA}/actions/${mine.id}`, { status: 'in_progress' })).status, 200);
  assert.equal((await alice.patch(`/workspaces/${wsA}/actions/${mine.id}`, { priority: 'low' })).status, 403);
  assert.equal((await alice.patch(`/workspaces/${wsA}/actions/${ours.id}`, { status: 'done' })).status, 404);

  const draft = (await admin.post(`/workspaces/${wsA}/findings`, { title: 'Draft thought', status: 'draft' })).data;
  const shared = (await admin.post(`/workspaces/${wsA}/findings`, { title: 'Shared finding', status: 'shared' })).data;
  const view = (await alice.get(`/workspaces/${wsA}`)).data;
  assert.ok(view.findings.some((f: any) => f.id === shared.id));
  assert.ok(!view.findings.some((f: any) => f.id === draft.id), 'draft finding hidden');
  assert.equal((await alice.patch(`/workspaces/${wsA}/findings/${shared.id}`, { title: 'Edited by client' })).status, 403);
  assert.equal((await alice.post(`/workspaces/${wsA}/comments`, { record_type: 'finding', record_id: draft.id, body: 'peek' })).status, 400, 'cannot comment on a hidden draft');
});

test('row level security holds even if someone queries the database directly with a client token', async () => {
  const token = alice.cookies.get('mcc_at')!;
  const url = process.env.SUPABASE_URL!, anon = process.env.SUPABASE_ANON_KEY!;
  const db = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const ws = await db.from('workspaces').select('id');
  assert.deepEqual(ws.data!.map((w) => w.id), [wsA]);
  for (const t of ['checklist_items', 'actions', 'findings', 'interviews', 'evidence', 'comments', 'activity', 'workspace_members']) {
    const { data } = await db.from(t).select('workspace_id').eq('workspace_id', wsB);
    assert.equal(data?.length ?? 0, 0, `${t} from another workspace`);
  }
  // Role escalation, audit tampering and self-invitation are all refused.
  await db.from('profiles').update({ role: 'admin' }).eq('email', 'alice@alpha.example');
  assert.equal(sql(`select role from profiles where email = 'alice@alpha.example'`), 'client');
  const delAct = await db.from('activity').delete().eq('workspace_id', wsA);
  assert.ok(delAct.error || sql(`select count(*) from activity where workspace_id = '${wsA}'`) !== '0');
  assert.ok(Number(sql(`select count(*) from activity where workspace_id = '${wsA}'`)) > 0);
  const join = await db.from('workspace_members').insert({ workspace_id: wsB, user_id: dataA.members[0].user_id });
  assert.ok(join.error, 'cannot add yourself to another workspace');
  const ins = await db.from('workspaces').insert({ name: 'Rogue' });
  assert.ok(ins.error, 'cannot create workspaces');
  const rpc = await db.rpc('seed_checklist', { ws: wsB });
  assert.ok(rpc.error, 'cannot seed checklists');
  const anonDb = createClient(url, anon, { auth: { persistSession: false } });
  const anonRead = await anonDb.from('workspaces').select('id');
  assert.ok(anonRead.error || anonRead.data!.length === 0, 'nothing readable without signing in');
});

test('activity history records material changes in plain English', async () => {
  const rows = sql(`select description from activity where workspace_id = '${wsA}' order by id`).split('\n');
  assert.ok(rows.some((r) => r.includes('created the workspace')));
  assert.ok(rows.some((r) => r.includes('added the standard onboarding checklist')));
  assert.ok(rows.some((r) => /Alpha Ltd Contact marked ".+" as Done/.test(r)), rows.join('\n'));
});

test('permanent deletion needs an archived workspace and the exact name', async () => {
  const { ws } = await makeWorkspace(admin, 'Gamma Ltd', 'gina@gamma.example');
  assert.equal((await admin.del(`/admin/workspaces/${ws}`, { confirm_name: 'Gamma Ltd' })).status, 400, 'must archive first');
  await admin.patch(`/admin/workspaces/${ws}`, { status: 'archived' });
  assert.equal((await admin.del(`/admin/workspaces/${ws}`, { confirm_name: 'gamma' })).status, 400, 'name must match');
  assert.equal((await admin.del(`/admin/workspaces/${ws}`, { confirm_name: 'Gamma Ltd' })).status, 200);
  assert.equal(sql(`select count(*) from workspaces where id = '${ws}'`), '0');
});

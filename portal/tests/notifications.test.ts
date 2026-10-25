import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, Browser, capturedEmails, makeWorkspace, resetData, signIn, sql } from './helpers.ts';
import { londonParts, sendAdminAlerts, sendWeeklyReminders, weekStart } from '../server/jobs.ts';

let admin: Browser, alice: Browser, wsA: string, dataA: any;
const later = (mins: number) => new Date(Date.now() + mins * 60_000);

before(async () => {
  resetData();
  admin = await signIn(ADMIN);
  ({ ws: wsA, data: dataA } = await makeWorkspace(admin, 'Alpha Ltd', 'alice@alpha.example'));
  alice = await signIn('alice@alpha.example');
});

test('client changes notify the administrator, grouped into one email after a quiet period', async () => {
  await sendAdminAlerts(later(60)); // clear anything earlier
  const n0 = capturedEmails.length;
  const item = dataA.checklist.find((c: any) => c.owner_type === 'client');
  await alice.patch(`/workspaces/${wsA}/checklist/${item.id}`, { status: 'in_progress' });
  await alice.patch(`/workspaces/${wsA}/checklist/${item.id}`, { status: 'done' });
  await alice.post(`/workspaces/${wsA}/comments`, { body: 'We have added James to GA4.' });

  const unread = await admin.get('/notifications');
  assert.ok(unread.data.filter((n: any) => !n.read_at).length >= 3, 'admin notifications created');
  assert.equal((await alice.get('/notifications')).data.length, 0, 'clients do not see admin notifications');

  assert.equal((await sendAdminAlerts(later(1))).emails, 0, 'waits for the client to finish');
  const r = await sendAdminAlerts(later(6));
  assert.equal(r.emails, 1);
  assert.equal(r.entries, 3);
  const mail = capturedEmails.at(-1)!;
  assert.equal(mail.to, ADMIN);
  assert.equal(mail.subject, 'Marketing Control Centre: new client activity', 'no client details in the subject');
  assert.ok(mail.text.includes('Alpha Ltd') && mail.text.includes(`/workspaces/${wsA}`));
  assert.equal((await sendAdminAlerts(later(12))).emails, 0, 'never emailed twice');
  assert.equal(capturedEmails.length, n0 + 1);

  const mark = await admin.post('/notifications/read', { all: true });
  assert.ok(mark.data.updated >= 3);
  assert.equal((await admin.get('/me')).data.unread, 0);
});

test('administrator changes do not trigger administrator alerts', async () => {
  await admin.post(`/workspaces/${wsA}/findings`, { title: 'Admin-only change', status: 'draft' });
  assert.equal((await sendAdminAlerts(later(60))).emails, 0);
});

test('an important client action emails the client once', async () => {
  const n0 = capturedEmails.length;
  const a = (await admin.post(`/workspaces/${wsA}/actions`, { action: 'Approve the Q1 budget', owner_type: 'client', important: true, priority: 'high' })).data;
  assert.equal(capturedEmails.length, n0 + 1);
  const mail = capturedEmails.at(-1)!;
  assert.equal(mail.to, 'alice@alpha.example');
  assert.equal(mail.subject, 'New action in your Marketing Control Centre workspace');
  assert.ok(!mail.subject.includes('budget'), 'no confidential content in the subject');
  assert.ok(mail.text.includes(`/workspaces/${wsA}?tab=actions#action-${a.id}`));
  await admin.patch(`/workspaces/${wsA}/actions/${a.id}`, { notes: 'Edited' });
  await admin.patch(`/workspaces/${wsA}/actions/${a.id}`, { priority: 'medium' });
  assert.equal(capturedEmails.length, n0 + 1, 'edits do not resend');
  await admin.post(`/workspaces/${wsA}/actions`, { action: 'Routine task', owner_type: 'client' });
  assert.equal(capturedEmails.length, n0 + 1, 'ordinary actions do not email');
});

test('London time handling for the Monday 09:00 reminder', () => {
  // 3 November 2025 is a Monday in GMT: 09:00 London = 09:00 UTC.
  assert.deepEqual([londonParts(new Date('2025-11-03T09:00:00Z')).hour, londonParts(new Date('2025-11-03T09:00:00Z')).weekday], [9, 'Mon']);
  // 7 July 2025 is a Monday in BST: 09:00 London = 08:00 UTC.
  assert.equal(londonParts(new Date('2025-07-07T08:00:00Z')).hour, 9);
  assert.equal(londonParts(new Date('2025-07-07T09:00:00Z')).hour, 10);
  assert.equal(weekStart(new Date('2025-07-09T12:00:00Z')), '2025-07-07');
});

test('weekly reminders: one consolidated email per client, never twice in a week', async () => {
  const monday9 = new Date('2025-11-03T09:00:00Z');
  sql('truncate public.reminder_log');
  // Overdue client action and an untouched checklist give Alice something outstanding.
  await admin.post(`/workspaces/${wsA}/actions`, { action: 'Send the CRM export', owner_type: 'client', due_date: '2020-01-01' });
  // A client with nothing outstanding gets nothing.
  const { ws: wsQuiet, data: quiet } = await makeWorkspace(admin, 'Quiet Ltd', 'quinn@quiet.example');
  for (const c of quiet.checklist) await admin.patch(`/workspaces/${wsQuiet}/checklist/${c.id}`, { status: 'done' });

  const skipped = await sendWeeklyReminders({ now: new Date('2025-11-03T08:00:00Z') });
  assert.ok(skipped.skipped, 'only sends at 09:00 London time');

  const n0 = capturedEmails.length;
  const dry = await sendWeeklyReminders({ now: monday9, dryRun: true });
  assert.equal(capturedEmails.length, n0, 'a dry run sends nothing');
  assert.deepEqual(dry.planned.map((p) => p.email), ['alice@alpha.example']);

  const live = await sendWeeklyReminders({ now: monday9 });
  assert.equal(live.sent, 1);
  const mail = capturedEmails.at(-1)!;
  assert.equal(mail.to, 'alice@alpha.example');
  assert.equal(mail.subject, 'Your weekly Marketing Control Centre update');
  assert.ok(mail.text.includes('Overdue action: Send the CRM export'));
  assert.ok(mail.text.includes('onboarding checklist item'));
  assert.ok(sql(`select count(*) from activity where workspace_id = '${wsA}' and action_type = 'reminder_sent'`) === '1');

  const again = await sendWeeklyReminders({ now: new Date('2025-11-03T09:30:00Z') });
  assert.equal(again.sent, 0);
  assert.equal(again.alreadySent, 1, 'the second run is a no-op');
  assert.equal(capturedEmails.filter((m) => m.tag === 'weekly_reminder').length, 1);

  // Suspended workspaces are skipped.
  await admin.patch(`/admin/workspaces/${wsA}`, { status: 'suspended' });
  assert.equal((await sendWeeklyReminders({ now: new Date('2025-11-10T09:00:00Z'), dryRun: true })).planned.length, 0);
  await admin.patch(`/admin/workspaces/${wsA}`, { status: 'active' });
});

test('the manual reminder endpoint is a dry run unless explicitly confirmed', async () => {
  const n0 = capturedEmails.length;
  const r = await admin.post('/admin/reminders/run', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.dryRun, true);
  assert.equal(capturedEmails.length, n0);
  assert.equal((await alice.post('/admin/reminders/run', { send: true, confirm: 'SEND' })).status, 403);
});

test('invitations go only to the person invited, with a link back to their workspace', async () => {
  const n0 = capturedEmails.length;
  const r = await admin.post(`/admin/workspaces/${wsA}/members`, { name: 'Sam', email: 'sam@alpha.example', send_invite: true });
  assert.equal(r.status, 201);
  assert.equal(capturedEmails.length, n0 + 1);
  const mail = capturedEmails.at(-1)!;
  assert.equal(mail.to, 'sam@alpha.example');
  assert.equal(mail.subject, "You've been invited to the McCracken Marketing Control Centre");
  assert.ok(mail.text.includes(`next=%2Fworkspaces%2F${wsA}`));
  assert.equal(sql(`select invitation_status from workspace_members where user_id = '${r.data.user_id}'`), 'invited');
  const sam = await signIn('sam@alpha.example');
  assert.equal((await sam.get(`/workspaces/${wsA}`)).status, 200);
  assert.equal(sql(`select invitation_status from workspace_members where user_id = '${r.data.user_id}'`), 'accepted');
});

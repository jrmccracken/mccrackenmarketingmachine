-- Marketing Control Centre: core schema, row level security and audit triggers.
--
-- Access model
--   * profiles.role = 'admin'  -> sees and manages every workspace.
--   * profiles.role = 'client' -> sees only workspaces they are an active member of,
--     and only while the workspace status is 'active'.
-- Every table has RLS enabled. The Netlify functions query as the signed-in user
-- (their Supabase JWT), so these policies apply to every portal request. The
-- service role (which bypasses RLS) is used only for invitations, sign-in links,
-- signed file URLs, notifications and the scheduled jobs.

create extension if not exists citext;

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null default '' check (char_length(name) <= 200),
  email         citext not null unique check (char_length(email) <= 320),
  role          text not null default 'client' check (role in ('admin', 'client')),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 200),
  status        text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  start_date    date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create table public.workspace_members (
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  role              text not null default 'client' check (role in ('client', 'admin')),
  invitation_status text not null default 'pending' check (invitation_status in ('pending', 'invited', 'accepted', 'revoked')),
  invited_at        timestamptz,
  accepted_at       timestamptz,
  created_at        timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

create table public.checklist_items (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  category        text not null check (char_length(category) between 1 and 100),
  item            text not null check (char_length(item) between 1 and 500),
  status          text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done', 'not_applicable')),
  owner_type      text not null default 'client' check (owner_type in ('client', 'mccracken')),
  assignee_id     uuid references public.profiles (id) on delete set null,
  client_editable boolean not null default true,
  due_date        date,
  notes           text not null default '' check (char_length(notes) <= 5000),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index on public.checklist_items (workspace_id);

create table public.interviews (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  stakeholder_name text not null check (char_length(stakeholder_name) between 1 and 200),
  stakeholder_role text not null default '' check (char_length(stakeholder_role) <= 200),
  status           text not null default 'to_schedule' check (status in ('to_schedule', 'scheduled', 'completed', 'cancelled')),
  planned_date     date,
  completed_date   date,
  notes            text not null default '' check (char_length(notes) <= 10000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index on public.interviews (workspace_id);

create table public.findings (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 300),
  category     text not null default '' check (char_length(category) <= 100),
  summary      text not null default '' check (char_length(summary) <= 10000),
  evidence     text not null default '' check (char_length(evidence) <= 10000),
  priority     text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  -- 'draft' findings are visible to the administrator only.
  status       text not null default 'draft' check (status in ('draft', 'shared', 'agreed', 'in_progress', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index on public.findings (workspace_id);

create table public.actions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  action       text not null check (char_length(action) between 1 and 500),
  owner_type   text not null default 'client' check (owner_type in ('client', 'mccracken')),
  owner_id     uuid references public.profiles (id) on delete set null,
  priority     text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  important    boolean not null default false,
  status       text not null default 'not_started' check (status in ('not_started', 'in_progress', 'blocked', 'done')),
  due_date     date,
  notes        text not null default '' check (char_length(notes) <= 5000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index on public.actions (workspace_id);

create table public.evidence (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 200),
  kind          text not null check (kind in ('file', 'link')),
  storage_path  text unique,
  external_url  text check (external_url is null or (external_url ~ '^https://' and char_length(external_url) <= 2000)),
  file_type     text,
  file_size     bigint check (file_size is null or file_size between 0 and 10485760),
  upload_status text not null default 'ready' check (upload_status in ('pending', 'ready')),
  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check ((kind = 'file' and storage_path is not null and external_url is null)
      or (kind = 'link' and external_url is not null and storage_path is null))
);
create index on public.evidence (workspace_id);

create table public.comments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  record_type  text not null default 'workspace' check (record_type in ('workspace', 'checklist', 'action', 'finding', 'interview', 'evidence')),
  record_id    uuid,
  author_id    uuid references public.profiles (id) on delete set null,
  body         text not null check (char_length(body) between 1 and 5000),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index on public.comments (workspace_id, record_type, record_id);

create table public.activity (
  id           bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  user_id      uuid references public.profiles (id) on delete set null,
  actor_role   text,
  action_type  text not null,
  description  text not null,
  record_type  text,
  record_id    uuid,
  created_at   timestamptz not null default now(),
  -- Set when the administrator alert email covering this entry has been sent (or isn't needed).
  alerted_at   timestamptz
);
create index on public.activity (workspace_id, created_at desc);
create index activity_unalerted on public.activity (created_at) where alerted_at is null;

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  type         text not null,
  title        text not null,
  link         text,
  dedupe_key   text,
  read_at      timestamptz,
  emailed_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (recipient_id, dedupe_key)
);
create index on public.notifications (recipient_id, read_at);

-- One row per person per week, so the Monday reminder can never go out twice.
create table public.reminder_log (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  sent_at    timestamptz not null default now(),
  item_count integer not null default 0,
  primary key (user_id, week_start)
);

-- Sign-in link requests, used to throttle repeated requests without revealing anything.
create table public.login_requests (
  id         bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash    text,
  created_at timestamptz not null default now()
);
create index on public.login_requests (email_hash, created_at);
create index on public.login_requests (ip_hash, created_at);

-- ---------------------------------------------------------------- helper functions

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- True when the signed-in user may see this workspace: the administrator always,
-- clients only while they are a non-revoked member and the workspace is active.
create or replace function public.can_access_workspace(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = ws and m.user_id = auth.uid()
      and m.invitation_status <> 'revoked' and w.status = 'active');
$$;

create or replace function public.actor_name(uid uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(p.name, ''), p.email::text) from public.profiles p where p.id = uid), 'McCracken Marketing');
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.can_access_workspace(uuid) from public;
revoke all on function public.actor_name(uuid) from public;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.can_access_workspace(uuid) to authenticated, service_role;
grant execute on function public.actor_name(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- timestamps

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger touch before update on public.workspaces      for each row execute function public.touch_updated_at();
create trigger touch before update on public.checklist_items for each row execute function public.touch_updated_at();
create trigger touch before update on public.interviews      for each row execute function public.touch_updated_at();
create trigger touch before update on public.findings        for each row execute function public.touch_updated_at();
create trigger touch before update on public.actions         for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- client column guards
-- RLS decides which rows a client may update; these triggers decide which columns.
-- Clients may change only status and notes on checklist items and actions assigned to the client.

create or replace function public.guard_client_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := to_jsonb(old) - 'status' - 'notes' - 'updated_at';
  n jsonb := to_jsonb(new) - 'status' - 'notes' - 'updated_at';
begin
  if auth.role() = 'authenticated' and not public.is_admin() and o is distinct from n then
    raise exception 'Clients can only change the status and notes of this item' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_client before update on public.checklist_items for each row execute function public.guard_client_update();
create trigger guard_client before update on public.actions         for each row execute function public.guard_client_update();

-- Notifications: a recipient can only mark their own as read.
create or replace function public.guard_notification_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' and (to_jsonb(old) - 'read_at') is distinct from (to_jsonb(new) - 'read_at') then
    raise exception 'Only the read status of a notification can be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_read before update on public.notifications for each row execute function public.guard_notification_update();

-- Comments must point at a record in the same workspace.
create or replace function public.check_comment_target() returns trigger
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if new.record_type = 'workspace' then new.record_id := null; return new; end if;
  if new.record_id is null then raise exception 'record_id is required' using errcode = '22023'; end if;
  -- Clients may only comment on records they can see: not removed, and (for findings) not a draft.
  execute format('select exists (select 1 from public.%I where id = $1 and workspace_id = $2 and (public.is_admin() or (deleted_at is null%s)))',
    case new.record_type when 'checklist' then 'checklist_items' when 'action' then 'actions' when 'finding' then 'findings'
      when 'interview' then 'interviews' when 'evidence' then 'evidence' end,
    case new.record_type when 'finding' then ' and status <> ''draft''' when 'evidence' then ' and upload_status = ''ready''' else '' end)
    into ok using new.record_id, new.workspace_id;
  if not ok then raise exception 'That item is not in this workspace' using errcode = '22023'; end if;
  return new;
end $$;
create trigger check_target before insert on public.comments for each row execute function public.check_comment_target();

-- Activity history is append-only for everyone except the service role.
create or replace function public.protect_activity() returns trigger language plpgsql as $$
begin
  if auth.role() is distinct from 'service_role' and current_user <> 'postgres' then
    raise exception 'Activity history cannot be changed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger protect before update or delete on public.activity for each row execute function public.protect_activity();

-- ---------------------------------------------------------------- activity logging

create or replace function public.log_activity(ws uuid, kind text, what text, rtype text, rid uuid, actor uuid default auth.uid())
returns void language plpgsql security definer set search_path = public as $$
declare
  r text := (select role from public.profiles where id = actor);
begin
  insert into public.activity (workspace_id, user_id, actor_role, action_type, description, record_type, record_id, alerted_at)
  values (ws, actor, r, kind, what, rtype, rid,
          -- Only client activity needs an administrator alert.
          case when r = 'client' then null else now() end);
  if r = 'client' then
    insert into public.notifications (recipient_id, workspace_id, type, title, link)
    select p.id, ws, kind, what, '/workspaces/' || ws from public.profiles p where p.role = 'admin';
  end if;
end $$;
revoke all on function public.log_activity(uuid, text, text, text, uuid, uuid) from public, authenticated;

create or replace function public.label(v text) returns text language sql immutable as $$
  select case v
    when 'not_started' then 'Not started' when 'in_progress' then 'In progress' when 'done' then 'Done'
    when 'not_applicable' then 'Not applicable' when 'blocked' then 'Blocked' when 'to_schedule' then 'To schedule'
    when 'scheduled' then 'Scheduled' when 'completed' then 'Completed' when 'cancelled' then 'Cancelled'
    when 'draft' then 'Draft' when 'shared' then 'Shared' when 'agreed' then 'Agreed' when 'closed' then 'Closed'
    else initcap(replace(coalesce(v, ''), '_', ' ')) end;
$$;

create or replace function public.audit_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  prev jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  -- Uploads are completed by the server after checking the file, so credit the uploader.
  actor uuid := coalesce(auth.uid(), (rec ->> 'uploaded_by')::uuid);
  who text := public.actor_name(actor);
  noun text; title text; ws uuid; kind text; what text;
begin
  if current_setting('mcc.seeding', true) = 'on' then return new; end if;
  ws := (rec ->> 'workspace_id')::uuid;
  noun := case tg_table_name when 'checklist_items' then 'checklist item' when 'actions' then 'action'
    when 'findings' then 'finding' when 'interviews' then 'interview' when 'evidence' then 'evidence' end;
  title := coalesce(rec ->> 'item', rec ->> 'action', rec ->> 'title', rec ->> 'stakeholder_name', rec ->> 'display_name');
  title := left(title, 120);

  if tg_table_name = 'evidence' then
    -- Pending uploads are logged when they complete.
    if tg_op = 'INSERT' and new.upload_status = 'pending' then return new; end if;
    if tg_op = 'UPDATE' and old.upload_status = 'pending' and new.upload_status = 'ready' then
      kind := 'evidence_uploaded'; what := format('%s uploaded "%s"', who, title);
    elsif tg_op = 'INSERT' then
      kind := 'evidence_added'; what := format('%s added a link: "%s"', who, title);
    elsif tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
      kind := 'evidence_removed'; what := format('%s removed "%s"', who, title);
    else return new; end if;
  elsif tg_op = 'INSERT' then
    kind := replace(noun, ' ', '_') || '_added'; what := format('%s added %s "%s"', who, case when noun ~ '^[aeiou]' then 'an ' || noun else 'a ' || noun end, title);
  elsif new.deleted_at is not null and old.deleted_at is null then
    kind := replace(noun, ' ', '_') || '_removed'; what := format('%s removed the %s "%s"', who, noun, title);
  elsif (rec ->> 'status') is distinct from (prev ->> 'status') then
    kind := replace(noun, ' ', '_') || '_status'; what := format('%s marked "%s" as %s', who, title, public.label(rec ->> 'status'));
  elsif (rec - 'updated_at') is distinct from (prev - 'updated_at') then
    kind := replace(noun, ' ', '_') || '_updated'; what := format('%s updated the %s "%s"', who, noun, title);
  else return new; end if;

  perform public.log_activity(ws, kind, what, tg_table_name, (rec ->> 'id')::uuid, actor);
  return new;
end $$;

create trigger audit after insert or update on public.checklist_items for each row execute function public.audit_change();
create trigger audit after insert or update on public.actions         for each row execute function public.audit_change();
create trigger audit after insert or update on public.findings        for each row execute function public.audit_change();
create trigger audit after insert or update on public.interviews      for each row execute function public.audit_change();
create trigger audit after insert or update on public.evidence        for each row execute function public.audit_change();

create or replace function public.audit_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.workspace_id, 'comment_added',
    format('%s added a comment: "%s"', public.actor_name(), left(regexp_replace(new.body, '\s+', ' ', 'g'), 80) || case when char_length(new.body) > 80 then '…' else '' end),
    'comments', new.id);
  return new;
end $$;
create trigger audit after insert on public.comments for each row execute function public.audit_comment();

create or replace function public.audit_workspace() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.id, 'workspace_created', format('%s created the workspace', public.actor_name()), 'workspaces', new.id);
  elsif new.status is distinct from old.status then
    perform public.log_activity(new.id, 'workspace_status', format('%s changed the workspace status to %s', public.actor_name(), lower(public.label(new.status))), 'workspaces', new.id);
  elsif new.name is distinct from old.name then
    perform public.log_activity(new.id, 'workspace_renamed', format('%s renamed the workspace to "%s"', public.actor_name(), new.name), 'workspaces', new.id);
  end if;
  return new;
end $$;
create trigger audit after insert or update on public.workspaces for each row execute function public.audit_workspace();

create or replace function public.audit_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare person text := (select coalesce(nullif(name, ''), email::text) from public.profiles where id = coalesce(new.user_id, old.user_id));
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.workspace_id, 'member_added', format('%s added %s to the workspace', public.actor_name(), person), 'workspace_members', new.user_id);
  elsif new.invitation_status = 'revoked' and old.invitation_status <> 'revoked' then
    perform public.log_activity(new.workspace_id, 'member_removed', format('%s removed %s from the workspace', public.actor_name(), person), 'workspace_members', new.user_id);
  elsif new.invitation_status = 'invited' and (old.invited_at is distinct from new.invited_at) then
    perform public.log_activity(new.workspace_id, 'member_invited', format('Invitation sent to %s', person), 'workspace_members', new.user_id);
  elsif new.invitation_status = 'accepted' and old.invitation_status <> 'accepted' then
    perform public.log_activity(new.workspace_id, 'member_joined', format('%s signed in for the first time', person), 'workspace_members', new.user_id);
  end if;
  return new;
end $$;
create trigger audit after insert or update on public.workspace_members for each row execute function public.audit_member();

-- ---------------------------------------------------------------- default onboarding checklist

create or replace function public.seed_checklist(ws uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and auth.role() is distinct from 'service_role' then
    raise exception 'Only the administrator can do this' using errcode = '42501';
  end if;
  perform set_config('mcc.seeding', 'on', true);
  insert into public.checklist_items (workspace_id, category, item, owner_type, client_editable, sort_order)
  select ws, c, i, o, o = 'client', n from (values
    ('GA4', 'Add james@mccrackenmarketing.co.uk as an Administrator on the GA4 property', 'client', 10),
    ('GA4', 'Confirm which conversions and key events are currently tracked', 'client', 11),
    ('Google Search Console', 'Add james@mccrackenmarketing.co.uk as a Full user on the Search Console property', 'client', 20),
    ('CRM', 'Give McCracken Marketing a user login to the CRM', 'client', 30),
    ('CRM', 'Share the sales pipeline stages and how each stage is defined', 'client', 31),
    ('Advertising accounts', 'Grant access to Google Ads (Standard access)', 'client', 40),
    ('Advertising accounts', 'Add McCracken Marketing as a partner in Meta Business Manager', 'client', 41),
    ('Advertising accounts', 'Grant access to LinkedIn Campaign Manager', 'client', 42),
    ('Advertising accounts', 'List any other paid channels and who manages them', 'client', 43),
    ('Email platform', 'Give access to the email marketing platform', 'client', 50),
    ('Email platform', 'Share list sizes and recent campaign results', 'client', 51),
    ('Website/CMS', 'Provide an editor login for the website CMS', 'client', 60),
    ('Website/CMS', 'Grant access to Google Tag Manager', 'client', 61),
    ('Website/CMS', 'Confirm who hosts the website and manages the domain', 'client', 62),
    ('Social accounts', 'Add James McCracken as an admin on the LinkedIn company page', 'client', 70),
    ('Social accounts', 'List other social accounts and who manages them', 'client', 71),
    ('Existing plans and budgets', 'Share the current marketing plan or strategy', 'client', 80),
    ('Existing plans and budgets', 'Share this year''s marketing budget and spend to date', 'client', 81),
    ('Brand assets', 'Share brand guidelines, logo files and templates', 'client', 90),
    ('Customer or pipeline data', 'Share a summary of customers by segment and revenue (no personal data needed)', 'client', 100),
    ('Customer or pipeline data', 'Share won and lost deals from the last 12 months', 'client', 101),
    ('Agency and supplier details', 'List current agencies, freelancers and suppliers', 'client', 110),
    ('Agency and supplier details', 'Share contract terms and renewal dates for each supplier', 'client', 111),
    ('Kick-off', 'Review access and agree the first priorities', 'mccracken', 120)
  ) as t(c, i, o, n);
  perform set_config('mcc.seeding', 'off', true);
  perform public.log_activity(ws, 'checklist_seeded', format('%s added the standard onboarding checklist', public.actor_name()), 'workspaces', ws);
end $$;
revoke all on function public.seed_checklist(uuid) from public;
grant execute on function public.seed_checklist(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- row level security

alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.checklist_items   enable row level security;
alter table public.interviews        enable row level security;
alter table public.findings          enable row level security;
alter table public.actions           enable row level security;
alter table public.evidence          enable row level security;
alter table public.comments          enable row level security;
alter table public.activity          enable row level security;
alter table public.notifications     enable row level security;
alter table public.reminder_log      enable row level security;
alter table public.login_requests    enable row level security;

-- Nothing is readable without signing in.
revoke all on all tables in schema public from anon;

-- profiles: yourself, the administrator, people in your workspaces, or everyone for the administrator.
-- Only the service role creates profiles or changes roles.
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or role = 'admin' or public.is_admin() or exists (
    select 1 from public.workspace_members m where m.user_id = profiles.id and public.can_access_workspace(m.workspace_id)));
create policy profiles_admin_write on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- workspaces
create policy workspaces_read on public.workspaces for select to authenticated using (public.can_access_workspace(id));
create policy workspaces_admin_insert on public.workspaces for insert to authenticated with check (public.is_admin());
create policy workspaces_admin_update on public.workspaces for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- No delete policy: permanent deletion is a separate, confirmed service-role operation.

-- workspace members
create policy members_read on public.workspace_members for select to authenticated using (public.can_access_workspace(workspace_id));
create policy members_admin_insert on public.workspace_members for insert to authenticated with check (public.is_admin());
create policy members_admin_update on public.workspace_members for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy members_admin_delete on public.workspace_members for delete to authenticated using (public.is_admin());

-- checklist: members read; clients update only items marked client-editable (column guard limits them to status and notes).
create policy checklist_read on public.checklist_items for select to authenticated using (
  public.can_access_workspace(workspace_id) and (deleted_at is null or public.is_admin()));
create policy checklist_admin_insert on public.checklist_items for insert to authenticated with check (public.is_admin());
create policy checklist_update on public.checklist_items for update to authenticated
  using (public.is_admin() or (public.can_access_workspace(workspace_id) and client_editable and deleted_at is null))
  with check (public.is_admin() or (public.can_access_workspace(workspace_id) and client_editable and deleted_at is null));

-- actions: clients update only actions owned by the client side.
create policy actions_read on public.actions for select to authenticated using (
  public.can_access_workspace(workspace_id) and (deleted_at is null or public.is_admin()));
create policy actions_admin_insert on public.actions for insert to authenticated with check (public.is_admin());
create policy actions_update on public.actions for update to authenticated
  using (public.is_admin() or (public.can_access_workspace(workspace_id) and owner_type = 'client' and deleted_at is null))
  with check (public.is_admin() or (public.can_access_workspace(workspace_id) and owner_type = 'client' and deleted_at is null));

-- interviews: members read, administrator writes.
create policy interviews_read on public.interviews for select to authenticated using (
  public.can_access_workspace(workspace_id) and (deleted_at is null or public.is_admin()));
create policy interviews_admin_insert on public.interviews for insert to authenticated with check (public.is_admin());
create policy interviews_admin_update on public.interviews for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- findings: clients see shared findings only; administrator writes.
create policy findings_read on public.findings for select to authenticated using (
  public.is_admin() or (public.can_access_workspace(workspace_id) and status <> 'draft' and deleted_at is null));
create policy findings_admin_insert on public.findings for insert to authenticated with check (public.is_admin());
create policy findings_admin_update on public.findings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- evidence: members read completed items and add links as themselves; files are registered by the upload function.
create policy evidence_read on public.evidence for select to authenticated using (
  public.can_access_workspace(workspace_id) and (public.is_admin() or (deleted_at is null and upload_status = 'ready')));
create policy evidence_insert_link on public.evidence for insert to authenticated with check (
  public.can_access_workspace(workspace_id) and kind = 'link' and uploaded_by = auth.uid());
create policy evidence_admin_update on public.evidence for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- comments: members read and add their own; nobody edits; the administrator can hide.
create policy comments_read on public.comments for select to authenticated using (
  public.can_access_workspace(workspace_id) and (deleted_at is null or public.is_admin()));
create policy comments_insert on public.comments for insert to authenticated with check (
  public.can_access_workspace(workspace_id) and author_id = auth.uid() and deleted_at is null);
create policy comments_admin_update on public.comments for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- activity: read-only for members. Rows are written by triggers.
create policy activity_read on public.activity for select to authenticated using (public.can_access_workspace(workspace_id));

-- notifications: your own only; you can mark them read.
create policy notifications_read on public.notifications for select to authenticated using (recipient_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- reminder_log and login_requests: service role only (no policies).

-- Table privileges: RLS narrows these further.
grant select, insert, update on public.workspaces, public.workspace_members, public.checklist_items, public.interviews,
  public.findings, public.actions, public.evidence, public.comments to authenticated;
grant delete on public.workspace_members to authenticated;
grant select, update on public.profiles, public.notifications to authenticated;
grant select on public.activity to authenticated;
revoke insert, update, delete on public.activity from authenticated;
revoke all on public.reminder_log, public.login_requests from authenticated;

-- ---------------------------------------------------------------- private file storage
-- A private bucket with a 10 MB limit and an allow-list of document and image types.
-- There are deliberately no storage.objects policies for signed-in users: files are only
-- reachable through short-lived signed URLs issued after a workspace check.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('evidence', 'evidence', false, 10485760, array[
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/csv', 'text/plain', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

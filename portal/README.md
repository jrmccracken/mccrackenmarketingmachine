# Marketing Control Centre

A private client portal for McCracken Marketing. Each client gets their own workspace for onboarding, access checklists, actions, interviews, findings, documents and comments. James McCracken (the administrator) can see and manage every workspace.

- **Intended address:** `https://portal.mccrackenmarketing.co.uk` (its own Netlify site, separate from the marketing website)
- **Login page:** `https://portal.mccrackenmarketing.co.uk/login`

> **Status:** built and tested locally against a real Supabase stack. It has **not** been deployed. Deployment needs the accounts, DNS and environment variables listed under [Before you go live](#before-you-go-live).

## How it works

| Part | Technology | Notes |
| --- | --- | --- |
| Pages | React 19 + Vite, TypeScript | Static files served by Netlify. Self-hosted fonts (Fraunces, Barlow, Barlow Condensed, League Gothic). |
| API | One Netlify Function (`netlify/functions/api.mts`) at `/api/*` | All reads and writes go through it. Code in `server/`. |
| Sign-in | Supabase Auth magic links, sent by Resend | Pre-approved emails only. Sessions live in HttpOnly cookies. |
| Database | Supabase Postgres with row level security | Schema in `supabase/migrations/`. |
| Files | Supabase Storage, private bucket `evidence` | 10 MB limit, allow-listed types, 60-second signed download links. |
| Email | Resend | Invitations, sign-in links, important actions, weekly reminders, administrator alerts. |
| Schedules | Netlify Scheduled Functions | Admin alerts every 5 minutes; weekly reminders Mondays 09:00 London time. |

The API queries the database **as the signed-in user** (their Supabase JWT), so the database's row level security policies apply to every portal request. The service-role key (which bypasses RLS) is used only for: sending invitations and sign-in links, issuing signed file URLs after a membership check, checking uploaded files, writing notifications, and the scheduled jobs.

### Sign-in flow

1. The person enters their email at `/login`. The API always returns the same message and takes at least 700 ms, whether or not the address has access, so nobody can tell which addresses exist.
2. Only if the address is the administrator, or a member of at least one **active** workspace, the API asks Supabase for a one-time link (`auth.admin.generateLink`) and emails it through Resend. Supabase sends no emails itself. Sign-ups are disabled, so unknown addresses never get an account.
3. The link opens `/auth/confirm`, which needs a button press. Email security scanners that open links automatically can't use up the link.
4. The API verifies the token with Supabase (single use, expires after 15 minutes), re-checks access, and sets two HttpOnly, Secure, SameSite=Lax `__Host-` cookies. The access token lasts 1 hour and refreshes automatically; two weeks of inactivity signs you out.
5. Sign out revokes the session in Supabase, not just in the browser. Replaying old cookies fails (tested).
6. Link requests are limited to 5 per email address and 30 per IP address per hour, without telling the requester.

Every state-changing API request must come from the portal's own origin and carry an `x-mcc-request` header, which a cross-site form can't send.

## Files

```
portal/
  netlify.toml                    build settings, SPA routing, security headers (CSP, HSTS, noindex…)
  .env.example                    environment variable names (no values)
  index.html                      noindex meta tag
  public/                         logo, self-hosted fonts, robots.txt
  src/                            React app
    App.tsx                       routing, header, sign-out
    pages/Login.tsx, Confirm.tsx  sign-in
    pages/AdminHome.tsx           administrator dashboard
    pages/Workspace.tsx           workspace: overview, checklist, actions, interviews, findings, documents, comments, activity
    pages/People.tsx              administrator: members, invitations, status, permanent deletion
    components/ui.tsx             dialog (focus-trapping), fields, status labels, toasts
  server/                         API (runs in the Netlify Function)
    router.ts                     routes, CSRF check, error handling
    auth.ts, session.ts           magic links, cookies, sessions
    workspace.ts                  workspace reads/writes, comments, uploads, downloads
    admin.ts                      administrator operations, notifications
    jobs.ts                       admin alerts and weekly reminders
    email.ts                      Resend client and email templates
    validate.ts                   input and file validation
  netlify/functions/              api, admin-alerts (every 5 min), weekly-reminders (Mondays)
  supabase/config.toml            local Supabase settings (sign-ups off, 15-minute links)
  supabase/migrations/            database schema, RLS policies, triggers, storage bucket
  scripts/dev-server.ts           local development and production preview
  scripts/bootstrap-admin.ts      creates the administrator account
  tests/                          automated tests (29), run against local Supabase
docs/
  SECURITY.md                     RLS policies, headers, threat notes
  OPERATIONS.md                   backups, restore, rollback, scheduler
  WEBSITE-CHANGES.md              footer link and privacy policy wording for mccrackenmarketing.co.uk
```

## Database schema

Defined in `supabase/migrations/20261025090000_control_centre_schema.sql`.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `profiles` | People who can sign in | `id` (= Supabase Auth user), `name`, `email`, `role` (`admin`/`client`), `created_at`, `last_login_at` |
| `workspaces` | One per client | `name`, `status` (`active`/`suspended`/`archived`), `start_date`, `created_at`, `updated_at`, `archived_at` |
| `workspace_members` | Who can access which workspace | `workspace_id`, `user_id`, `role`, `invitation_status` (`pending`/`invited`/`accepted`/`revoked`), `invited_at`, `accepted_at` |
| `checklist_items` | Access and onboarding checklist | `category`, `item`, `status`, `owner_type` (client/McCracken), `assignee_id`, `client_editable`, `due_date`, `notes`, `sort_order`, `updated_at`, `deleted_at` |
| `interviews` | Stakeholder conversations | `stakeholder_name`, `stakeholder_role`, `status`, `planned_date`, `completed_date`, `notes` |
| `findings` | Findings and recommendations | `title`, `category`, `summary`, `evidence`, `priority`, `status` (`draft` is administrator-only) |
| `actions` | Actions | `action`, `owner_type`, `owner_id`, `priority`, `important`, `status`, `due_date`, `notes` |
| `evidence` | Uploaded files and links | `display_name`, `kind` (`file`/`link`), `storage_path` or `external_url`, `file_type`, `file_size`, `upload_status`, `uploaded_by`, `deleted_at` |
| `comments` | Comments and answers | `record_type` (workspace/checklist/action/finding/interview/evidence), `record_id`, `author_id`, `body`, `deleted_at` |
| `activity` | Audit history (append-only) | `user_id`, `actor_role`, `action_type`, `description` (plain English), `record_type`, `record_id`, `alerted_at` |
| `notifications` | In-portal notifications | `recipient_id`, `workspace_id`, `type`, `title`, `link`, `dedupe_key`, `read_at`, `emailed_at` |
| `reminder_log` | One row per person per week; stops duplicate reminders | `user_id`, `week_start` |
| `login_requests` | Hashed email/IP for throttling sign-in requests; pruned after 24 hours | `email_hash`, `ip_hash` |

Important records are soft-deleted (`deleted_at`) or archived rather than removed. Every material change is written to `activity` by database triggers, so it can't be skipped by application code. A new workspace gets 24 standard checklist items (GA4, Search Console, CRM, advertising accounts, email platform, website/CMS, social accounts, plans and budgets, brand assets, customer/pipeline data, agencies and suppliers, kick-off), which the administrator can edit or remove.

Row level security is summarised in [docs/SECURITY.md](../docs/SECURITY.md).

## Environment variables

Set in Netlify under **Site configuration → Environment variables**. Names are exact:

| Variable | Example | Secret? |
| --- | --- | --- |
| `SUPABASE_URL` | `https://abcd1234.supabase.co` | No |
| `SUPABASE_ANON_KEY` | Supabase "anon" / publishable key | Low (used server-side only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase "service_role" / secret key | **Yes** |
| `RESEND_API_KEY` | `re_…` | **Yes** |
| `RESEND_FROM_EMAIL` | `McCracken Marketing <portal@mccrackenmarketing.co.uk>` | No |
| `ADMIN_EMAIL` | `james@mccrackenmarketing.co.uk` | No |
| `SITE_URL` | `https://portal.mccrackenmarketing.co.uk` (no trailing slash) | No |
| `EMAIL_MODE` | leave **unset** in production (`capture` is for tests) | No |

The browser never receives any Supabase key. If a required variable is missing, the API refuses to run rather than running half-configured.

## Supabase setup

1. Create a project at supabase.com. Choose the **London (eu-west-2)** region so data stays in the UK.
2. **Apply the migration.** On your computer, in the `portal` folder:
   ```
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   This creates the tables, policies, triggers and the private `evidence` bucket.
3. **Authentication → Sign In / Providers → Email:** keep Email enabled. Turn **off** "Allow new users to sign up". Set **Email OTP expiration** to `900` seconds.
4. **Authentication → URL Configuration:** Site URL `https://portal.mccrackenmarketing.co.uk`; add `https://portal.mccrackenmarketing.co.uk/**` to Redirect URLs.
5. **Storage:** confirm the `evidence` bucket exists and is **not** public, with a 10 MB limit.
6. **Database → Backups:** see [docs/OPERATIONS.md](../docs/OPERATIONS.md). Daily backups need the Pro plan; point-in-time recovery is a paid add-on. **Neither is on by default on the Free plan.**
7. Copy the URL, anon key and service-role key into Netlify (Project settings → API).
8. Check RLS: in **Table editor**, every table should show "RLS enabled". Or run in the SQL editor:
   ```sql
   select tablename, rowsecurity from pg_tables where schemaname = 'public';
   ```
   Every row should say `true`.

## Resend setup

1. Create an account at resend.com and add the domain `mccrackenmarketing.co.uk` (or a subdomain such as `mail.mccrackenmarketing.co.uk`).
2. Add the DNS records Resend shows (SPF/MX and DKIM) wherever the domain's DNS is managed, and wait for **Verified**.
3. Create an API key with **Sending access** only, restricted to that domain. Put it in `RESEND_API_KEY`.
4. Set `RESEND_FROM_EMAIL`, for example `McCracken Marketing <portal@mccrackenmarketing.co.uk>`. Replies go to that address, so use a mailbox you read or set a forwarding rule.

## Netlify setup and deployment

1. In Netlify: **Add new site → Import an existing project →** GitHub → `jrmccracken/mccrackenmarketingmachine`.
2. Settings: **Branch** the branch you deploy from; **Base directory** `portal`; build command and publish directory come from `portal/netlify.toml` (`npm run build`, `dist`); functions from `netlify/functions`.
3. Add the environment variables above. Mark the two secret ones as secret.
4. **Don't publish yet.** Use a deploy preview or the `*.netlify.app` address to run the checks below first.
5. Add the custom domain `portal.mccrackenmarketing.co.uk` (**Domain management → Add a domain**) and create the CNAME record it asks for. Netlify issues the HTTPS certificate.
6. Once deployed, open `https://portal.mccrackenmarketing.co.uk/login` and request a link for `james@mccrackenmarketing.co.uk`. The administrator account is created automatically on first use (or run `npm run bootstrap-admin` locally with production variables in `.env.local`).

### Before you go live

- [ ] All 7 environment variables set in Netlify (`EMAIL_MODE` unset).
- [ ] Migration applied (`npx supabase db push` reports nothing to push).
- [ ] RLS enabled on every table (query above).
- [ ] Resend domain shows **Verified**.
- [ ] Administrator receives a sign-in email and can sign in.
- [ ] Create a **test** workspace with a second email address you control (not a client).
- [ ] Sign in as that test client in a private window: you see only the test workspace, can tick a checklist item, comment and upload a PDF; you can't open `/admin`.
- [ ] As the administrator, confirm the alert email arrives within about 10 minutes of the test client's changes.
- [ ] Archive and permanently delete the test workspace.
- [ ] Check `https://portal.mccrackenmarketing.co.uk/login` response headers include `X-Robots-Tag: noindex, nofollow` and `Content-Security-Policy`.
- [ ] Only then add the Client login link to the website footer (see [docs/WEBSITE-CHANGES.md](../docs/WEBSITE-CHANGES.md)).

## Weekly reminders and alerts

- `netlify/functions/weekly-reminders.mts` runs at **08:00 and 09:00 UTC every Monday** (`0 8,9 * * 1`). Netlify schedules are in UTC; the function sends only on the run that is **09:00 in Europe/London**, so it is correct in both GMT and BST.
- It finds active workspaces, then for each client contact (invited or signed in) any incomplete client-owned checklist items and overdue client actions. Each person gets **one** consolidated email, nobody with nothing outstanding is emailed, and `reminder_log` makes a second run in the same week a no-op. Each send is recorded in the workspace's activity and the person's notifications.
- `netlify/functions/admin-alerts.mts` runs every 5 minutes. It waits until a client has made no changes in that workspace for 5 minutes (or 30 minutes have passed), then sends James one email per workspace summarising the changes.
- Netlify scheduled functions can't be called by URL in production. The manual run is `POST /api/admin/reminders/run`, which needs an administrator session, is a **dry run** by default, and sends only with `{"send": true, "confirm": "SEND"}` (the "Send reminders now" button, which asks you to type SEND).

## Local development

Needs Node 22 and Docker.

```
cd portal
npm install
npm run db:start          # local Supabase (first run downloads images)
cp .env.example .env.local   # fill in the values printed by `npx supabase status`, EMAIL_MODE=capture
npm run dev               # http://localhost:8888 ; emails are printed to the console, not sent
npm test                  # 29 tests against the local database (it is wiped between test files)
npm run typecheck
npm run build
npm run preview           # production build with the production security headers
```

The tests refuse to run against anything except a local database.

## Test results (25 October 2026, local Supabase stack)

`npm test`: **29 passed, 0 failed.** `npm run typecheck`: clean. `npm run build`: succeeds. `npm audit`: 0 vulnerabilities.

What the tests cover:

- **Sign-in:** unknown addresses get an identical response and no email or account; one-time links work once and are rejected on reuse or tampering; cookies are HttpOnly; sign-out revokes the session server-side (old cookies fail); suspended workspaces and removed members can't get links and lose access immediately; link requests are throttled; cross-site requests are blocked; every protected route returns 401 when signed out.
- **Permissions:** clients see only their own workspace; can't change, comment on, upload to or add links to another workspace (including by pairing their own workspace ID with another workspace's record); can't use any administrator route; can change only status and answers on their own checklist items and actions; can't see or comment on draft findings; can't change findings. Querying the database directly with a client's token returns nothing from other workspaces, and role escalation, deleting activity, self-invitation, creating workspaces and seeding checklists are all refused.
- **Files:** wrong extension, wrong type, empty or over 10 MB files are refused; a file whose contents don't match its extension is rejected and removed; a file larger than declared or uploaded with a disallowed content type is refused by storage; valid PDFs upload to a random path, are logged, and download through a 60-second link; other clients and signed-out visitors can't get links; the bucket has no public URL and can't be read or listed with a client's own token.
- **Notifications:** client changes notify the administrator in one grouped email after a quiet period, never twice, with no client detail in the subject; administrator changes don't alert; important client actions email the client exactly once; reminders run only at 09:00 London time (checked for GMT and BST), send one consolidated email per client, skip people with nothing outstanding and suspended workspaces, record the send, and never send twice in a week; the manual reminder endpoint is a dry run unless confirmed; invitations go only to the invitee and link to their workspace.
- **Browser checks** (production build with production headers, Chromium, 1280 px and 390 px): sign-in through the emailed link, upload and download through the page, sign-out; no horizontal scrolling on any page at 390 px; no axe-core accessibility violations (WCAG 2.2 AA rules) on the login, administrator and workspace pages; dialogs keep keyboard focus inside, close with Escape and return focus; visible 3 px focus outlines; no interactive control under 44 px tall; no console or Content Security Policy errors.

Not tested: real Resend delivery, the hosted Supabase project, Netlify's scheduler and headers in production, and magic-link expiry after 15 minutes (configured, not waited out). These are covered by the go-live checklist.

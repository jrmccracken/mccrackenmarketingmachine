# Marketing Control Centre: operations

## Backups

**Nothing is backed up until you switch it on.** What Supabase offers (check the current plan details in the Supabase dashboard, as they change):

| Option | Covers | How to enable |
| --- | --- | --- |
| Daily database backups | Database tables (not stored files) | Pro plan or above. **Database → Backups** shows them once available. The Free plan has no downloadable backups. |
| Point-in-time recovery | Database to any second within the retention window | Paid add-on: **Database → Backups → Point in time**. |
| Your own export | Database | `npx supabase db dump --linked -f backup-YYYY-MM-DD.sql` (and `--data-only` for data). Store the file somewhere private and encrypted: it contains client data. |
| Stored files | The `evidence` bucket | **Not included in database backups.** Copy them with the Supabase CLI or S3-compatible tools on a schedule if you need file backups. |

Recommended minimum: Pro plan with daily backups, plus a monthly `db dump` of the schema and data kept in a private, encrypted location.

## Restore

- **From a Supabase backup:** **Database → Backups**, choose the backup, **Restore**. This replaces the whole database; the portal is briefly unavailable. Storage files are not affected.
- **From your own dump:** create a new Supabase project, apply the migrations, then load the dump with `psql`. Point the Netlify environment variables at the new project and redeploy.
- After any restore, sign in as the administrator and check one workspace end to end.

## Rolling back the portal

Netlify keeps every deploy.

1. Netlify → the portal site → **Deploys**.
2. Pick the last good deploy → **Publish deploy**. It goes live in seconds.
3. To stop new pushes replacing it while you fix the problem: **Deploys → Lock to stop auto publishing**. Unlock when fixed.

Database migrations are not undone by a Netlify rollback. Migrations in this project only add things; if one ever has to be reversed, write a new migration that undoes it rather than editing an applied one.

Rolling back the **website** (mccrackenmarketing.co.uk) works the same way on that site's own Netlify **Deploys** page. If the footer link change causes a problem, publish the previous deploy.

## Scheduled jobs

| Function | Schedule (UTC) | What it does |
| --- | --- | --- |
| `admin-alerts` | `*/5 * * * *` | Groups client activity into one email per workspace for the administrator; removes upload attempts that never completed. |
| `weekly-reminders` | `0 8,9 * * 1` | Sends at 09:00 London time on Mondays; one email per client with outstanding items; never twice a week. |

Check runs in Netlify → **Logs → Functions**. Each run logs a one-line summary.

## Routine tasks

- **Add a client:** administrator dashboard → **New workspace** → enter the business, contact name and email → optionally send the invitation.
- **Give someone else access:** workspace → **People and settings** → **Add person**.
- **Remove access:** **People and settings** → **Remove access** (immediate; history kept).
- **End an engagement:** **Archive** the workspace. Clients can't sign in; records are kept.
- **Delete a client's data** (for example on request): archive, download anything you must keep, then **Delete permanently** and type the workspace name. Files are deleted too. Backups keep a copy until they expire.
- **Access or deletion requests from an individual:** export what you hold about them (their profile, comments and uploads) from the workspace, or remove them as above.

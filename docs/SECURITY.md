# Marketing Control Centre: security notes

## Row level security policies

RLS is enabled on every table in `public`. The anonymous role has no table privileges at all. Two helper functions (security definer, fixed `search_path`) are used by the policies:

- `is_admin()`: the signed-in user's profile has `role = 'admin'`.
- `can_access_workspace(ws)`: `is_admin()`, **or** the user is a non-revoked member of `ws` **and** the workspace status is `active`.

| Table | Read | Insert | Update | Delete |
| --- | --- | --- | --- | --- |
| `profiles` | yourself, administrator profiles, members of workspaces you can access; admin: all | service role only | admin only (clients can't change their role) | service role only |
| `workspaces` | `can_access_workspace(id)` | admin | admin | none (permanent deletion is a separate confirmed service-role operation) |
| `workspace_members` | `can_access_workspace` | admin | admin | admin |
| `checklist_items` | `can_access_workspace`, removed items admin only | admin | admin; or a member when `client_editable` and not removed. A trigger limits clients to `status` and `notes` | none (soft delete) |
| `actions` | `can_access_workspace`, removed items admin only | admin | admin; or a member when `owner_type = 'client'`. Trigger limits clients to `status` and `notes` | none (soft delete) |
| `interviews` | `can_access_workspace` | admin | admin | none (soft delete) |
| `findings` | admin; members see non-draft, non-removed only | admin | admin | none (soft delete) |
| `evidence` | `can_access_workspace`; clients only completed, non-removed items | links: members, as themselves. Files: registered by the server after validation | admin | none (soft delete) |
| `comments` | `can_access_workspace`, hidden comments admin only | members, as themselves, only on visible records in the same workspace (trigger) | admin (hide) | none |
| `activity` | `can_access_workspace` | triggers only | nobody except the service role (trigger blocks it; privilege revoked) | same |
| `notifications` | your own | service role / triggers | your own, `read_at` only (trigger) | none |
| `reminder_log`, `login_requests` | service role only | service role only | service role only | service role only |

**Storage:** the `evidence` bucket is private, limited to 10 MB and to PDF, Word, Excel, PowerPoint, CSV, text, PNG, JPEG, WebP and GIF. There are no `storage.objects` policies for signed-in users, so files can only be reached through 60-second signed URLs the API issues after RLS confirms the user can see the record.

## Defence in depth

- The API checks the session on every route and the administrator role on administrator routes, and also queries **as the user** so RLS applies. Hidden buttons are never the only control.
- Uploads: extension, declared type and size checked before an upload URL is issued; storage enforces size and type; after upload the server reads the file's first bytes and rejects anything whose contents don't match (for example an executable renamed `.pdf`). Paths are `<workspace>/<random UUID>.<ext>`.
- Links must be `https://` with no embedded credentials.
- Sessions: HttpOnly, Secure, SameSite=Lax, `__Host-` cookies; nothing sensitive in browser storage; sign-out revokes the session in Supabase.
- CSRF: same-origin check and a required custom header on every write.
- Email: no confidential content in subject lines; sign-in links are single use and expire after 15 minutes.
- Errors: unexpected errors return a generic message; details go to the Netlify function log only.

## HTTP headers (netlify.toml)

`X-Robots-Tag: noindex, nofollow` on every response, plus the `<meta name="robots" content="noindex, nofollow">` tag; `Content-Security-Policy` (scripts, styles and fonts from the portal only; connections to the portal and `*.supabase.co`; no framing; no plugins); `Strict-Transport-Security`; `X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY`; `Referrer-Policy: no-referrer` (keeps sign-in tokens out of referrers); `Permissions-Policy` denying camera, microphone, location and payment; `Cross-Origin-Opener-Policy: same-origin`.

If you later give Supabase a custom domain, add it to `connect-src` in the CSP, otherwise uploads will be blocked.

## Known limits and recommendations

- The service-role key can bypass RLS. Keep it only in Netlify environment variables, never in the browser or the repository. Rotate it in Supabase if it is ever exposed.
- Supabase's own rate limits apply to token verification; sign-in link requests are additionally throttled by the portal.
- Files are not virus-scanned. Content checks stop disguised executables, but Office files can still contain macros. Open client files with care, or add a scanning service later.
- Workspace deletion is permanent in the live database, but Supabase backups (if enabled) keep a copy until they expire. Mention this in deletion requests.
- Review Netlify and Supabase account access: use two-factor authentication on GitHub, Netlify, Supabase and Resend.

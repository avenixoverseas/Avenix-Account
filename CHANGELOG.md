# Changelog

## 2026-10-24 — Source audit and documentation pass

- Added a consolidated README and installation, configuration, database migration, deployment, bug-fix, and test reports.
- Added repeatable JavaScript syntax checking via `npm run check:syntax`.
- Documented the canonical SQL schema filename and flagged the stale SQL filename in historical release notes.
- Recorded local checks and explicit limits around live Supabase, browser, and production verification.

## Existing project

The supplied archive's `RELEASE-NOTES.txt`, `IMPLEMENTATION-STATUS.txt`, and `UPGRADE-NOTES-2026-10.txt` retain prior implementation history. Review them as historical notes; verify claims against the current source and deployed Supabase project.

## 2026-10-24 — Owner-controlled permissions
- Restrict administrator-level access to mohammadaffan@avenixoverseas.com in frontend checks and the secure user-management Edge Function.
- Hide every non-dashboard menu item unless its VIEW permission is granted; keep dashboard available with masked financial values when dashboard VIEW is not granted.
- Dashboard permission now enables the normal dashboard view.
- Added `supabase/sql/20261024_lock_admin_to_owner_email.sql` for existing databases. Apply only after reviewing and backing up.

- Corrected owner email configuration to `mohammadaffan@avenixoverseas.com` across frontend, owner-only Edge Function checks, and SQL authorization helpers.
- Added an idempotent owner identity repair migration and read-only database permission verification guide.

## Dashboard enhancement — 2026-10-24
- Expanded the dashboard to eight financial KPI cards, including outstanding invoices, overdue invoices, expenses, and net cash movement.
- Added a monthly income/expense comparison, circular income-share gauge, cash/bank reserve meter, overdue invoice table, recent activity feed, and client names in recent invoices.
- Preserved permission-based masking for staff without Dashboard VIEW permission.
- Administrator bypass remains restricted to the configured owner identity; if the intended owner still sees masked data, verify the signed-in Auth email, matching `profiles.email`, `profiles.role = ADMIN`, and `profiles.active = true`, then apply the supplied owner/permissions SQL migrations as appropriate. Do not grant admin by role alone.

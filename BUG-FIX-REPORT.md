# Bug and Risk Review

## Confirmed documentation defects corrected in this delivery

1. Historical `RELEASE-NOTES.txt` refers to `supabase/sql/AVENIX_SETUP_AND_ACCOUNTING.sql`, which is not present in the supplied archive. Added this report and the guides identify `supabase/sql/AVENIX_COMPLETE_SCHEMA.sql` as the current schema file.
2. The archive lacked a consolidated README and the requested installation, configuration, migration, deployment, bug, test, and changelog documents. Added these files with explicit staging and production-safety guidance.
3. The project had no single command for checking JavaScript syntax. Added `npm run check:syntax` to make the current source checks repeatable.

## Reviewed at source level

- `js/config.js` contains a Supabase project URL and a publishable/anon key. These are browser-visible by design; no service-role key was found in the frontend configuration.
- The admin Edge Function reads the service-role key from server environment variables, verifies the caller's Supabase user, and checks that the caller has an active `ADMIN` profile before user management.
- The schema contains `SECURITY DEFINER` functions with explicit `search_path` settings in the inspected declarations. This does not replace a full grants/RLS review.
- The frontend imports Supabase JS from `esm.sh`; local runtime therefore depends on network access to that host.

## Confirmed application issues and current patch status

- **Fixed:** the configured owner email had an extra `n` (`mohammadaffan@...`) compared with the intended owner email supplied by the administrator (`mohammadaffa@...`). The frontend, owner-only Edge Function, complete SQL schema, and legacy owner-lock migration now use `mohammadaffa@avenixoverseas.com` consistently.
- **Fixed:** frontend administrator recognition now requires the authenticated email and profile email to both match the configured owner, an `ADMIN` role, and `active = true`.
- **Fixed:** added `supabase/sql/20261024_fix_owner_email_and_permissions.sql`, a transactional, idempotent migration that only aligns the profile email when the matching Auth account already uses the intended owner email and updates `public.is_admin()`. It does not delete or rewrite financial records or staff permission rows.
- **Added:** `DATABASE-PERMISSIONS-REPAIR.md` with read-only checks for owner identity, staff grants, module/action keys, and relevant RLS policies before any migration is applied.
- **Still requires a separate implementation pass:** `canDo()` currently gates page visibility but is not yet applied consistently to every add/edit/delete/void/download/approve control. Database RLS/server-side checks must remain authoritative; the UI action controls should be gated module-by-module and tested in a browser. This gap is explicitly not claimed as fixed in this delivery.

## Remaining risks / not certified

- No live Supabase credentials or staging database were used, so schema compatibility, RLS behavior, database function grants, transaction atomicity, and real posting behavior remain unverified.
- No automated browser/E2E suite was run. Visual responsiveness, keyboard accessibility, print behavior, and every button/workflow require browser testing.
- The Edge Function currently allows `Access-Control-Allow-Origin: *`; assess and restrict origins for production if feasible. CORS is not an authorization mechanism.
- The application contains many database interactions and legacy report paths; syntax and helper tests cannot prove each query matches the deployed schema.
- GST defaults and tax treatment must be validated against company settings, actual supplies, and professional tax advice.
- The archive's historical release notes contain prior build descriptions. Treat the current SQL schema and source code, not stale prose, as authoritative.

No claim is made that all application bugs are fixed or that the live accounting system is production-certified.

## Owner-controlled access and menu visibility (2026-10-24)
- Frontend admin checks now require the authenticated owner email and matching profile email plus an active ADMIN profile.
- Non-admin navigation displays Dashboard plus only modules with an explicit VIEW grant; unauthorized direct navigation redirects to Dashboard. Dashboard values are masked without Dashboard VIEW permission.
- The admin-user-management Edge Function checks the signed-in user's email and profile email against the designated owner and blocks assigning ADMIN to other accounts.
- Added a SQL migration to update `public.is_admin()` for existing installations. This database migration must be applied to the target Supabase project; frontend changes alone are not database security.

## Regression checks run for this delivery

- `node tests/check-syntax.mjs` — passed (11 JavaScript files).
- `node tests/accounting.test.mjs` — passed (13 scenario groups).
- `node tests/permissions-config.test.mjs` — passed (owner email consistency and safe migration assertions).
- These checks do not connect to Supabase and do not certify deployed database policies or browser workflows.

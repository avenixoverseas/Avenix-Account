# Avenix Overseas — 2026-10-24 upgrade notes (owner lock + invoice print + avatar)

## Confirmed administrator
- Canonical owner email (locked in `public.is_admin()`, Edge Function, and frontend UI check):
  **mohammadaffan@avenixoverseas.com**

## Changes applied in this cycle

### Security / authorization
1. `supabase/sql/Supabase SQL.sql` — `is_admin()` now requires the confirmed owner email.
2. `supabase/sql/20261024_lock_admin_to_owner_email.sql` and `20261024_fix_owner_email_and_permissions.sql` updated.
3. New safe migration: `supabase/sql/20261024_owner_email_and_avatar.sql` (run on existing projects).
4. Edge Function `admin-user-management` now rejects any non-owner actor and blocks assigning ADMIN to any email other than the owner.
5. Frontend `isAdmin()` matches the same owner-lock rule (UI defence-in-depth only; RLS remains authoritative).

### Invoice / PDF fidelity
- `js/modules/reports.js` — added `print-color-adjust: exact` (and `-webkit-`) on invoice and report styles so navy/blue backgrounds, table headers, and category bar survive “Save as PDF”.
- GSTIN continues to be read from `company_settings` (shows “Not configured” when empty).

### Profile photos (foundation)
- Schema: `profiles.avatar_url` and `profiles.avatar_path` columns added.
- Dashboard welcome banner shows a circular avatar (or initial fallback) when `avatar_url` is present.
- CSS: `.user-avatar` / `.welcome-identity` styles added.
- Full upload UI + Supabase Storage policies still to be completed in a follow-up pass (requires Storage bucket `avatars` + RLS).

### Tests
- `tests/permissions-config.test.mjs` updated for owner-lock policy.
- `node tests/check-syntax.mjs` — passed
- `node tests/accounting.test.mjs` — passed
- `node tests/permissions-config.test.mjs` — passed

## Required Supabase steps (manual)
1. Backup the database.
2. Run `supabase/sql/20261024_owner_email_and_avatar.sql` in the SQL Editor.
3. Redeploy the Edge Function: `supabase functions deploy admin-user-management`
4. Confirm the Auth user for the owner has email exactly `mohammadaffan@avenixoverseas.com` and an active ADMIN profile with the same email.
5. (Optional) Create a private Storage bucket `avatars` and policies for authenticated users to upload their own object.

## Still outstanding (from master prompt)
- Full profile-image upload/preview/remove in User Management form
- Secure self-service password change (old + new + confirm) for ordinary users
- Company Settings card/panel redesign
- Receipt / expense voucher PDF polish and unique numbering guarantees
- Explicit transfer source → destination labels review
- Login History from real auth events (if not already)
- Downloaded History display of full user names
- Centralized Deleted/Voided UI enrichment
- Any remaining Petty Cash automatic-expense insertion removal (helpers already correct; verify DB triggers/RPCs)


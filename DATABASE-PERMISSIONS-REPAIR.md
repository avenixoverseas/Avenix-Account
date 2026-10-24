# Avenix Overseas — safe permission diagnosis and repair

## Before you begin

1. Take a Supabase database backup and confirm you can restore it.
2. Run the **read-only verification queries** below in the Supabase SQL Editor first.
3. Do not paste service-role keys into the browser or commit them to this ZIP.
4. The repair migration does not delete transactions or change existing `user_permissions` rows. It aligns the profile email only when the matching Supabase Auth account already uses `mohammadaffan@avenixoverseas.com`, then updates the `is_admin()` authorization helper.
5. If the real owner account in Supabase Auth does not use that exact email, stop and change the owner email in source/migration consistently after confirming the intended address. Do not change an Auth email just to make the migration pass.

## 1. Read-only verification queries

### A. Check the Auth/profile identity and role

```sql
select
  u.id,
  u.email as auth_email,
  p.email as profile_email,
  p.role,
  p.active,
  lower(trim(coalesce(u.email, ''))) = 'mohammadaffan@avenixoverseas.com' as is_intended_owner
from auth.users u
left join public.profiles p on p.id = u.id
where lower(trim(coalesce(u.email, ''))) = 'mohammadaffan@avenixoverseas.com'
   or lower(trim(coalesce(p.email, ''))) in (
     'mohammadaffan@avenixoverseas.com',
     'mohammadaffan@avenixoverseas.com'
   );
```

Expected: exactly one intended owner account, matching `auth_email` and `profile_email`, `role = ADMIN`, and `active = true`. If no row appears, stop and verify the actual owner email in **Authentication → Users**.

### B. Check staff permissions without exposing financial data

Replace the email below with the affected staff member's login email.

```sql
select
  p.email,
  p.role,
  p.active,
  up.module_key,
  up.action_key,
  up.allowed,
  up.updated_at
from public.profiles p
left join public.user_permissions up on up.user_id = p.id
where lower(trim(p.email)) = lower(trim('STAFF_EMAIL_HERE'))
order by up.module_key, up.action_key;
```

The menu appears only when the staff account is active and has an `allowed = true` row with `action_key = 'VIEW'` for the exact module label, e.g. `BILLS & INVOICES`, `PAYMENTS & RECEIPTS`, or `FINANCIAL REPORTS`.

### C. Check for misspelled or inconsistent module/action keys

```sql
select distinct module_key, action_key
from public.user_permissions
order by module_key, action_key;
```

Compare values to the module labels and actions in the user-management screen. Do not mass-rename keys without reviewing the result first.

### D. Confirm relevant RLS policies are installed

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'user_permissions')
order by tablename, policyname;
```

## 2. Apply the owner identity repair

After backup and after confirming the owner email in query A, run:

```sql
-- Run the supplied migration file:
-- supabase/sql/20261024_fix_owner_email_and_permissions.sql
```

You can paste the contents of that migration into the SQL Editor. It is wrapped in a transaction and is safe to rerun. It does not grant ADMIN to another account, delete records, or change staff permissions.

## 3. Deploy the matching Edge Function

From the project directory, after verifying the Supabase CLI is linked to the correct project:

```sh
supabase functions deploy admin-user-management
```

Ensure the function's server-side secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are set in Supabase. Never expose the service-role key to frontend code.

## 4. Re-test with a staff account

1. Sign out and sign back in so the app reloads the latest permissions.
2. Confirm the staff profile is `active = true`.
3. Grant `VIEW` for one harmless module first, save, then sign in as that staff member.
4. Verify the menu appears and records load. Then test each permitted action.
5. Verify denied actions remain blocked by database RLS/server-side authorization, not merely hidden in the UI.
6. If a module remains missing, check browser DevTools Console/Network for a failed `user_permissions` query and inspect the matching Supabase logs. Do not share access tokens or service-role keys.

## Important security note

A visible/hidden button is not a security boundary. Every write action must also be protected by RLS or a trusted server-side function. The supplied frontend's permission helper primarily governs navigation; action-level UI gating and full table-by-table RLS review remain necessary before production use. Apply changes first in a staging project and test all accounting workflows.

# Avenix Overseas — Permission and administrator verification

## Before changing production

1. Back up the Supabase database and confirm the restore procedure.
2. Verify the administrator account in Authentication → Users.
3. Use the read-only checks below before changing any policies or records.
4. Do not put service-role credentials in frontend files or share access tokens.

The designated administrator email is `mohammadaffan@avenixoverseas.com`. The canonical owner check is defined in `supabase/sql/Supabase SQL.sql`; this archive does not contain a separate owner-email repair migration. For an existing deployment, compare live functions and policies with the canonical schema rather than blindly rerunning the full schema.

## 1. Verify administrator identity

```sql
select
  u.id,
  u.email as auth_email,
  p.email as profile_email,
  p.role,
  p.active,
  lower(trim(coalesce(u.email, ''))) = 'mohammadaffan@avenixoverseas.com' as is_designated_owner
from auth.users u
left join public.profiles p on p.id = u.id
where lower(trim(coalesce(u.email, ''))) = 'mohammadaffan@avenixoverseas.com'
   or lower(trim(coalesce(p.email, ''))) = 'mohammadaffan@avenixoverseas.com';
```

Expected: one matching Auth user and profile, same email, `role = ADMIN`, and `active = true`.

## 2. Inspect a staff member's permissions

Replace `STAFF_EMAIL_HERE` with the staff login email.

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

A staff member needs an active profile and an `allowed = true` row with `action_key = 'VIEW'` for each module they should view. Module keys must match the application module labels.

## 3. Inspect installed RLS policies

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'user_permissions', 'clients', 'invoices', 'payments', 'expenses')
order by tablename, policyname;
```

The canonical schema uses `public.has_permission(module, action)` and `public.is_admin()` in its permission-aware policies. Confirm the deployed functions and policies enforce the same rules.

## 4. Avatar prerequisites

Confirm the `avatars` Storage bucket exists, `profiles.avatar_path` is populated for the relevant user, and Storage policies permit the intended uploader and viewer. The additive policy repair is `supabase/sql/20261024_fix_avatar_storage_admin_upload.sql`; it is separate from the main schema and should only be applied after reviewing the live policies.

## 5. Re-test safely

1. Sign out and back in after changing permissions.
2. Test with the administrator account.
3. Test with a separate staff account granted VIEW for one harmless module.
4. Confirm permitted records load and unpermitted records remain inaccessible.
5. Check browser Console/Network and Supabase logs for denied queries. Never share access tokens or service-role keys.

A hidden menu item is not a security boundary. Database RLS or trusted server-side authorization must enforce every protected read and write. This source archive cannot confirm that the live Supabase project has the required policies installed.

## 5. Apply the 2026-11-06 staff visibility and avatar repair

For an existing deployment, run `supabase/sql/20261106_fix_staff_permissions_and_avatars.sql` in Supabase SQL Editor. This adds a staff-scoped `get_my_permissions()` RPC, restores module-specific read policies for the records each page depends on, and ensures the private `avatars` bucket permits a user to read their own image while the designated administrator can manage user images.

Then deploy the updated administrator function from the project root:

```bash
supabase functions deploy admin-user-management
```

Sign out and sign back in with a staff test account after the administrator saves permissions. Permission changes are loaded at sign-in. Verify the staff account has the intended `VIEW` rows using the User Management screen, then test a menu with VIEW enabled and another with VIEW disabled. Do not grant staff `ADMIN` role or use a service-role key in browser code.

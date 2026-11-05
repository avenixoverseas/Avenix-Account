# Avenix Overseas — Source Review and Maintenance Notes

## Canonical project files

- Frontend entry point: `index.html`
- Main application: `js/app.js`
- Public browser configuration: `js/config.js`
- Canonical database schema and permission policies: `supabase/sql/Supabase SQL.sql`
- Additive avatar-storage policy repair: `supabase/sql/20261024_fix_avatar_storage_admin_upload.sql`
- User-management Edge Function: `supabase/functions/admin-user-management/index.ts`

## Administrator identity

The sole designated administrator email in the current project is:

`mohammadaffan@avenixoverseas.com`

The frontend, Edge Function and canonical SQL authorization helper must remain consistent with this value. The database `public.is_admin()` helper additionally requires the authenticated user to have an active `ADMIN` profile whose profile email matches the Auth email. Frontend checks are defense-in-depth; database RLS remains authoritative.

## Permission visibility

The frontend loads explicit `VIEW` grants for non-admin users and filters navigation accordingly. Database reads must also be allowed by the matching permission-aware RLS policies in the canonical SQL schema. A frontend deployment alone cannot repair policies in an already-running Supabase project.

## Profile images

Profile image display depends on a valid `profiles.avatar_path`, an `avatars` Storage bucket, and the applicable Storage policies. The avatar migration is an additive policy repair and is not a duplicate of the canonical schema. Keep it available for existing deployments that need administrator-managed uploads.

## Source review boundaries

- Browser configuration contains the Supabase URL and publishable key; privileged service-role credentials must remain in Edge Function secrets.
- No live Supabase project was accessed during this source review.
- Static source checks cannot certify deployed RLS policies, Storage configuration, or real user permissions.
- Preserve legacy accounting fields and compatibility logic unless database usage confirms they are unused; removing them speculatively could damage historical records or reports.


## 2026-11-06 — Staff visibility and avatar repair
- Standardized the designated administrator email across source files and the user-management Edge Function.
- Staff permission loading now calls `get_my_permissions()` and normalizes module/action keys before filtering navigation. A direct own-row query remains as a fail-closed compatibility fallback.
- Added `supabase/sql/20261106_fix_staff_permissions_and_avatars.sql` with a user-scoped permission RPC, permission-aware SELECT policies for module dependencies, and private avatar Storage policies.
- Dashboard avatar rendering now refreshes a signed URL from `avatar_path` and avoids reusing an expired signed URL.
- Avatar uploads now save the object path and require successful signed-URL creation instead of falling back to a public URL for a private bucket.
- The SQL migration and Edge Function must be applied/deployed in the live Supabase project; editing the ZIP alone does not change the live database or deployed function.

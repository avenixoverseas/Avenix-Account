# Avenix Overseas — Administrator and Avatar Configuration

## Designated administrator

`mohammadaffan@avenixoverseas.com`

The frontend, Edge Function and canonical SQL authorization helper use this administrator identity. The active Auth user and matching `profiles` row must use the same email and `ADMIN` role.

## Canonical database files

- Full schema and RLS policies: `supabase/sql/Supabase SQL.sql`
- Additive avatar Storage policy repair: `supabase/sql/20261024_fix_avatar_storage_admin_upload.sql`

There are no separate owner-email patch migrations in this archive. Do not run filenames mentioned in older notes if they are not present in this project.

## Safe deployment sequence

1. Back up the live Supabase database.
2. Verify the administrator Auth account and matching active `ADMIN` profile.
3. For a new database, review and apply the canonical schema in a staging project first.
4. For an existing database, inspect the current schema and policies before applying any schema changes; do not blindly rerun a full setup script over production.
5. Confirm the private `avatars` Storage bucket exists, then review/apply the additive avatar policy repair if needed.
6. Deploy the `admin-user-management` Edge Function with its service-role key configured only as a server-side secret.
7. Test staff VIEW grants, administrator access, profile-image upload and image display with separate test accounts.

## Important

This archive cannot verify whether SQL migrations have already been applied to the live Supabase project. Do not delete or replace database policies based only on frontend behavior.

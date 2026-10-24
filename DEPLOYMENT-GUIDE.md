# Deployment Guide

## Static frontend

Deploy the project root contents to a static host that supports HTTPS and JavaScript modules. Preserve relative paths for `index.html`, `css/`, `js/`, and `assets/`. Configure `js/config.js` with the intended Supabase project URL and public key before release.

Do not deploy `.env` files, service-role keys, local backups, or customer exports.

## Supabase

1. Back up and review the target database.
2. Apply the reviewed `supabase/sql/Supabase SQL.sql` only after staging validation and approval.
3. Deploy the Edge Function from the project root using the Supabase CLI, for example:

```sh
supabase functions deploy admin-user-management
```

4. Configure the Edge Function secrets listed in `CONFIGURATION-GUIDE.md`.
5. Review Edge Function CORS origins for the production host.
6. Verify authentication, RLS, permissions, and financial posting with staging/test accounts before enabling real usage.

## Release gate

Do not declare production readiness until browser-based workflows and live database permission tests pass. Record the deployed schema revision, frontend artifact, function deployment, backup reference, and rollback plan.

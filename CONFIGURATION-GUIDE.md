# Configuration Guide

## Browser configuration

The static frontend reads configuration from `js/config.js`:

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_ANON_KEY`: browser-safe publishable/anon key only.
- `COMPANY`: company name, contact details, branding metadata.
- `GST_RATE`: legacy/default frontend tax value; database/company settings and the actual invoice implementation must be verified in staging before relying on tax calculations.

These values are delivered to every browser user. Do not store passwords, service-role keys, database credentials, or other privileged secrets here.

## Supabase server-side secrets

The `admin-user-management` Edge Function expects server environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Set these through Supabase Edge Function secrets/managed environment configuration. The service-role key must remain server-side only.

## Database and authentication

- Ensure the deployed SQL schema matches the frontend and Edge Function.
- Confirm email/password authentication is configured as intended.
- Ensure profiles are linked to `auth.users` and that active admin/staff roles and permissions are assigned by an authorized administrator.
- Verify RLS and database function grants with test users of each role.

## Company and tax settings

Company identity and contact information are currently configured in `js/config.js`. GST and accounting settings may also be stored in Supabase; verify which source is authoritative in the current deployment. Confirm tax treatment with a qualified Indian tax professional. Do not assume one GST rate applies to every supply or transaction.

## CORS

The Edge Function currently returns `Access-Control-Allow-Origin: *`. Before a production deployment, review whether the frontend can use a restricted origin allowlist appropriate to your hosting domains. Keep authentication and authorization checks even if CORS is restricted.

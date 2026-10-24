# Avenix Accounting — enabling website user management

The website's Add User and Edit User controls call the protected Supabase Edge Function at `supabase/functions/admin-user-management/index.ts`. The function creates Supabase Auth users server-side, writes `public.profiles`, and saves the selected rows in `public.user_permissions`. No service-role key is placed in browser code.

## Deploy once to the existing Supabase project

Run these commands from the `avenix-account` project folder using the Supabase CLI, after signing in to the CLI:

```sh
supabase login
supabase link --project-ref nvjbsacfpotyrbrzkbom
supabase functions deploy admin-user-management
```

The function expects the standard Supabase Edge Function environment variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to be available to the function runtime. If the project does not expose them automatically, configure them as Edge Function secrets in the Supabase Dashboard. Never place `SUPABASE_SERVICE_ROLE_KEY` in `js/config.js`, HTML, or any browser-accessible file.

## Use it

1. Sign into the website using an active `ADMIN` profile.
2. Open **User Management → Add User**.
3. Enter the full name, email, mobile number, and a temporary password of at least 12 characters; choose the role and permissions.
4. Create the user. The new Auth user is email-confirmed by the function and can sign in with the password supplied by the administrator. Share that password securely, not in public chat or an ordinary group message.
5. Edit an existing user to update profile fields, role, active status, saved permission matrix, or password (leave password blank to keep it unchanged).

The function blocks non-admin callers, prevents an administrator from disabling/demoting their own account, and prevents removing the last active administrator.

## Accounting balance behavior

Cash and bank account balances are calculated in the frontend from the opening balance plus posted receipts and transfers in, minus posted expenses and transfers out. This requires no schema change. Invoices now display invoice total, payments received, and balance due; after a payment is recorded, the original invoice's outstanding balance updates and the new receipt appears under **Payments & Receipts**. A receipt does not create a second invoice, because that would bill the client twice.

## Permissions enforcement

The `user_permissions` matrix is enforced both in the UI (menu visibility and page access) and in the database via Row Level Security policies that call `public.has_permission(module, action)`. Active administrators (`role = ADMIN`) have full access. Staff only receive the modules and actions granted by an administrator in User Management.

Always run `supabase/sql/AVENIX_COMPLETE_SCHEMA.sql` so the permission-aware policies are installed.

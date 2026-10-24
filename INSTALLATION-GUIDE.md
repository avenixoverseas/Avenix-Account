# Installation Guide

## 1. Extract

Extract the ZIP into a writable folder. The project root is the folder containing `index.html`, `package.json`, `js/`, `css/`, `assets/`, and `supabase/`.

## 2. Install runtime tools

Install Node.js 18+ and Python 3. No npm packages are required for the included tests; the frontend imports Supabase JS v2.57.4 from `https://esm.sh/` at runtime, so browser access to that host is required.

## 3. Configure Supabase

Review `CONFIGURATION-GUIDE.md`. Use only the project's URL and publishable/anon key in `js/config.js`. Never expose a service-role key.

## 4. Start the frontend

In a terminal opened at the project root:

```sh
python -m http.server 8800
```

Visit `http://localhost:8800/index.html`. Keep the server running while using the site.

## 5. Run local checks

```sh
npm run check:syntax
npm run test:accounting
```

These tests do not require a live database. Live sign-in and database actions do.

## 6. First-use verification

Use a staging Supabase project and test accounts. Verify login, page permissions, client creation, invoice creation, a partial receipt, expense posting, transfer, void/reversal, reports, print/export, and Trial Balance equality. Do not use real customer records or transactions for testing.

## Troubleshooting

- Blank screen/module errors: use an HTTP server rather than opening the file directly; inspect browser DevTools Console and Network.
- Login/database errors: verify the Supabase URL/key, project status, RLS policies, schema, and deployed Edge Function.
- SQL errors: stop, save the complete error, and review it before attempting any additional migration. Do not disable RLS or run unrelated legacy SQL files.

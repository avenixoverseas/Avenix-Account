# Avenix Overseas Accounting

A static HTML/CSS/JavaScript accounting application backed by Supabase. The existing project and `supabase/sql/Supabase SQL.sql` are the source of truth.

## Included modules

Dashboard, clients and ledgers, invoices, payments/receipts, expenses, cash and bank accounts, petty cash, transfers/deposits, financial reports, receivables, audit/login history, download history, voided records, reconciliation, backup/restore, user management, and company settings (as implemented in the supplied source).

## Requirements

- Node.js 18+ (for the included test command; a recent LTS is recommended)
- Python 3 (or another static HTTP server) to run the frontend locally
- A Supabase project configured for this application

## Run locally

1. Extract the ZIP.
2. Review `js/config.js`. It contains browser-visible Supabase project URL and publishable/anon key. Replace these with your own project's public values if needed. **Never put a service-role key in frontend files.**
3. From the project root run `python -m http.server 8800`.
4. Open `http://localhost:8800/index.html`.
5. Sign in with an existing Supabase Auth account configured in the project.

Opening `index.html` directly with a `file://` URL may fail because the app uses JavaScript modules; use the local HTTP server.

## Checks

- `npm run test:accounting` — pure accounting-helper scenarios.
- `npm run check:syntax` — JavaScript syntax checks for application and test files.

Passing these checks does not validate live Supabase access, RLS, Edge Function deployment, accounting database functions, or browser workflows. See `TEST-REPORT.md`.

## Supabase and production safety

Back up the database and test in an isolated/staging project before applying SQL. Read `DATABASE-MIGRATION-GUIDE.md` first. The schema can alter functions and RLS policies even though it is designed not to drop business tables. Do not run it against production without reviewing its effects and confirming compatibility with your existing schema.

## Documentation

- `INSTALLATION-GUIDE.md`
- `CONFIGURATION-GUIDE.md`
- `DATABASE-MIGRATION-GUIDE.md`
- `DEPLOYMENT-GUIDE.md`
- `BUG-FIX-REPORT.md`
- `TEST-REPORT.md`
- `CHANGELOG.md`

## Known verification boundary

This delivery is a source-level repair and documentation pass over the supplied archive. No live Supabase project was accessed and no live customer transactions were created, edited, voided, or deleted. Do not treat this package as production-certified until staging verification is complete.

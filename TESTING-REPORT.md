# Avenix Accounting ERP — Validation Report

Date: 2026-11-08

## Automated local checks

| Check | Result |
|---|---|
| JavaScript syntax | PASS — 10 JS files |
| Accounting schema invariants | PASS |
| Permission / RPC grant checks | PASS |
| Navigation / local assets | PASS |
| Payroll UI / SQL invariants | PASS |

Run `npm run check:syntax`, `npm run test:accounting`, `npm run test:permissions`, `npm run test:navigation`, and `npm run test:payroll`.

## Changes in this package

- Fixed salary-component inserts by explicitly sending `is_statutory` for all ten component rows.
- Consolidated Supabase SQL into one canonical `supabase/sql/schema.sql`; previous split SQL files were removed.
- Added a safe legacy NULL backfill and `NOT NULL DEFAULT false` constraint for `salary_components.is_statutory`.
- Added atomic payroll payment posting with a dedicated bank ledger mapping, balanced journal lines, paid status updates, payslip generation and duplicate-post protection.
- The approval UI requires a bank account and immediately invokes payment posting. If posting fails after approval, it remains approved and can be retried.
- Added a global activity sequence, database triggers across public tables, and an admin-only Global Activity Register page.

## Not verified in this environment

- The consolidated SQL was not executed against the user's hosted Supabase database.
- No live Supabase Auth session, RLS runtime test, production browser session, or actual bank/payment gateway credentials were available.
- The ERP payment function posts to the internal bank ledger. It does not transmit real money through a bank. Actual NEFT/IMPS/RTGS requires a supported bank API and bank-side confirmation.
- PF, ESI, professional tax and TDS values require accountant review and validation for the company's jurisdiction and employee eligibility.
- A staging database and end-to-end test payroll should be completed before production deployment.

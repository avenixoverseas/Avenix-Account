# Avenix Accounting ERP — Code Audit

Date: 2026-11-08

## Scope reviewed

- ZIP inventory and project layout
- Frontend payroll salary structure and monthly payroll flows
- Supabase base schema, payroll schema and reporting helpers
- Bank accounts and double-entry journal schema
- Existing automated syntax, accounting, permissions and navigation tests

## Findings and repairs

1. Salary component inserts did not explicitly supply `is_statutory` for ordinary earning components and ordinary deductions. This caused the reported database NOT NULL failure in installations whose column had no default. The UI now explicitly sets the field for every component. The consolidated SQL backfills NULL values and enforces `DEFAULT false NOT NULL`.
2. Payroll approval previously changed a batch status without posting a bank ledger debit or generating payslips. The approval UI now selects a bank account and invokes an atomic database RPC. The RPC requires an approved batch, a dedicated mapped bank ledger, balanced journal lines, and prevents duplicate posting.
3. Successful payroll posting marks lines PAID, marks the batch PAID, and generates/upserts one payslip per payroll line.
4. Added a global event sequence and database triggers to record INSERT/UPDATE/DELETE operations across public tables. Added an admin-only chronological activity register.
5. Corrected the trial balance helper's chart-of-accounts field names to match the actual schema.
6. Removed the previous split payroll/report/migration SQL files and replaced them with one canonical SQL file.

## Validation

All five local automated checks pass: JavaScript syntax, accounting invariants, permission/RPC grants, navigation/assets and payroll invariants.

## Limitations

This source-only review cannot access the live Supabase database. The consolidated SQL must be applied to a staging clone and verified before production. No real bank transfer is made by the ERP posting RPC; only internal accounting ledgers are updated. A real bank integration requires a provider API, credentials, beneficiary checks and bank-side confirmation.

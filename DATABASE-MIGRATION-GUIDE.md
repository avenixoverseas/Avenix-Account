# Database Migration and Safety Guide

## Before applying SQL

1. Identify the exact Supabase project and environment.
2. Take a verified database backup and confirm that it can be restored.
3. Export or record the current schema, policies, functions, extensions, and grants.
4. Read all of `supabase/sql/Supabase SQL.sql`.
5. Compare every `ALTER TABLE`, `CREATE OR REPLACE FUNCTION`, policy change, trigger, grant, and seed operation against the current project.
6. Test the script on a restored copy or isolated staging project first.
7. Keep a written rollback plan and record the starting migration/version.

## Canonical schema file

Use `supabase/sql/Supabase SQL.sql` as the current schema file in this archive. Do not use older SQL files referenced by historical release-note text or unrelated snippets.

## Important cautions

The script describes itself as non-destructive, but replacing functions and RLS policies can change production behavior. A backup does not make an unreviewed migration safe. Do not execute against production merely because the script uses `IF NOT EXISTS`.

Do not drop tables, delete Auth users, disable RLS, or overwrite production data with samples. Do not run test transactions against real customer records.

## Staging verification

Using test-only accounts and records, verify:
- Admin and staff authorization, including denied operations.
- Invoice posting and tax splits.
- Multiple partial receipts against one invoice; no duplicate sales income.
- Expense posting and reversal.
- Cash/bank transfers with balanced source and destination movements.
- Period lock behavior.
- Audit trail for voids/reversals.
- Client ledgers, P&L, Balance Sheet, and Trial Balance.
- Trial Balance debits equal credits.
- Backup and restore behavior.

## Rollback

Prefer restoring the tested backup into a separate recovery project and planning a controlled cutover. Do not invent reverse SQL for changes that may have modified business data. If a migration fails partway, stop and inspect the actual database state before retrying.

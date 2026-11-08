import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const sql = await readFile(new URL('../supabase/sql/schema.sql', import.meta.url), 'utf8');
const rpcPermissions = {
  create_invoice: "BILLS & INVOICES",
  record_invoice_payment: "PAYMENTS & RECEIPTS",
  record_expense: "EXPENSES",
  record_transfer: "TRANSFERS & DEPOSITS",
  void_invoice_payment: "PAYMENTS & RECEIPTS",
  void_expense: "EXPENSES",
  edit_expense: "EXPENSES",
  edit_invoice_payment: "PAYMENTS & RECEIPTS"
};
for (const [fn, module] of Object.entries(rpcPermissions)) {
  const start = sql.toLowerCase().indexOf(`create or replace function public.${fn}`);
  assert.notEqual(start, -1, `Missing RPC ${fn}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `Unterminated function ${fn}`);
  assert.ok(sql.slice(start, end).includes('assert_app_permission') || sql.slice(start, end).includes('has_permission'), `${fn} must enforce permissions`);
}
assert.match(sql, /revoke execute on all functions in schema public from public, anon/i);
const policyNames = [...sql.matchAll(/create policy\s+([a-z0-9_]+)/gi)].map(m => m[1]);
for (const policy of policyNames) assert.ok(new RegExp(`drop policy if exists ${policy}\\b`, 'i').test(sql), `Policy ${policy} should be safely recreated`);
assert.ok(sql.toLowerCase().includes('grant execute on function public.create_invoice') && sql.toLowerCase().includes('to authenticated'));
console.log('RPC permission and execution grants OK.');

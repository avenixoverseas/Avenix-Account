/*
  AVENIX OVERSEAS — STAFF PERMISSION READ + PROFILE AVATAR REPAIR
  Safe, additive repair for an already deployed Supabase project.

  Apply in Supabase SQL Editor after taking a database backup.
  Does not delete users, permissions, accounting records, or Storage objects.
*/

-- 1) Keep permission checks centralized and case/whitespace tolerant.
create or replace function public.has_permission(p_module text, p_action text default 'VIEW')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.user_permissions up
      join public.profiles p on p.id = up.user_id
      where up.user_id = auth.uid()
        and p.active is true
        and coalesce(up.allowed, false) is true
        and upper(trim(coalesce(up.module_key, ''))) = upper(trim(coalesce(p_module, '')))
        and upper(trim(coalesce(up.action_key, ''))) = upper(trim(coalesce(p_action, 'VIEW')))
    );
$$;

-- 2) Staff can retrieve only their own permission rows through this RPC.
-- SECURITY DEFINER avoids deployment-specific SELECT-policy inconsistencies;
-- auth.uid() is still enforced inside the function and cannot be supplied by caller.
create or replace function public.get_my_permissions()
returns table(module_key text, action_key text, allowed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    upper(trim(coalesce(up.module_key, ''))) as module_key,
    upper(trim(coalesce(up.action_key, ''))) as action_key,
    coalesce(up.allowed, false) as allowed
  from public.user_permissions up
  join public.profiles p on p.id = up.user_id
  where up.user_id = auth.uid()
    and p.active is true
  order by upper(trim(coalesce(up.module_key, ''))), upper(trim(coalesce(up.action_key, '')));
$$;

revoke all on function public.get_my_permissions() from public;
grant execute on function public.get_my_permissions() to authenticated;
grant select on public.user_permissions to authenticated;
grant select on public.profiles to authenticated;

-- Keep the direct own-row read as a secure fallback for older frontend builds.
alter table public.user_permissions enable row level security;
drop policy if exists avenix_permissions_self_read on public.user_permissions;
create policy avenix_permissions_self_read
  on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Profile rows remain private: a user reads their own profile; only the owner-admin
-- can read/manage all profiles through the existing is_admin() authorization.
alter table public.profiles enable row level security;
drop policy if exists avenix_profiles_self_read on public.profiles;
create policy avenix_profiles_self_read
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- 3) Restore explicit SELECT grants per module. These are additive RLS policies;
-- they do not grant users access to modules without a matching VIEW permission.
DO $$
BEGIN
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_company_view ON public.company_settings';
    EXECUTE 'CREATE POLICY avenix_company_view ON public.company_settings FOR SELECT TO authenticated USING (public.has_permission(''COMPANY SETTINGS'',''VIEW'') OR public.has_permission(''DASHBOARD'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.chart_of_accounts') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_chart_view ON public.chart_of_accounts';
    EXECUTE 'CREATE POLICY avenix_chart_view ON public.chart_of_accounts FOR SELECT TO authenticated USING (public.has_permission(''GENERAL LEDGER'',''VIEW'') OR public.has_permission(''FINANCIAL REPORTS'',''VIEW'') OR public.has_permission(''CASH ACCOUNTS'',''VIEW'') OR public.has_permission(''BANK ACCOUNTS'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.cash_accounts') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_cash_view ON public.cash_accounts';
    EXECUTE 'CREATE POLICY avenix_cash_view ON public.cash_accounts FOR SELECT TO authenticated USING (public.has_permission(''CASH ACCOUNTS'',''VIEW'') OR public.has_permission(''PETTY CASH'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.bank_accounts') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_bank_view ON public.bank_accounts';
    EXECUTE 'CREATE POLICY avenix_bank_view ON public.bank_accounts FOR SELECT TO authenticated USING (public.has_permission(''BANK ACCOUNTS'',''VIEW'') OR public.has_permission(''BANK RECONCILIATION'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_clients_view ON public.clients';
    EXECUTE 'CREATE POLICY avenix_clients_view ON public.clients FOR SELECT TO authenticated USING (public.has_permission(''CLIENTS'',''VIEW'') OR public.has_permission(''CLIENT LEDGERS'',''VIEW'') OR public.has_permission(''BILLS & INVOICES'',''VIEW'') OR public.has_permission(''OUTSTANDING BALANCES'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.sub_agents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.sub_agents ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_agents_view ON public.sub_agents';
    EXECUTE 'CREATE POLICY avenix_agents_view ON public.sub_agents FOR SELECT TO authenticated USING (public.has_permission(''SUB-AGENTS'',''VIEW'') OR public.has_permission(''SUB-AGENT LEDGERS'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.journal_entries') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_journal_entries_view ON public.journal_entries';
    EXECUTE 'CREATE POLICY avenix_journal_entries_view ON public.journal_entries FOR SELECT TO authenticated USING (public.has_permission(''GENERAL LEDGER'',''VIEW'') OR public.has_permission(''FINANCIAL REPORTS'',''VIEW'') OR public.has_permission(''CLIENT LEDGERS'',''VIEW'') OR public.has_permission(''SUB-AGENT LEDGERS'',''VIEW'') OR public.has_permission(''CASH ACCOUNTS'',''VIEW'') OR public.has_permission(''BANK ACCOUNTS'',''VIEW'') OR public.has_permission(''PETTY CASH'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.journal_lines') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_journal_lines_view ON public.journal_lines';
    EXECUTE 'CREATE POLICY avenix_journal_lines_view ON public.journal_lines FOR SELECT TO authenticated USING (public.has_permission(''GENERAL LEDGER'',''VIEW'') OR public.has_permission(''FINANCIAL REPORTS'',''VIEW'') OR public.has_permission(''CLIENT LEDGERS'',''VIEW'') OR public.has_permission(''SUB-AGENT LEDGERS'',''VIEW'') OR public.has_permission(''CASH ACCOUNTS'',''VIEW'') OR public.has_permission(''BANK ACCOUNTS'',''VIEW'') OR public.has_permission(''PETTY CASH'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.invoices') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_invoices_view ON public.invoices';
    EXECUTE 'CREATE POLICY avenix_invoices_view ON public.invoices FOR SELECT TO authenticated USING (public.has_permission(''BILLS & INVOICES'',''VIEW'') OR public.has_permission(''OUTSTANDING BALANCES'',''VIEW'') OR public.has_permission(''CLIENT LEDGERS'',''VIEW'') OR public.has_permission(''FINANCIAL REPORTS'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.invoice_items') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_invoice_items_view ON public.invoice_items';
    EXECUTE 'CREATE POLICY avenix_invoice_items_view ON public.invoice_items FOR SELECT TO authenticated USING (public.has_permission(''BILLS & INVOICES'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.payments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_payments_view ON public.payments';
    EXECUTE 'CREATE POLICY avenix_payments_view ON public.payments FOR SELECT TO authenticated USING (public.has_permission(''PAYMENTS & RECEIPTS'',''VIEW'') OR public.has_permission(''CLIENT LEDGERS'',''VIEW'') OR public.has_permission(''FINANCIAL REPORTS'',''VIEW'') OR public.has_permission(''OUTSTANDING BALANCES'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.expenses') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_expenses_view ON public.expenses';
    EXECUTE 'CREATE POLICY avenix_expenses_view ON public.expenses FOR SELECT TO authenticated USING (public.has_permission(''EXPENSES'',''VIEW'') OR public.has_permission(''PETTY CASH'',''VIEW'') OR public.has_permission(''FINANCIAL REPORTS'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.expense_categories') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_expense_categories_view ON public.expense_categories';
    EXECUTE 'CREATE POLICY avenix_expense_categories_view ON public.expense_categories FOR SELECT TO authenticated USING (public.has_permission(''EXPENSES'',''VIEW'') OR public.has_permission(''PETTY CASH'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.transfers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_transfers_view ON public.transfers';
    EXECUTE 'CREATE POLICY avenix_transfers_view ON public.transfers FOR SELECT TO authenticated USING (public.has_permission(''TRANSFERS & DEPOSITS'',''VIEW'') OR public.has_permission(''FINANCIAL REPORTS'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.credit_notes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_credit_notes_view ON public.credit_notes';
    EXECUTE 'CREATE POLICY avenix_credit_notes_view ON public.credit_notes FOR SELECT TO authenticated USING (public.has_permission(''BILLS & INVOICES'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.download_logs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.download_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_download_logs_view ON public.download_logs';
    EXECUTE 'CREATE POLICY avenix_download_logs_view ON public.download_logs FOR SELECT TO authenticated USING (public.has_permission(''DOWNLOADED HISTORY'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_audit_logs_view ON public.audit_logs';
    EXECUTE 'CREATE POLICY avenix_audit_logs_view ON public.audit_logs FOR SELECT TO authenticated USING (public.has_permission(''LOGIN HISTORY'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.login_history') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_login_history_view ON public.login_history';
    EXECUTE 'CREATE POLICY avenix_login_history_view ON public.login_history FOR SELECT TO authenticated USING (public.has_permission(''LOGIN HISTORY'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.deleted_records') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.deleted_records ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_deleted_records_view ON public.deleted_records';
    EXECUTE 'CREATE POLICY avenix_deleted_records_view ON public.deleted_records FOR SELECT TO authenticated USING (public.has_permission(''DELETED / VOIDED'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.bank_reconciliations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_bank_reconciliations_view ON public.bank_reconciliations';
    EXECUTE 'CREATE POLICY avenix_bank_reconciliations_view ON public.bank_reconciliations FOR SELECT TO authenticated USING (public.has_permission(''BANK RECONCILIATION'',''VIEW'') OR public.is_admin())';
  END IF;
  IF to_regclass('public.bank_statement_lines') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS avenix_bank_statement_lines_view ON public.bank_statement_lines';
    EXECUTE 'CREATE POLICY avenix_bank_statement_lines_view ON public.bank_statement_lines FOR SELECT TO authenticated USING (public.has_permission(''BANK RECONCILIATION'',''VIEW'') OR public.is_admin())';
  END IF;
END $$;

-- 4) Private avatar bucket: allow users to read their own folder and the owner-admin
-- to manage users' folders. Existing objects are preserved.
alter table storage.objects enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS avenix_avatar_read_own ON storage.objects;
CREATE POLICY avenix_avatar_read_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin()));

DROP POLICY IF EXISTS avenix_avatar_insert_own_or_admin ON storage.objects;
CREATE POLICY avenix_avatar_insert_own_or_admin ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin()));

DROP POLICY IF EXISTS avenix_avatar_update_own_or_admin ON storage.objects;
CREATE POLICY avenix_avatar_update_own_or_admin ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin()))
  WITH CHECK (bucket_id = 'avatars' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin()));

DROP POLICY IF EXISTS avenix_avatar_delete_own_or_admin ON storage.objects;
CREATE POLICY avenix_avatar_delete_own_or_admin ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin()));

-- Quick verification output after applying:
-- select * from public.get_my_permissions();
-- select public.has_permission('CLIENTS','VIEW');
-- select id, avatar_path from public.profiles where id = auth.uid();

/*
  ============================================================================
  AVENIX OVERSEAS — COMPLETE SUPABASE SCHEMA (SINGLE FILE)
  ============================================================================
  File: supabase/sql/schema.sql
  Run as one complete script in Supabase SQL Editor after a full backup; managed policies and triggers are recreated safely.

  Includes:
  - Profiles, permissions, company settings
  - Chart of accounts, cash/bank, clients, sub-agents
  - Journals, invoices, payments, expenses, transfers, credit notes
  - Token / Candidate Visit Management
  - Login history, audit, download logs, bank reconciliation
  - All SECURITY DEFINER RPCs used by the app
  - Row Level Security policies
  - Avatar storage policies (private bucket "avatars")

  Designated owner (ADMIN lock):
    mohammadaffan@avenixoverseas.com

  After running this SQL:
  1. Deploy Edge Function: supabase functions deploy admin-user-management
  2. Ensure Auth user with the owner email exists and has role ADMIN
  ============================================================================
*/

create extension if not exists pgcrypto;

-- ============================================================
-- 1. PROFILES & PERMISSIONS
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  role text not null default 'STAFF' check (upper(role::text) in ('ADMIN','STAFF')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles add column if not exists mobile text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists avatar_path text;

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_key text not null,
  action_key text not null,
  allowed boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, module_key, action_key)
);
-- Migrate legacy column names if an older schema exists
alter table public.user_permissions add column if not exists module_key text;
alter table public.user_permissions add column if not exists action_key text;
alter table public.user_permissions add column if not exists allowed boolean not null default false;
alter table public.user_permissions add column if not exists created_by uuid;
alter table public.user_permissions add column if not exists updated_at timestamptz not null default now();
-- Backfill module_key from legacy module column if present
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='user_permissions' and column_name='module') then
    update public.user_permissions set module_key = coalesce(module_key, module) where module_key is null and module is not null;
  end if;
exception when others then null;
end $$;
-- Ensure unique constraint on (user_id, module_key, action_key)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_permissions_user_id_module_key_action_key_key') then
    begin
      alter table public.user_permissions add constraint user_permissions_user_id_module_key_action_key_key unique (user_id, module_key, action_key);
    exception when others then null;
    end;
  end if;
end $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid()
      and upper(trim(coalesce(p.role::text, ''))) = 'ADMIN'
      and p.active = true
      and lower(trim(coalesce(u.email, ''))) = 'mohammadaffan@avenixoverseas.com'
      and lower(trim(coalesce(p.email, ''))) = lower(trim(u.email))
  );
$$;

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
      and p.active = true
      and up.allowed = true
      and upper(trim(up.module_key)) = upper(trim(p_module))
      and upper(trim(up.action_key)) = upper(trim(p_action))
  );
$$;

-- ============================================================
-- 2. COMPANY SETTINGS (GST rates + period lock)
-- ============================================================
create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text not null default 'Avenix Overseas',
  address text,
  email text,
  secondary_email text,
  mobile text,
  gstin text,
  website text default 'https://avenixoverseas.com',
  payment_instructions text,
  sgst_rate numeric(5,2) not null default 9.00 check (sgst_rate >= 0 and sgst_rate <= 100),
  cgst_rate numeric(5,2) not null default 9.00 check (cgst_rate >= 0 and cgst_rate <= 100),
  igst_rate numeric(5,2) not null default 18.00 check (igst_rate >= 0 and igst_rate <= 100),
  period_lock_date date,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function public.get_company_settings()
returns public.company_settings language sql stable security definer set search_path = public as $$
  select * from public.company_settings order by created_at limit 1;
$$;

insert into public.company_settings (company_name, sgst_rate, cgst_rate, igst_rate)
select 'Avenix Overseas', 9.00, 9.00, 18.00
where not exists (select 1 from public.company_settings);

-- ============================================================
-- 3. CHART OF ACCOUNTS (names only in UI; codes internal)
-- ============================================================
create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  account_code text unique,
  account_name text not null unique,
  account_type text not null check (lower(account_type) in ('asset','liability','equity','income','expense')),
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.chart_of_accounts add column if not exists account_code text;
alter table public.chart_of_accounts add column if not exists account_name text;
alter table public.chart_of_accounts add column if not exists account_type text;
alter table public.chart_of_accounts add column if not exists is_active boolean not null default true;
alter table public.chart_of_accounts add column if not exists is_system boolean not null default false;

insert into public.chart_of_accounts (account_code, account_name, account_type, is_system)
values
  ('1000', 'Cash in Hand',              'asset',     true),
  ('1010', 'Petty Cash',                'asset',     true),
  ('1100', 'Bank Accounts',             'asset',     true),
  ('1200', 'Accounts Receivable',       'asset',     true),
  ('1300', 'Input CGST',                'asset',     true),
  ('1310', 'Input SGST',                'asset',     true),
  ('1320', 'Input IGST',                'asset',     true),
  ('1400', 'Advances to Suppliers',     'asset',     false),
  ('1500', 'Other Current Assets',      'asset',     false),
  ('2000', 'Accounts Payable',          'liability', true),
  ('2100', 'Output CGST',               'liability', true),
  ('2110', 'Output SGST',               'liability', true),
  ('2120', 'Output IGST',               'liability', true),
  ('2200', 'Client Advances',           'liability', true),
  ('2300', 'GST Payable',               'liability', true),
  ('2400', 'Other Current Liabilities', 'liability', false),
  ('3000', 'Capital / Owner Equity',    'equity',    true),
  ('3100', 'Retained Earnings',         'equity',    true),
  ('3200', 'Drawings',                  'equity',    false),
  ('4000', 'Service Income',            'income',    true),
  ('4100', 'Consultation Fees',         'income',    false),
  ('4200', 'Visa / Application Fees',   'income',    false),
  ('4300', 'Other Income',              'income',    false),
  ('5000', 'Office Expenses',           'expense',   true),
  ('5100', 'Travel & Conveyance',       'expense',   true),
  ('5200', 'Marketing & Advertising',   'expense',   true),
  ('5300', 'Staff Salaries',            'expense',   false),
  ('5400', 'Rent & Utilities',          'expense',   true),
  ('5500', 'Professional Fees',         'expense',   false),
  ('5600', 'Bank Charges',              'expense',   true),
  ('5700', 'Other Expenses',            'expense',   true)
on conflict (account_name) do nothing;

-- ============================================================
-- 4. CASH & BANK ACCOUNTS
-- ============================================================
create table if not exists public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location text,
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  ledger_account_id uuid references public.chart_of_accounts(id),
  opening_journal_entry_id uuid,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.cash_accounts add column if not exists ledger_account_id uuid references public.chart_of_accounts(id);
alter table public.cash_accounts add column if not exists opening_journal_entry_id uuid;
alter table public.cash_accounts add column if not exists created_by uuid references public.profiles(id);

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_label text not null,
  account_holder text,
  account_number text,
  ifsc text,
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  ledger_account_id uuid references public.chart_of_accounts(id),
  opening_journal_entry_id uuid,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.bank_accounts add column if not exists account_label text;
alter table public.bank_accounts add column if not exists account_holder text;
alter table public.bank_accounts add column if not exists account_number text;
alter table public.bank_accounts add column if not exists ifsc text;
alter table public.bank_accounts add column if not exists ledger_account_id uuid references public.chart_of_accounts(id);
alter table public.bank_accounts add column if not exists opening_journal_entry_id uuid;
alter table public.bank_accounts add column if not exists created_by uuid references public.profiles(id);

-- ============================================================
-- 5. CLIENTS & SUB-AGENTS
-- ============================================================
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  passport_number text,
  address text,
  destination_country text,
  state text,
  purpose text check (purpose is null or purpose in ('Visit','Student','Tourist','Work')),
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients add column if not exists purpose text;
alter table public.clients add column if not exists state text;
alter table public.clients add column if not exists destination_country text;
alter table public.clients add column if not exists active boolean not null default true;

create table if not exists public.sub_agents (
  id uuid primary key default gen_random_uuid(),
  agent_code text unique,
  full_name text not null,
  phone text,
  email text,
  company_name text,
  address text,
  commission_rate numeric(5,2) default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.sub_agents add column if not exists agent_code text;
alter table public.sub_agents add column if not exists company_name text;
alter table public.sub_agents add column if not exists commission_rate numeric(5,2) default 0;

create sequence if not exists public.sub_agent_code_seq start 1;

create or replace function public.generate_sub_agent_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.agent_code is null or new.agent_code = '' then
    new.agent_code := 'AG-' || lpad(nextval('public.sub_agent_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sub_agent_code on public.sub_agents;
create trigger trg_sub_agent_code
  before insert on public.sub_agents
  for each row execute function public.generate_sub_agent_code();

-- ============================================================
-- 6. JOURNALS (double-entry core)
-- ============================================================
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  reference text,
  description text not null,
  status text not null default 'Posted' check (status in ('Posted','Reversed','Void')),
  source_type text,
  source_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  account_id uuid not null references public.chart_of_accounts(id),
  description text,
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  created_at timestamptz not null default now(),
  check ((debit = 0 and credit > 0) or (credit = 0 and debit > 0) or (debit = 0 and credit = 0))
);

create index if not exists idx_journal_lines_entry on public.journal_lines(journal_entry_id);
create index if not exists idx_journal_lines_account on public.journal_lines(account_id);
create index if not exists idx_journal_entries_date on public.journal_entries(entry_date);
create index if not exists idx_journal_entries_source on public.journal_entries(source_type, source_id);

-- ============================================================
-- 7. INVOICES + ITEMS (with HSN/SAC) — GST default 9+9
-- ============================================================
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text unique,
  client_id uuid references public.clients(id),
  client_name_snapshot text,
  invoice_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  subtotal numeric(14,2) not null default 0,
  sgst_rate numeric(5,2) not null default 9.00,
  cgst_rate numeric(5,2) not null default 9.00,
  sgst_amount numeric(14,2) not null default 0,
  cgst_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  status text not null default 'Posted',
  notes text,
  journal_entry_id uuid references public.journal_entries(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.invoices add column if not exists sgst_rate numeric(5,2) not null default 9.00;
alter table public.invoices add column if not exists cgst_rate numeric(5,2) not null default 9.00;
alter table public.invoices add column if not exists sgst_amount numeric(14,2) not null default 0;
alter table public.invoices add column if not exists cgst_amount numeric(14,2) not null default 0;
alter table public.invoices add column if not exists discount_amount numeric(14,2) not null default 0;
alter table public.invoices add column if not exists journal_entry_id uuid;
alter table public.invoices add column if not exists notes text;

do $$ begin
  alter table public.invoices alter column sgst_rate set default 9.00;
  alter table public.invoices alter column cgst_rate set default 9.00;
exception when others then null;
end $$;

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  description text not null,
  hsn_sac text,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  rate numeric(14,2) not null default 0 check (rate >= 0),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  created_at timestamptz not null default now()
);
alter table public.invoice_items add column if not exists hsn_sac text;
alter table public.invoice_items add column if not exists quantity numeric(12,3) not null default 1;
alter table public.invoice_items add column if not exists rate numeric(14,2) not null default 0;
alter table public.invoice_items add column if not exists amount numeric(14,2) not null default 0;

create index if not exists idx_invoices_client on public.invoices(client_id);
create index if not exists idx_invoices_date on public.invoices(invoice_date);
create index if not exists idx_invoice_items_invoice on public.invoice_items(invoice_id);

-- ============================================================
-- 8. PAYMENTS
-- ============================================================
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  receipt_no text unique,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  payment_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null,
  method text,
  account_type text not null check (lower(account_type) in ('cash','bank')),
  account_id uuid not null,
  receiver_name text,
  reference text,
  notes text,
  status text not null default 'Posted',
  created_by uuid references public.profiles(id),
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now()
);
alter table public.payments add column if not exists receipt_no text;
alter table public.payments add column if not exists receiver_name text;
alter table public.payments add column if not exists notes text;
alter table public.payments add column if not exists created_by uuid references public.profiles(id);
alter table public.payments add column if not exists journal_entry_id uuid;

create index if not exists idx_payments_invoice on public.payments(invoice_id);
create index if not exists idx_payments_date on public.payments(payment_date);

-- ============================================================
-- 9. EXPENSES + CATEGORIES
-- ============================================================
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  ledger_account_id uuid references public.chart_of_accounts(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.expense_categories (name)
values
  ('Office Expenses'),
  ('Travel & Conveyance'),
  ('Marketing & Advertising'),
  ('Staff Salaries'),
  ('Rent & Utilities'),
  ('Professional Fees'),
  ('Bank Charges'),
  ('Other Expenses')
on conflict (name) do nothing;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  category text not null default 'Other Expenses',
  payee text not null,
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null,
  account_type text not null check (lower(account_type) in ('cash','bank')),
  account_id uuid not null,
  reference text,
  status text not null default 'Posted',
  created_by uuid references public.profiles(id),
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now()
);
alter table public.expenses add column if not exists category text not null default 'Other Expenses';
alter table public.expenses add column if not exists created_by uuid references public.profiles(id);
alter table public.expenses add column if not exists journal_entry_id uuid;

-- ============================================================
-- 10. TRANSFERS
-- ============================================================
create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  amount numeric(14,2) not null check (amount > 0),
  source_type text not null check (lower(source_type) in ('cash','bank')),
  source_id uuid not null,
  destination_type text not null check (lower(destination_type) in ('cash','bank')),
  destination_id uuid not null,
  reference text,
  description text,
  status text not null default 'Posted',
  created_by uuid references public.profiles(id),
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now()
);
alter table public.transfers add column if not exists created_by uuid references public.profiles(id);
alter table public.transfers add column if not exists journal_entry_id uuid;

-- ============================================================
-- 11. CREDIT NOTES
-- ============================================================
create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  credit_note_no text unique,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  credit_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null,
  sgst_amount numeric(14,2) not null default 0,
  cgst_amount numeric(14,2) not null default 0,
  status text not null default 'Posted',
  notes text,
  created_by uuid references public.profiles(id),
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_credit_notes_invoice on public.credit_notes(invoice_id);

-- ============================================================
-- 12. AUDIT / DOWNLOAD LOG
-- ============================================================
create table if not exists public.download_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  document_type text,
  record_id uuid,
  file_format text,
  status text default 'requested',
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action text,
  entity_type text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 13. PERIOD LOCK
-- ============================================================
create or replace function public.is_period_locked(p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_settings cs
    where cs.period_lock_date is not null and p_date <= cs.period_lock_date
  );
$$;

create or replace function public.assert_period_open(p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_period_locked(p_date) then
    raise exception 'Period is locked. Books are closed up to %. Cannot post or modify transactions on or before this date.',
      (select period_lock_date from public.company_settings order by created_at limit 1);
  end if;
end;
$$;

-- ============================================================
-- 14. LEDGER HELPERS
-- ============================================================
-- Server-side authorization guard for SECURITY DEFINER transaction RPCs.
-- Never rely on browser-side visibility or table RLS after entering a definer function.
create or replace function public.assert_app_permission(p_module text, p_action text default 'VIEW')
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not (public.is_admin() or public.has_permission(p_module, p_action)) then
    raise exception 'Permission denied: % / %', p_module, p_action;
  end if;
end;
$$;

create or replace function public.resolve_cash_bank_ledger(p_type text, p_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare lid uuid;
begin
  if lower(p_type) = 'cash' then
    select ledger_account_id into lid from public.cash_accounts where id = p_id;
    if lid is null then select id into lid from public.chart_of_accounts where account_name = 'Cash in Hand' limit 1; end if;
  else
    select ledger_account_id into lid from public.bank_accounts where id = p_id;
    if lid is null then select id into lid from public.chart_of_accounts where account_name = 'Bank Accounts' limit 1; end if;
  end if;
  return lid;
end;
$$;

create or replace function public.get_account_by_name(p_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.chart_of_accounts where lower(account_name) = lower(p_name) and is_active = true limit 1;
$$;

-- ============================================================
-- 15. POST BALANCED JOURNAL
-- ============================================================
create or replace function public.post_journal(
  p_entry_date date, p_description text, p_reference text,
  p_source_type text, p_source_id uuid, p_lines jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_entry_id uuid; v_line jsonb; v_debit numeric := 0; v_credit numeric := 0; v_d numeric; v_c numeric;
begin
  perform public.assert_period_open(p_entry_date);
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_d := coalesce((v_line->>'debit')::numeric, 0);
    v_c := coalesce((v_line->>'credit')::numeric, 0);
    v_debit := v_debit + v_d; v_credit := v_credit + v_c;
  end loop;
  if abs(v_debit - v_credit) > 0.01 then
    raise exception 'Journal is not balanced. Debits (%) ≠ Credits (%)', v_debit, v_credit;
  end if;
  insert into public.journal_entries (entry_date, description, reference, source_type, source_id, created_by, status)
  values (p_entry_date, p_description, p_reference, p_source_type, p_source_id, auth.uid(), 'Posted')
  returning id into v_entry_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.journal_lines (journal_entry_id, account_id, description, debit, credit)
    values (v_entry_id, (v_line->>'account_id')::uuid, v_line->>'description',
            coalesce((v_line->>'debit')::numeric, 0), coalesce((v_line->>'credit')::numeric, 0));
  end loop;
  return v_entry_id;
end;
$$;

-- ============================================================
-- 16. REVERSE JOURNAL
-- ============================================================
create or replace function public.avenix_reverse_journal(p_old_entry uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_old record; v_new_id uuid; v_line record; v_lines jsonb := '[]'::jsonb;
begin
  select * into v_old from public.journal_entries where id = p_old_entry;
  if not found then raise exception 'Journal entry not found'; end if;
  if v_old.status = 'Reversed' then raise exception 'Journal already reversed'; end if;
  perform public.assert_period_open(v_old.entry_date);
  for v_line in select * from public.journal_lines where journal_entry_id = p_old_entry loop
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_line.account_id, 'debit', v_line.credit, 'credit', v_line.debit,
      'description', 'Reversal: ' || coalesce(v_line.description, '')
    );
  end loop;
  v_new_id := public.post_journal(
    (now() at time zone 'Asia/Kolkata')::date,
    'Reversal of ' || coalesce(v_old.reference, v_old.id::text) || ' — ' || coalesce(p_reason, ''),
    'REV-' || coalesce(v_old.reference, left(v_old.id::text, 8)), 'reversal', p_old_entry, v_lines
  );
  update public.journal_entries set status = 'Reversed' where id = p_old_entry;
  return v_new_id;
end;
$$;

-- ============================================================
-- 17. CREATE INVOICE (9+9 GST + HSN)
-- ============================================================
create or replace function public.create_invoice(
  p_client_id uuid, p_invoice_date date, p_items jsonb,
  p_discount numeric default 0, p_notes text default null,
  p_sgst_rate numeric default null, p_cgst_rate numeric default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_invoice_id uuid; v_invoice_no text; v_client_name text;
  v_subtotal numeric := 0; v_sgst_rate numeric; v_cgst_rate numeric;
  v_sgst_amt numeric; v_cgst_amt numeric; v_total numeric;
  v_item jsonb; v_qty numeric; v_rate numeric; v_amt numeric;
  v_ar uuid; v_income uuid; v_out_cgst uuid; v_out_sgst uuid;
  v_lines jsonb := '[]'::jsonb; v_journal_id uuid; v_settings record;
begin
  perform public.assert_app_permission('BILLS & INVOICES','ADD');
  perform public.assert_period_open(p_invoice_date);
  select * into v_settings from public.company_settings order by created_at limit 1;
  v_sgst_rate := coalesce(p_sgst_rate, v_settings.sgst_rate, 9.00);
  v_cgst_rate := coalesce(p_cgst_rate, v_settings.cgst_rate, 9.00);
  select full_name into v_client_name from public.clients where id = p_client_id;
  if v_client_name is null then raise exception 'Client not found'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 1);
    v_rate := coalesce((v_item->>'rate')::numeric, 0);
    v_amt := round(v_qty * v_rate, 2);
    v_subtotal := v_subtotal + v_amt;
  end loop;
  v_sgst_amt := round(v_subtotal * v_sgst_rate / 100, 2);
  v_cgst_amt := round(v_subtotal * v_cgst_rate / 100, 2);
  v_total := v_subtotal + v_sgst_amt + v_cgst_amt - coalesce(p_discount, 0);
  if v_total <= 0 then raise exception 'Invoice total must be positive'; end if;
  v_invoice_no := 'INV-' || to_char((now() at time zone 'Asia/Kolkata'), 'YYYYMMDD') || '-' || lpad(floor(random()*9000+1000)::text, 4, '0');
  insert into public.invoices (
    invoice_no, client_id, client_name_snapshot, invoice_date,
    subtotal, sgst_rate, cgst_rate, sgst_amount, cgst_amount,
    discount_amount, total, status, notes, created_by
  ) values (
    v_invoice_no, p_client_id, v_client_name, p_invoice_date,
    v_subtotal, v_sgst_rate, v_cgst_rate, v_sgst_amt, v_cgst_amt,
    coalesce(p_discount, 0), v_total, 'Posted', p_notes, auth.uid()
  ) returning id into v_invoice_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 1);
    v_rate := coalesce((v_item->>'rate')::numeric, 0);
    v_amt := round(v_qty * v_rate, 2);
    insert into public.invoice_items (invoice_id, description, hsn_sac, quantity, rate, amount)
    values (v_invoice_id, v_item->>'description', v_item->>'hsn_sac', v_qty, v_rate, v_amt);
  end loop;
  v_ar := public.get_account_by_name('Accounts Receivable');
  v_income := public.get_account_by_name('Service Income');
  v_out_cgst := public.get_account_by_name('Output CGST');
  v_out_sgst := public.get_account_by_name('Output SGST');
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_ar, 'debit', v_total, 'credit', 0, 'description', 'Invoice ' || v_invoice_no),
    jsonb_build_object('account_id', v_income, 'debit', 0, 'credit', v_subtotal - coalesce(p_discount,0), 'description', 'Service income'),
    jsonb_build_object('account_id', v_out_cgst, 'debit', 0, 'credit', v_cgst_amt, 'description', 'Output CGST'),
    jsonb_build_object('account_id', v_out_sgst, 'debit', 0, 'credit', v_sgst_amt, 'description', 'Output SGST')
  );
  v_journal_id := public.post_journal(p_invoice_date, 'Invoice ' || v_invoice_no, v_invoice_no, 'invoice', v_invoice_id, v_lines);
  update public.invoices set journal_entry_id = v_journal_id where id = v_invoice_id;
  return v_invoice_id;
end;
$$;

-- ============================================================
-- 18. RECORD PAYMENT
-- ============================================================
create or replace function public.record_invoice_payment(
  p_invoice_id uuid, p_payment_date date, p_amount numeric, p_method text,
  p_destination_type text, p_destination_id uuid,
  p_receiver_name text default null, p_reference text default null, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_payment_id uuid; v_receipt_no text; v_invoice record;
  v_cash_bank uuid; v_ar uuid; v_journal_id uuid; v_lines jsonb; v_already numeric;
begin
  if not (public.is_admin() or public.has_permission('PAYMENTS & RECEIPTS','ADD') or public.has_permission('PAYMENTS & RECEIPTS','EDIT')) then
    raise exception 'Permission denied: PAYMENTS & RECEIPTS / ADD';
  end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.assert_period_open(p_payment_date);
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then raise exception 'Invoice not found'; end if;
  if v_invoice.status in ('Void','Cancelled') then raise exception 'Cannot receive payment on a voided invoice'; end if;
  select coalesce(sum(amount),0) into v_already from public.payments where invoice_id = p_invoice_id and status = 'Posted';
  if v_already + p_amount > v_invoice.total + 0.01 then
    raise exception 'Payment would exceed invoice total. Outstanding: %', v_invoice.total - v_already;
  end if;
  v_receipt_no := 'RCPT-' || to_char((now() at time zone 'Asia/Kolkata'), 'YYYYMMDD') || '-' || lpad(floor(random()*9000+1000)::text, 4, '0');
  insert into public.payments (
    receipt_no, invoice_id, payment_date, amount, payment_method, method,
    account_type, account_id, receiver_name, reference, notes, status, created_by
  ) values (
    v_receipt_no, p_invoice_id, p_payment_date, p_amount, p_method, p_method,
    p_destination_type, p_destination_id, p_receiver_name, p_reference, p_notes, 'Posted', auth.uid()
  ) returning id into v_payment_id;
  v_cash_bank := public.resolve_cash_bank_ledger(p_destination_type, p_destination_id);
  v_ar := public.get_account_by_name('Accounts Receivable');
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_cash_bank, 'debit', p_amount, 'credit', 0, 'description', 'Receipt ' || v_receipt_no),
    jsonb_build_object('account_id', v_ar, 'debit', 0, 'credit', p_amount, 'description', 'Against invoice ' || v_invoice.invoice_no)
  );
  v_journal_id := public.post_journal(p_payment_date, 'Payment receipt ' || v_receipt_no, v_receipt_no, 'payment', v_payment_id, v_lines);
  update public.payments set journal_entry_id = v_journal_id where id = v_payment_id;
  if v_already + p_amount >= v_invoice.total - 0.01 then
    update public.invoices set status = 'Paid' where id = p_invoice_id;
  else
    update public.invoices set status = 'Partially Paid' where id = p_invoice_id;
  end if;
  return v_payment_id;
end;
$$;

-- ============================================================
-- 19. RECORD EXPENSE
-- ============================================================
create or replace function public.record_expense(
  p_expense_date date, p_amount numeric, p_category text, p_payee text,
  p_description text, p_payment_method text, p_account_type text, p_account_id uuid,
  p_reference text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_expense_id uuid; v_cash_bank uuid; v_exp_acct uuid; v_journal_id uuid; v_lines jsonb;
begin
  if not (public.is_admin() or public.has_permission('EXPENSES','ADD') or public.has_permission('EXPENSES','EDIT')) then
    raise exception 'Permission denied: EXPENSES / ADD';
  end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.assert_period_open(p_expense_date);
  insert into public.expenses (
    expense_date, category, payee, description, amount,
    payment_method, account_type, account_id, reference, status, created_by
  ) values (
    p_expense_date, coalesce(p_category, 'Other Expenses'), p_payee, p_description, p_amount,
    p_payment_method, p_account_type, p_account_id, p_reference, 'Posted', auth.uid()
  ) returning id into v_expense_id;
  v_cash_bank := public.resolve_cash_bank_ledger(p_account_type, p_account_id);
  v_exp_acct := public.get_account_by_name(p_category);
  if v_exp_acct is null then v_exp_acct := public.get_account_by_name('Other Expenses'); end if;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_exp_acct, 'debit', p_amount, 'credit', 0, 'description', p_description),
    jsonb_build_object('account_id', v_cash_bank, 'debit', 0, 'credit', p_amount, 'description', 'Paid to ' || p_payee)
  );
  v_journal_id := public.post_journal(p_expense_date, 'Expense: ' || p_description, p_reference, 'expense', v_expense_id, v_lines);
  update public.expenses set journal_entry_id = v_journal_id where id = v_expense_id;
  return v_expense_id;
end;
$$;

-- ============================================================
-- 20. RECORD TRANSFER
-- ============================================================
create or replace function public.record_transfer(
  p_transfer_date date, p_amount numeric, p_source_type text, p_source_id uuid,
  p_destination_type text, p_destination_id uuid, p_reference text default null, p_description text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_transfer_id uuid; v_src uuid; v_dst uuid; v_journal_id uuid; v_lines jsonb;
begin
  perform public.assert_app_permission('TRANSFERS & DEPOSITS','ADD');
  perform public.assert_period_open(p_transfer_date);
  if p_source_type = p_destination_type and p_source_id = p_destination_id then
    raise exception 'Source and destination cannot be the same account';
  end if;
  insert into public.transfers (
    transfer_date, amount, source_type, source_id, destination_type, destination_id,
    reference, description, status, created_by
  ) values (
    p_transfer_date, p_amount, p_source_type, p_source_id, p_destination_type, p_destination_id,
    p_reference, p_description, 'Posted', auth.uid()
  ) returning id into v_transfer_id;
  v_src := public.resolve_cash_bank_ledger(p_source_type, p_source_id);
  v_dst := public.resolve_cash_bank_ledger(p_destination_type, p_destination_id);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_dst, 'debit', p_amount, 'credit', 0, 'description', coalesce(p_description, 'Transfer in')),
    jsonb_build_object('account_id', v_src, 'debit', 0, 'credit', p_amount, 'description', coalesce(p_description, 'Transfer out'))
  );
  v_journal_id := public.post_journal(p_transfer_date, coalesce(p_description, 'Fund transfer'), p_reference, 'transfer', v_transfer_id, v_lines);
  update public.transfers set journal_entry_id = v_journal_id where id = v_transfer_id;
  return v_transfer_id;
end;
$$;

-- ============================================================
-- 21. CREDIT NOTE
-- ============================================================
create or replace function public.create_credit_note(
  p_invoice_id uuid, p_credit_date date, p_amount numeric, p_reason text, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cn_id uuid; v_cn_no text; v_invoice record;
  v_sgst numeric; v_cgst numeric; v_base numeric;
  v_ar uuid; v_income uuid; v_out_cgst uuid; v_out_sgst uuid;
  v_journal_id uuid; v_lines jsonb;
begin
  perform public.assert_period_open(p_credit_date);
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then raise exception 'Invoice not found'; end if;
  v_base := round(p_amount / (1 + (v_invoice.sgst_rate + v_invoice.cgst_rate)/100), 2);
  v_sgst := round(v_base * v_invoice.sgst_rate / 100, 2);
  v_cgst := p_amount - v_base - v_sgst;
  v_cn_no := 'CN-' || to_char((now() at time zone 'Asia/Kolkata'), 'YYYYMMDD') || '-' || lpad(floor(random()*9000+1000)::text, 4, '0');
  insert into public.credit_notes (
    credit_note_no, invoice_id, credit_date, amount, reason, sgst_amount, cgst_amount, status, notes, created_by
  ) values (
    v_cn_no, p_invoice_id, p_credit_date, p_amount, p_reason, v_sgst, v_cgst, 'Posted', p_notes, auth.uid()
  ) returning id into v_cn_id;
  v_ar := public.get_account_by_name('Accounts Receivable');
  v_income := public.get_account_by_name('Service Income');
  v_out_cgst := public.get_account_by_name('Output CGST');
  v_out_sgst := public.get_account_by_name('Output SGST');
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_income, 'debit', v_base, 'credit', 0, 'description', 'Credit note ' || v_cn_no),
    jsonb_build_object('account_id', v_out_cgst, 'debit', v_cgst, 'credit', 0, 'description', 'Output CGST reversal'),
    jsonb_build_object('account_id', v_out_sgst, 'debit', v_sgst, 'credit', 0, 'description', 'Output SGST reversal'),
    jsonb_build_object('account_id', v_ar, 'debit', 0, 'credit', p_amount, 'description', 'Against invoice ' || v_invoice.invoice_no)
  );
  v_journal_id := public.post_journal(p_credit_date, 'Credit note ' || v_cn_no || ' — ' || p_reason, v_cn_no, 'credit_note', v_cn_id, v_lines);
  update public.credit_notes set journal_entry_id = v_journal_id where id = v_cn_id;
  return v_cn_id;
end;
$$;

-- ============================================================
-- 22. VOID / EDIT
-- ============================================================
create or replace function public.void_invoice_payment(p_payment_id uuid, p_reason text default 'Receipt voided by user')
returns void language plpgsql security definer set search_path = public as $$
declare v_pay record;
begin
  if not (public.is_admin() or public.has_permission('PAYMENTS & RECEIPTS','DELETE / VOID') or public.has_permission('PAYMENTS & RECEIPTS','EDIT')) then
    raise exception 'Permission denied: PAYMENTS & RECEIPTS / DELETE / VOID';
  end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if v_pay.status <> 'Posted' then raise exception 'Only posted payments can be voided'; end if;
  perform public.assert_period_open(v_pay.payment_date);
  if v_pay.journal_entry_id is not null then
    perform public.avenix_reverse_journal(v_pay.journal_entry_id, p_reason);
  end if;
  update public.payments set status = 'Void' where id = p_payment_id;
  declare v_inv record; v_received numeric;
  begin
    select * into v_inv from public.invoices where id = v_pay.invoice_id;
    select coalesce(sum(amount),0) into v_received from public.payments where invoice_id = v_pay.invoice_id and status = 'Posted';
    if v_received <= 0 then update public.invoices set status = 'Posted' where id = v_pay.invoice_id;
    elsif v_received < v_inv.total - 0.01 then update public.invoices set status = 'Partially Paid' where id = v_pay.invoice_id;
    else update public.invoices set status = 'Paid' where id = v_pay.invoice_id;
    end if;
  end;
end;
$$;

create or replace function public.void_expense(p_expense_id uuid, p_reason text default 'Voided by user')
returns void language plpgsql security definer set search_path = public as $$
declare v_exp record;
begin
  if not (public.is_admin() or public.has_permission('EXPENSES','DELETE / VOID') or public.has_permission('EXPENSES','EDIT')) then
    raise exception 'Permission denied: EXPENSES / DELETE / VOID';
  end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_exp from public.expenses where id = p_expense_id;
  if not found then raise exception 'Expense not found'; end if;
  if v_exp.status <> 'Posted' then raise exception 'Only posted expenses can be voided'; end if;
  perform public.assert_period_open(v_exp.expense_date);
  if v_exp.journal_entry_id is not null then
    perform public.avenix_reverse_journal(v_exp.journal_entry_id, p_reason);
  end if;
  update public.expenses set status = 'Void' where id = p_expense_id;
end;
$$;

create or replace function public.edit_expense(
  p_expense_id uuid, p_expense_date date, p_amount numeric, p_payee text,
  p_description text, p_payment_method text, p_account_type text, p_account_id uuid,
  p_reference text default null, p_category text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_exp record; v_new_id uuid;
begin
  perform public.assert_app_permission('EXPENSES','EDIT');
  select * into v_exp from public.expenses where id = p_expense_id;
  if not found then raise exception 'Expense not found'; end if;
  perform public.void_expense(p_expense_id, 'Edited – replaced by new entry');
  v_new_id := public.record_expense(
    p_expense_date, p_amount, coalesce(p_category, v_exp.category),
    p_payee, p_description, p_payment_method, p_account_type, p_account_id, p_reference
  );
  return v_new_id;
end;
$$;

create or replace function public.edit_invoice_payment(
  p_payment_id uuid, p_payment_date date, p_amount numeric, p_method text,
  p_destination_type text, p_destination_id uuid, p_reference text default null, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pay record; v_new_id uuid;
begin
  perform public.assert_app_permission('PAYMENTS & RECEIPTS','EDIT');
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  perform public.void_invoice_payment(p_payment_id, 'Edited – replaced by new receipt');
  v_new_id := public.record_invoice_payment(
    v_pay.invoice_id, p_payment_date, p_amount, p_method,
    p_destination_type, p_destination_id, v_pay.receiver_name, p_reference, p_notes
  );
  return v_new_id;
end;
$$;

-- ============================================================
-- 23. OPENING BALANCE
-- ============================================================
create or replace function public.create_opening_balance_journal(
  p_account_type text, p_account_id uuid, p_amount numeric, p_date date default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_ledger uuid; v_capital uuid; v_journal_id uuid; v_lines jsonb; v_name text;
begin
  perform public.assert_app_permission(case when lower(p_account_type)='cash' then 'CASH ACCOUNTS' else 'BANK ACCOUNTS' end,'ADD');
  if p_amount <= 0 then return null; end if;
  v_ledger := public.resolve_cash_bank_ledger(p_account_type, p_account_id);
  v_capital := public.get_account_by_name('Capital / Owner Equity');
  if lower(p_account_type) = 'cash' then select name into v_name from public.cash_accounts where id = p_account_id;
  else select account_label into v_name from public.bank_accounts where id = p_account_id; end if;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_ledger, 'debit', p_amount, 'credit', 0, 'description', 'Opening balance – ' || coalesce(v_name,'')),
    jsonb_build_object('account_id', v_capital, 'debit', 0, 'credit', p_amount, 'description', 'Capital introduced')
  );
  v_journal_id := public.post_journal(v_date, 'Opening balance for ' || coalesce(v_name,''), 'OB-' || left(p_account_id::text,8), 'opening', p_account_id, v_lines);
  if lower(p_account_type) = 'cash' then
    update public.cash_accounts set opening_journal_entry_id = v_journal_id where id = p_account_id;
  else
    update public.bank_accounts set opening_journal_entry_id = v_journal_id where id = p_account_id;
  end if;
  return v_journal_id;
end;
$$;

-- ============================================================
-- 24. TRIAL BALANCE
-- ============================================================
create or replace function public.get_trial_balance(p_as_of date default null)
returns table (
  account_id uuid, account_name text, account_type text,
  debit_total numeric, credit_total numeric, net_balance numeric
) language sql stable security definer set search_path = public as $$
  with lines as (
    select jl.account_id, sum(jl.debit) as debits, sum(jl.credit) as credits
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'Posted' and (p_as_of is null or je.entry_date <= p_as_of)
    group by jl.account_id
  )
  select c.id, c.account_name, c.account_type,
         coalesce(l.debits, 0), coalesce(l.credits, 0),
         case when lower(c.account_type) in ('asset','expense') then coalesce(l.debits,0) - coalesce(l.credits,0)
              else coalesce(l.credits,0) - coalesce(l.debits,0) end
  from public.chart_of_accounts c
  left join lines l on l.account_id = c.id
  where c.is_active = true
    and (public.is_admin() or public.has_permission('FINANCIAL REPORTS','VIEW') or public.has_permission('GENERAL LEDGER','VIEW'))
  order by c.account_type, c.account_name;
$$;

-- ============================================================
-- 25. DOWNLOAD LOG
-- ============================================================
create or replace function public.log_download_event(
  p_document_type text, p_record_id uuid, p_file_format text, p_status text default 'requested'
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_document_type),'') is null or length(p_document_type) > 80
     or nullif(trim(p_file_format),'') is null or length(p_file_format) > 20
     or coalesce(length(p_status),0) > 30 then
    raise exception 'Invalid download log details';
  end if;
  insert into public.download_logs (user_id, document_type, record_id, file_format, status)
  values (auth.uid(), p_document_type, p_record_id, p_file_format, p_status);
end;
$$;

-- ============================================================
-- 26. PROFILE DIRECTORY
-- ============================================================
create or replace view public.profile_directory as
  select id, display_name from public.profiles where active = true;

-- ============================================================
-- 27. INDEXES
-- ============================================================
create index if not exists idx_payments_status on public.payments(status);
create index if not exists idx_expenses_status on public.expenses(status);
create index if not exists idx_expenses_date on public.expenses(expense_date);
create index if not exists idx_transfers_date on public.transfers(transfer_date);

-- ============================================================
-- 28. RLS — permission-aware (least privilege)
-- ============================================================
-- Staff access is controlled by public.has_permission(module, action).
-- Admins (role=ADMIN and active=true) bypass via is_admin().
-- Module keys match the application NAV labels exactly.

alter table public.profiles enable row level security;
alter table public.user_permissions enable row level security;
alter table public.company_settings enable row level security;
alter table public.chart_of_accounts enable row level security;
alter table public.cash_accounts enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.clients enable row level security;
alter table public.sub_agents enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_categories enable row level security;
alter table public.transfers enable row level security;
alter table public.credit_notes enable row level security;
alter table public.download_logs enable row level security;
alter table public.audit_logs enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Drop managed policies first so this complete schema can be safely re-applied.
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_admin_all on public.profiles;
drop policy if exists perms_select on public.user_permissions;
drop policy if exists perms_admin_all on public.user_permissions;
drop policy if exists company_select on public.company_settings;
drop policy if exists company_write on public.company_settings;
drop policy if exists coa_select on public.chart_of_accounts;
drop policy if exists coa_write on public.chart_of_accounts;
drop policy if exists cash_select on public.cash_accounts;
drop policy if exists cash_write on public.cash_accounts;
drop policy if exists bank_select on public.bank_accounts;
drop policy if exists bank_write on public.bank_accounts;
drop policy if exists clients_select on public.clients;
drop policy if exists clients_write on public.clients;
drop policy if exists agents_select on public.sub_agents;
drop policy if exists agents_write on public.sub_agents;
drop policy if exists je_select on public.journal_entries;
drop policy if exists jl_select on public.journal_lines;
drop policy if exists inv_select on public.invoices;
drop policy if exists inv_write on public.invoices;
drop policy if exists items_select on public.invoice_items;
drop policy if exists items_write on public.invoice_items;
drop policy if exists pay_select on public.payments;
drop policy if exists pay_write on public.payments;
drop policy if exists exp_select on public.expenses;
drop policy if exists exp_write on public.expenses;
drop policy if exists expcat_select on public.expense_categories;
drop policy if exists trf_select on public.transfers;
drop policy if exists trf_write on public.transfers;
drop policy if exists cn_select on public.credit_notes;
drop policy if exists cn_write on public.credit_notes;
drop policy if exists dl_select on public.download_logs;
drop policy if exists dl_insert on public.download_logs;
drop policy if exists audit_select on public.audit_logs;
drop policy if exists audit_insert on public.audit_logs;

-- Profiles: self-read; admin manage all
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Permissions table
create policy perms_select on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy perms_admin_all on public.user_permissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Company settings
create policy company_select on public.company_settings for select to authenticated
  using (public.has_permission('COMPANY SETTINGS','VIEW') or public.has_permission('DASHBOARD','VIEW') or public.is_admin());
create policy company_write on public.company_settings for all to authenticated
  using (public.has_permission('COMPANY SETTINGS','EDIT') or public.is_admin())
  with check (public.has_permission('COMPANY SETTINGS','EDIT') or public.is_admin());

-- Chart of accounts (read for most accounting views)
create policy coa_select on public.chart_of_accounts for select to authenticated
  using (
    public.has_permission('GENERAL LEDGER','VIEW')
    or public.has_permission('FINANCIAL REPORTS','VIEW')
    or public.has_permission('CASH ACCOUNTS','VIEW')
    or public.has_permission('BANK ACCOUNTS','VIEW')
    or public.is_admin()
  );
create policy coa_write on public.chart_of_accounts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Cash accounts
create policy cash_select on public.cash_accounts for select to authenticated
  using (public.has_permission('CASH ACCOUNTS','VIEW') or public.has_permission('PETTY CASH','VIEW') or public.is_admin());
create policy cash_write on public.cash_accounts for all to authenticated
  using (
    public.has_permission('CASH ACCOUNTS','ADD') or public.has_permission('CASH ACCOUNTS','EDIT')
    or public.has_permission('CASH ACCOUNTS','DELETE / VOID') or public.is_admin()
  ) with check (
    public.has_permission('CASH ACCOUNTS','ADD') or public.has_permission('CASH ACCOUNTS','EDIT')
    or public.has_permission('CASH ACCOUNTS','DELETE / VOID') or public.is_admin()
  );

-- Bank accounts
create policy bank_select on public.bank_accounts for select to authenticated
  using (public.has_permission('BANK ACCOUNTS','VIEW') or public.is_admin());
create policy bank_write on public.bank_accounts for all to authenticated
  using (
    public.has_permission('BANK ACCOUNTS','ADD') or public.has_permission('BANK ACCOUNTS','EDIT')
    or public.has_permission('BANK ACCOUNTS','DELETE / VOID') or public.is_admin()
  ) with check (
    public.has_permission('BANK ACCOUNTS','ADD') or public.has_permission('BANK ACCOUNTS','EDIT')
    or public.has_permission('BANK ACCOUNTS','DELETE / VOID') or public.is_admin()
  );

-- Clients
create policy clients_select on public.clients for select to authenticated
  using (public.has_permission('CLIENTS','VIEW') or public.has_permission('CLIENT LEDGERS','VIEW') or public.has_permission('BILLS & INVOICES','VIEW') or public.is_admin());
create policy clients_write on public.clients for all to authenticated
  using (
    public.has_permission('CLIENTS','ADD') or public.has_permission('CLIENTS','EDIT')
    or public.has_permission('CLIENTS','DELETE / VOID') or public.is_admin()
  ) with check (
    public.has_permission('CLIENTS','ADD') or public.has_permission('CLIENTS','EDIT')
    or public.has_permission('CLIENTS','DELETE / VOID') or public.is_admin()
  );

-- Sub-agents
create policy agents_select on public.sub_agents for select to authenticated
  using (public.has_permission('SUB-AGENTS','VIEW') or public.has_permission('SUB-AGENT LEDGERS','VIEW') or public.is_admin());
create policy agents_write on public.sub_agents for all to authenticated
  using (
    public.has_permission('SUB-AGENTS','ADD') or public.has_permission('SUB-AGENTS','EDIT')
    or public.has_permission('SUB-AGENTS','DELETE / VOID') or public.is_admin()
  ) with check (
    public.has_permission('SUB-AGENTS','ADD') or public.has_permission('SUB-AGENTS','EDIT')
    or public.has_permission('SUB-AGENTS','DELETE / VOID') or public.is_admin()
  );

-- Journals (read via ledgers/reports)
create policy je_select on public.journal_entries for select to authenticated
  using (
    public.has_permission('GENERAL LEDGER','VIEW') or public.has_permission('FINANCIAL REPORTS','VIEW')
    or public.has_permission('CLIENT LEDGERS','VIEW') or public.has_permission('SUB-AGENT LEDGERS','VIEW')
    or public.has_permission('CASH ACCOUNTS','VIEW') or public.has_permission('BANK ACCOUNTS','VIEW')
    or public.has_permission('PETTY CASH','VIEW') or public.is_admin()
  );
create policy jl_select on public.journal_lines for select to authenticated
  using (
    public.has_permission('GENERAL LEDGER','VIEW') or public.has_permission('FINANCIAL REPORTS','VIEW')
    or public.has_permission('CLIENT LEDGERS','VIEW') or public.has_permission('SUB-AGENT LEDGERS','VIEW')
    or public.has_permission('CASH ACCOUNTS','VIEW') or public.has_permission('BANK ACCOUNTS','VIEW')
    or public.has_permission('PETTY CASH','VIEW') or public.is_admin()
  );

-- Invoices
create policy inv_select on public.invoices for select to authenticated
  using (public.has_permission('BILLS & INVOICES','VIEW') or public.has_permission('OUTSTANDING BALANCES','VIEW') or public.has_permission('CLIENT LEDGERS','VIEW') or public.is_admin());
create policy inv_write on public.invoices for all to authenticated
  using (
    public.has_permission('BILLS & INVOICES','ADD') or public.has_permission('BILLS & INVOICES','EDIT')
    or public.has_permission('BILLS & INVOICES','DELETE / VOID') or public.is_admin()
  ) with check (
    public.has_permission('BILLS & INVOICES','ADD') or public.has_permission('BILLS & INVOICES','EDIT')
    or public.has_permission('BILLS & INVOICES','DELETE / VOID') or public.is_admin()
  );
create policy items_select on public.invoice_items for select to authenticated
  using (public.has_permission('BILLS & INVOICES','VIEW') or public.is_admin());
create policy items_write on public.invoice_items for all to authenticated
  using (
    public.has_permission('BILLS & INVOICES','ADD') or public.has_permission('BILLS & INVOICES','EDIT')
    or public.has_permission('BILLS & INVOICES','DELETE / VOID') or public.is_admin()
  ) with check (
    public.has_permission('BILLS & INVOICES','ADD') or public.has_permission('BILLS & INVOICES','EDIT')
    or public.has_permission('BILLS & INVOICES','DELETE / VOID') or public.is_admin()
  );

-- Payments
create policy pay_select on public.payments for select to authenticated
  using (public.has_permission('PAYMENTS & RECEIPTS','VIEW') or public.has_permission('CLIENT LEDGERS','VIEW') or public.is_admin());
create policy pay_write on public.payments for all to authenticated
  using (
    public.has_permission('PAYMENTS & RECEIPTS','ADD') or public.has_permission('PAYMENTS & RECEIPTS','EDIT')
    or public.has_permission('PAYMENTS & RECEIPTS','DELETE / VOID') or public.is_admin()
  ) with check (
    public.has_permission('PAYMENTS & RECEIPTS','ADD') or public.has_permission('PAYMENTS & RECEIPTS','EDIT')
    or public.has_permission('PAYMENTS & RECEIPTS','DELETE / VOID') or public.is_admin()
  );

-- Expenses
create policy exp_select on public.expenses for select to authenticated
  using (public.has_permission('EXPENSES','VIEW') or public.is_admin());
create policy exp_write on public.expenses for all to authenticated
  using (
    public.has_permission('EXPENSES','ADD') or public.has_permission('EXPENSES','EDIT')
    or public.has_permission('EXPENSES','DELETE / VOID') or public.is_admin()
  ) with check (
    public.has_permission('EXPENSES','ADD') or public.has_permission('EXPENSES','EDIT')
    or public.has_permission('EXPENSES','DELETE / VOID') or public.is_admin()
  );
create policy expcat_select on public.expense_categories for select to authenticated
  using (public.has_permission('EXPENSES','VIEW') or public.is_admin());

-- Transfers
create policy trf_select on public.transfers for select to authenticated
  using (public.has_permission('TRANSFERS & DEPOSITS','VIEW') or public.is_admin());
create policy trf_write on public.transfers for all to authenticated
  using (
    public.has_permission('TRANSFERS & DEPOSITS','ADD') or public.has_permission('TRANSFERS & DEPOSITS','EDIT')
    or public.has_permission('TRANSFERS & DEPOSITS','DELETE / VOID') or public.is_admin()
  ) with check (
    public.has_permission('TRANSFERS & DEPOSITS','ADD') or public.has_permission('TRANSFERS & DEPOSITS','EDIT')
    or public.has_permission('TRANSFERS & DEPOSITS','DELETE / VOID') or public.is_admin()
  );

-- Credit notes
create policy cn_select on public.credit_notes for select to authenticated
  using (public.has_permission('BILLS & INVOICES','VIEW') or public.is_admin());
create policy cn_write on public.credit_notes for all to authenticated
  using (
    public.has_permission('BILLS & INVOICES','ADD') or public.has_permission('BILLS & INVOICES','EDIT')
    or public.has_permission('BILLS & INVOICES','DELETE / VOID') or public.is_admin()
  ) with check (
    public.has_permission('BILLS & INVOICES','ADD') or public.has_permission('BILLS & INVOICES','EDIT')
    or public.has_permission('BILLS & INVOICES','DELETE / VOID') or public.is_admin()
  );

-- Audit / download logs (admin or explicit permission)
create policy dl_select on public.download_logs for select to authenticated
  using (public.has_permission('DOWNLOADED HISTORY','VIEW') or public.is_admin());
create policy dl_insert on public.download_logs for insert to authenticated
  with check (true);
create policy audit_select on public.audit_logs for select to authenticated
  using (public.has_permission('LOGIN HISTORY','VIEW') or public.is_admin());
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (true);

-- ============================================================
-- 28b. UI / AUDIT / RECONCILIATION tables (safe create)
-- ============================================================
create table if not exists public.login_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  email text,
  event text not null default 'sign_in',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);
create table if not exists public.deleted_records (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  record_snapshot jsonb,
  deleted_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz not null default now()
);
-- Keep compatibility with older installs that used the column name `snapshot`.
alter table public.deleted_records add column if not exists record_snapshot jsonb;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='deleted_records' and column_name='snapshot'
  ) then
    execute 'update public.deleted_records set record_snapshot = coalesce(record_snapshot, snapshot) where record_snapshot is null';
  end if;
end $$;

-- Capture deleted row snapshots so the Deleted / Voided screen has real audit data.
create or replace function public.capture_deleted_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.deleted_records(table_name, record_id, record_snapshot, deleted_by, deleted_at)
  values (tg_table_name, old.id, to_jsonb(old), auth.uid(), now());
  return old;
end;
$$;

do $$
declare
  t text;
  tables_to_audit text[] := array[
    'clients','sub_agents','cash_accounts','bank_accounts','invoices','invoice_items',
    'payments','expenses','transfers','credit_notes','candidates','candidate_visits'
  ];
begin
  foreach t in array tables_to_audit loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('drop trigger if exists avenix_capture_delete on public.%I', t);
      execute format(
        'create trigger avenix_capture_delete before delete on public.%I for each row execute function public.capture_deleted_record()',
        t
      );
    end if;
  end loop;
end $$;

create table if not exists public.bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid references public.bank_accounts(id) on delete cascade,
  statement_date date,
  statement_balance numeric(14,2),
  status text not null default 'OPEN',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid references public.bank_reconciliations(id) on delete cascade,
  line_date date,
  description text,
  amount numeric(14,2),
  matched_journal_line_id uuid,
  created_at timestamptz not null default now()
);

alter table public.login_history enable row level security;
alter table public.deleted_records enable row level security;
alter table public.bank_reconciliations enable row level security;
alter table public.bank_statement_lines enable row level security;

drop policy if exists login_history_select on public.login_history;
drop policy if exists login_history_insert on public.login_history;
drop policy if exists deleted_records_select on public.deleted_records;
drop policy if exists bank_rec_all on public.bank_reconciliations;
drop policy if exists bank_stmt_all on public.bank_statement_lines;

create policy login_history_select on public.login_history for select to authenticated
  using (public.has_permission('LOGIN HISTORY','VIEW') or public.is_admin());
create policy login_history_insert on public.login_history for insert to authenticated
  with check (user_id = auth.uid() or public.is_admin());

create policy deleted_records_select on public.deleted_records for select to authenticated
  using (public.has_permission('DELETED / VOIDED','VIEW') or public.is_admin());

create policy bank_rec_all on public.bank_reconciliations for all to authenticated
  using (public.has_permission('BANK RECONCILIATION','VIEW') or public.is_admin())
  with check (public.has_permission('BANK RECONCILIATION','ADD') or public.has_permission('BANK RECONCILIATION','EDIT') or public.is_admin());
create policy bank_stmt_all on public.bank_statement_lines for all to authenticated
  using (public.has_permission('BANK RECONCILIATION','VIEW') or public.is_admin())
  with check (public.has_permission('BANK RECONCILIATION','ADD') or public.has_permission('BANK RECONCILIATION','EDIT') or public.is_admin());

-- ============================================================
-- NOTES
-- ============================================================
-- * Account codes exist only as internal/legacy columns. The website never displays them.
-- * Default GST is 9% SGST + 9% CGST. Change rates in Company Settings.
-- * Set period_lock_date in company_settings to freeze books up to that date.
-- * HSN/SAC is stored on every invoice line item.
-- * Credit notes reverse income + tax and reduce receivables.
-- * Opening balances on new cash/bank accounts create a balanced capital journal.
-- * Always test with a non-production invoice and payment before live use.
-- * Historical data is preserved; reconcile old aggregate cash/bank postings manually if needed.


-- ============================================================
-- 30. AUTO-CREATE PROFILE when a new Auth user is created
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'STAFF',
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for every existing Auth user that is missing a row
insert into public.profiles (id, email, display_name, role, active)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)),
  case
    when lower(trim(coalesce(u.email,''))) = 'mohammadaffan@avenixoverseas.com' then 'ADMIN'
    else 'STAFF'
  end,
  true
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Only the designated owner account may hold the ADMIN role.
-- Do not promote an arbitrary/oldest account if the owner has not been created yet.
update public.profiles
set role = case
      when lower(trim(coalesce(email,''))) = 'mohammadaffan@avenixoverseas.com' then 'ADMIN'
      else 'STAFF'
    end,
    updated_at = now()
where role is distinct from case
      when lower(trim(coalesce(email,''))) = 'mohammadaffan@avenixoverseas.com' then 'ADMIN'
      else 'STAFF'
    end;


-- ============================================================
-- TOKEN / CANDIDATE VISIT MANAGEMENT
-- ============================================================

-- AVENIX OVERSEAS — Candidate Visit & Token Management
-- Apply in Supabase SQL Editor after taking a database backup.
-- Token format: AVXM-YYMM-NNN. Serial starts at 210 and is GLOBAL/continuous;
-- month/year change in the prefix only. Cancelled tokens are never re-used.
-- Existing data must not contain duplicate mobile numbers (digits-only normalized).
-- Check before applying if this is an upgrade:
-- select regexp_replace(mobile_number, '\D', '', 'g') mobile_key, count(*)
-- from public.candidates where nullif(regexp_replace(coalesce(mobile_number,''), '\D', '', 'g'),'') is not null
-- group by 1 having count(*) > 1; resolve any returned duplicates first.



create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_name text not null,
  passport_number text not null,
  passport_normalized text generated always as (upper(regexp_replace(trim(passport_number), '\s+', '', 'g'))) stored,
  mobile_number text,
  mobile_normalized text generated always as (nullif(regexp_replace(coalesce(mobile_number,''), '\D', '', 'g'),'')) stored,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint candidates_passport_normalized_key unique(passport_normalized)
);
create unique index if not exists candidates_mobile_normalized_key on public.candidates(mobile_normalized) where mobile_normalized is not null;

create table if not exists public.token_sequences (
  sequence_key text primary key default 'AVXM_GLOBAL',
  next_serial bigint not null default 210 check (next_serial >= 210),
  updated_at timestamptz not null default now()
);
insert into public.token_sequences(sequence_key,next_serial)
values('AVXM_GLOBAL',210) on conflict(sequence_key) do nothing;

create table if not exists public.candidate_visits (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete restrict,
  token_number text not null unique,
  serial_number bigint not null unique,
  candidate_name text not null,
  passport_number text not null,
  mobile_number text,
  country text,
  purpose_of_visit text,
  consultant text not null,
  coordinator text not null,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','CANCELLED')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancellation_reason text
);
alter table public.candidates add column if not exists mobile_normalized text generated always as (nullif(regexp_replace(coalesce(mobile_number,''), '\D', '', 'g'),'')) stored;
alter table public.candidate_visits add column if not exists purpose_of_visit text;
alter table public.candidate_visits add column if not exists created_by_name text;
create unique index if not exists candidates_mobile_normalized_key on public.candidates(mobile_normalized) where mobile_normalized is not null;

create index if not exists candidate_visits_created_at_idx on public.candidate_visits(created_at desc);
create index if not exists candidate_visits_passport_idx on public.candidate_visits(passport_number);
create index if not exists candidate_visits_candidate_id_idx on public.candidate_visits(candidate_id);
create index if not exists candidate_visits_consultant_idx on public.candidate_visits(consultant);
create index if not exists candidate_visits_coordinator_idx on public.candidate_visits(coordinator);

create table if not exists public.token_audit_logs (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references public.candidate_visits(id) on delete set null,
  token_number text not null,
  event_type text not null,
  event_details jsonb not null default '{}'::jsonb,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

drop function if exists public.generate_candidate_token(uuid,text,text,text,text,text,text);

create or replace function public.generate_candidate_token(
  p_candidate_id uuid,
  p_candidate_name text,
  p_passport_number text,
  p_mobile_number text,
  p_country text,
  p_consultant text,
  p_coordinator text,
  p_purpose_of_visit text default null
) returns public.candidate_visits
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_candidate public.candidates;
  v_visit public.candidate_visits;
  v_serial bigint;
  v_stamp timestamptz := now();
  v_prefix text;
  v_creator_name text;
  v_passport text := upper(regexp_replace(trim(coalesce(p_passport_number,'')), '\s+', '', 'g'));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select coalesce(display_name,email) into v_creator_name from public.profiles where id=auth.uid();
  if not (public.is_admin() or public.has_permission('TOKEN MANAGEMENT','ADD')) then
    raise exception 'You do not have permission to generate tokens';
  end if;
  if nullif(trim(p_candidate_name),'') is null or nullif(v_passport,'') is null
     or nullif(trim(p_country),'') is null or nullif(trim(p_consultant),'') is null
     or nullif(trim(p_coordinator),'') is null then
    raise exception 'Candidate, passport, country, consultant and coordinator are required';
  end if;

  if p_candidate_id is not null then
    select * into v_candidate from public.candidates where id=p_candidate_id for update;
    if not found then raise exception 'Selected candidate no longer exists'; end if;
    if v_candidate.passport_normalized <> v_passport then
      raise exception 'Passport number does not match the selected candidate';
    end if;
    update public.candidates set candidate_name=trim(p_candidate_name), passport_number=trim(p_passport_number),
      mobile_number=nullif(trim(p_mobile_number),''), country=trim(p_country), updated_at=now()
      where id=p_candidate_id returning * into v_candidate;
  else
    if exists(select 1 from public.candidates where passport_normalized=v_passport) then
      raise exception 'This passport number already belongs to an existing candidate. Search and select that candidate.';
    end if;
    if nullif(regexp_replace(coalesce(p_mobile_number,''), '\D', '', 'g'),'') is not null
       and exists(select 1 from public.candidates where mobile_normalized=nullif(regexp_replace(coalesce(p_mobile_number,''), '\D', '', 'g'),'')) then
      raise exception 'This mobile number already belongs to an existing candidate. Search and select that candidate.';
    end if;
    insert into public.candidates(candidate_name,passport_number,mobile_number,country,created_by)
    values(trim(p_candidate_name),trim(p_passport_number),nullif(trim(p_mobile_number),''),trim(p_country),auth.uid())
    on conflict(passport_normalized) do nothing
    returning * into v_candidate;
    if not found then
      raise exception 'This passport number already belongs to an existing candidate. Search and select that candidate.';
    end if;
  end if;

  -- Row lock/update makes serial allocation atomic across concurrent users.
  update public.token_sequences set next_serial=next_serial+1, updated_at=now()
    where sequence_key='AVXM_GLOBAL' returning next_serial-1 into v_serial;
  if v_serial is null then raise exception 'Token sequence is not initialized'; end if;
  v_prefix := 'AVXM-' || to_char(v_stamp at time zone 'Asia/Kolkata','YYMM') || '-';

  insert into public.candidate_visits(candidate_id,token_number,serial_number,candidate_name,passport_number,mobile_number,country,purpose_of_visit,consultant,coordinator,created_by,created_by_name,created_at)
  values(v_candidate.id,v_prefix || lpad(v_serial::text,3,'0'),v_serial,v_candidate.candidate_name,v_candidate.passport_number,v_candidate.mobile_number,v_candidate.country,nullif(trim(p_purpose_of_visit),''),trim(p_consultant),trim(p_coordinator),auth.uid(),v_creator_name,v_stamp)
  returning * into v_visit;

  insert into public.token_audit_logs(visit_id,token_number,event_type,event_details,user_id)
  values(v_visit.id,v_visit.token_number,'TOKEN_GENERATED',jsonb_build_object('candidate_id',v_candidate.id,'serial_number',v_serial),auth.uid());
  return v_visit;
end;
$$;

alter table public.candidates enable row level security;
alter table public.candidate_visits enable row level security;
alter table public.token_sequences enable row level security;
alter table public.token_audit_logs enable row level security;

drop policy if exists token_candidates_select on public.candidates;
create policy token_candidates_select on public.candidates for select to authenticated
  using (public.is_admin() or public.has_permission('TOKEN MANAGEMENT','VIEW'));
drop policy if exists token_visits_select on public.candidate_visits;
create policy token_visits_select on public.candidate_visits for select to authenticated
  using (public.is_admin() or public.has_permission('TOKEN MANAGEMENT','VIEW'));
drop policy if exists token_audit_select on public.token_audit_logs;
create policy token_audit_select on public.token_audit_logs for select to authenticated
  using (public.is_admin() or public.has_permission('TOKEN MANAGEMENT','VIEW'));
-- Sequence is intentionally inaccessible to browser clients; only the SECURITY DEFINER RPC can update it.

grant select on public.candidates, public.candidate_visits, public.token_audit_logs to authenticated;
revoke all on public.token_sequences from anon, authenticated;
revoke all on function public.generate_candidate_token(uuid,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.generate_candidate_token(uuid,text,text,text,text,text,text,text) to authenticated;

-- ============================================================
-- PROFILE AVATARS — STORAGE (private bucket "avatars")
-- ============================================================
insert into storage.buckets (id, name, public)
select 'avatars', 'avatars', false
where not exists (select 1 from storage.buckets where id = 'avatars');

drop policy if exists avatars_select_own on storage.objects;
drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;

create policy avatars_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );

create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );

create policy avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  )
  with check (
    bucket_id = 'avatars'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );

create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );


-- Ensure login_history has useful columns
alter table public.login_history add column if not exists user_email text;
alter table public.login_history add column if not exists event_type text default 'sign_in';
alter table public.login_history add column if not exists outcome text default 'success';

-- Expose only the minimum directory fields; do not bypass profile RLS for emails,
-- roles, active status, or private avatar paths.
create or replace view public.profile_directory as
  select id, display_name
  from public.profiles
  where active = true;

grant select on public.profile_directory to authenticated;



-- ============================================================
-- FUNCTION EXECUTION PRIVILEGES (least privilege)
-- PostgreSQL grants EXECUTE to PUBLIC by default for new functions.
-- Revoke that default exposure and expose only authenticated app RPCs.
-- ============================================================
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_permission(text,text) to authenticated;
grant execute on function public.create_invoice(uuid,date,jsonb,numeric,text,numeric,numeric) to authenticated;
grant execute on function public.record_invoice_payment(uuid,date,numeric,text,text,uuid,text,text,text) to authenticated;
grant execute on function public.record_expense(date,numeric,text,text,text,text,text,uuid,text) to authenticated;
grant execute on function public.record_transfer(date,numeric,text,uuid,text,uuid,text,text) to authenticated;
grant execute on function public.void_invoice_payment(uuid,text) to authenticated;
grant execute on function public.void_expense(uuid,text) to authenticated;
grant execute on function public.edit_expense(uuid,date,numeric,text,text,text,text,uuid,text,text) to authenticated;
grant execute on function public.edit_invoice_payment(uuid,date,numeric,text,text,uuid,text,text) to authenticated;
grant execute on function public.create_opening_balance_journal(text,uuid,numeric,date) to authenticated;
grant execute on function public.get_trial_balance(date) to authenticated;
grant execute on function public.log_download_event(text,uuid,text,text) to authenticated;
grant execute on function public.generate_candidate_token(uuid,text,text,text,text,text,text,text) to authenticated;


/*
  ============================================================================
  AVENIX OVERSEAS — PAYROLL CORE SCHEMA
  ============================================================================
  File: supabase/sql/01_avenix_core_and_payroll.sql
  Run AFTER the existing schema.sql (or ensure base tables exist).
  Idempotent where possible. Does not drop existing data.

  Includes:
  - Employees master
  - Salary structures & components
  - Configurable statutory rates (PF, ESI, PT, TDS rules)
  - Attendance / leave for payroll period
  - Monthly payroll batches & lines
  - Payslip records
  - Payroll approvals & audit
  - Indexes, RLS, helper functions

  Roles: Only SUPER ADMIN (is_admin()) has full payroll access.
  Sensitive fields (bank, PAN, UAN, salary) protected by RLS.
  ============================================================================
*/

-- Ensure required extensions
create extension if not exists pgcrypto;

-- ============================================================
-- 1. CONFIGURABLE STATUTORY / PAYROLL SETTINGS
-- ============================================================
create table if not exists public.payroll_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique,
  setting_value jsonb not null default '{}'::jsonb,
  effective_from date not null default current_date,
  effective_to date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed default Indian statutory placeholders (configurable; not hard-coded rates in app logic)
insert into public.payroll_settings (setting_key, setting_value, description)
values
  ('pf_employee_rate', '{"rate": 0.12, "wage_ceiling": 15000, "applicable": true}'::jsonb, 'Employee PF contribution rate and wage ceiling'),
  ('pf_employer_rate', '{"rate": 0.12, "wage_ceiling": 15000, "applicable": true}'::jsonb, 'Employer PF contribution (informational for CTC)'),
  ('esi_employee_rate', '{"rate": 0.0075, "wage_ceiling": 21000, "applicable": true}'::jsonb, 'Employee ESI rate and wage ceiling'),
  ('esi_employer_rate', '{"rate": 0.0325, "wage_ceiling": 21000, "applicable": true}'::jsonb, 'Employer ESI rate'),
  ('professional_tax', '{"slabs": [{"upto": 15000, "amount": 0}, {"upto": 25000, "amount": 150}, {"above": 25000, "amount": 200}], "state": "Delhi"}'::jsonb, 'Professional Tax slabs (state configurable)'),
  ('tds_enabled', '{"enabled": true, "default_regime": "new"}'::jsonb, 'TDS calculation enabled flag'),
  ('payroll_cycle', '{"day_of_month": 1, "pay_period": "monthly"}'::jsonb, 'Default payroll cycle')
on conflict (setting_key) do nothing;

-- ============================================================
-- 2. EMPLOYEES
-- ============================================================
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  full_name text not null,
  email text,
  mobile text,
  address text,
  department text,
  designation text,
  joining_date date,
  employment_status text not null default 'ACTIVE'
    check (upper(employment_status) in ('ACTIVE','INACTIVE','RESIGNED','TERMINATED','ON_LEAVE')),
  date_of_birth date,
  gender text,
  bank_account_number text,          -- sensitive
  bank_ifsc text,                    -- sensitive
  bank_name text,
  pan_number text,                   -- sensitive
  uan_number text,                   -- sensitive (EPFO)
  esic_number text,                  -- sensitive
  aadhaar_last4 text,                -- minimal
  salary_structure_id uuid,          -- FK added later
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create index if not exists idx_employees_status on public.employees(employment_status) where not is_deleted;
create index if not exists idx_employees_department on public.employees(department) where not is_deleted;
create index if not exists idx_employees_code on public.employees(employee_code);

-- Employment history (simple audit of status/department changes)
create table if not exists public.employee_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  event_type text not null, -- JOINED, STATUS_CHANGE, SALARY_CHANGE, DEPARTMENT_CHANGE, etc.
  old_value jsonb,
  new_value jsonb,
  effective_date date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3. SALARY STRUCTURES & COMPONENTS
-- ============================================================
create table if not exists public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_template boolean not null default false,
  employee_id uuid references public.employees(id) on delete set null, -- null = template
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Back-fill FK on employees
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'employees_salary_structure_id_fkey'
  ) then
    alter table public.employees
      add constraint employees_salary_structure_id_fkey
      foreign key (salary_structure_id) references public.salary_structures(id) on delete set null;
  end if;
exception when others then null;
end $$;

create table if not exists public.salary_components (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.salary_structures(id) on delete cascade,
  component_type text not null check (upper(component_type) in ('EARNING','DEDUCTION')),
  component_code text not null, -- BASIC, HRA, TA, MA, SA, BONUS, INCENTIVE, OTHER_EARNING,
                                -- PF, ESI, TDS, PT, ADVANCE, LOAN, UNPAID_LEAVE, OTHER_DEDUCTION
  component_name text not null,
  calculation_type text not null default 'FIXED'
    check (upper(calculation_type) in ('FIXED','PERCENT_OF_BASIC','PERCENT_OF_GROSS','FORMULA','ATTENDANCE')),
  amount numeric(14,2) not null default 0,
  percentage numeric(8,4),
  is_taxable boolean not null default true,
  is_statutory boolean not null default false,
  display_order int not null default 0,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_salary_components_structure on public.salary_components(structure_id);

-- ============================================================
-- 4. ATTENDANCE / LEAVE FOR PAYROLL
-- ============================================================
create table if not exists public.payroll_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  payroll_month date not null, -- first day of month
  total_days int not null default 30,
  paid_days numeric(5,2) not null default 30,
  unpaid_days numeric(5,2) not null default 0,
  leave_days numeric(5,2) not null default 0,
  overtime_hours numeric(6,2) default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, payroll_month)
);

-- ============================================================
-- 5. MONTHLY PAYROLL BATCHES & LINES
-- ============================================================
create table if not exists public.payroll_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null unique,
  payroll_month date not null, -- first day of month
  status text not null default 'DRAFT'
    check (upper(status) in ('DRAFT','CALCULATED','PENDING_APPROVAL','APPROVED','REJECTED','PAID','CANCELLED')),
  total_employees int not null default 0,
  total_gross numeric(16,2) not null default 0,
  total_deductions numeric(16,2) not null default 0,
  total_net numeric(16,2) not null default 0,
  prepared_by uuid references public.profiles(id),
  prepared_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejected_by uuid references public.profiles(id),
  rejected_at timestamptz,
  rejection_reason text,
  payment_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_payroll_batches_month_active
  on public.payroll_batches(payroll_month)
  where upper(status) not in ('CANCELLED','REJECTED');

create table if not exists public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payroll_batches(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  employee_code text,
  employee_name text,
  department text,
  designation text,
  paid_days numeric(5,2) not null default 0,
  unpaid_days numeric(5,2) not null default 0,
  basic_salary numeric(14,2) not null default 0,
  hra numeric(14,2) not null default 0,
  allowances numeric(14,2) not null default 0,
  bonuses numeric(14,2) not null default 0,
  incentives numeric(14,2) not null default 0,
  other_earnings numeric(14,2) not null default 0,
  gross_salary numeric(14,2) not null default 0,
  pf_employee numeric(14,2) not null default 0,
  esi_employee numeric(14,2) not null default 0,
  tds numeric(14,2) not null default 0,
  professional_tax numeric(14,2) not null default 0,
  salary_advance numeric(14,2) not null default 0,
  loan_deduction numeric(14,2) not null default 0,
  unpaid_leave_deduction numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_salary numeric(14,2) not null default 0,
  payment_status text not null default 'PENDING'
    check (upper(payment_status) in ('PENDING','PAID','HOLD','FAILED')),
  payment_reference text,
  payment_date date,
  calculation_snapshot jsonb, -- full breakdown for audit
  created_at timestamptz not null default now(),
  unique (batch_id, employee_id)
);

create index if not exists idx_payroll_lines_batch on public.payroll_lines(batch_id);
create index if not exists idx_payroll_lines_employee on public.payroll_lines(employee_id);

-- ============================================================
-- 6. PAYSLIPS
-- ============================================================
create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_line_id uuid not null references public.payroll_lines(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  batch_id uuid not null references public.payroll_batches(id),
  payslip_number text not null unique,
  payroll_month date not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id),
  pdf_storage_path text, -- optional Supabase Storage path
  email_sent_at timestamptz,
  meta jsonb default '{}'::jsonb
);

create index if not exists idx_payslips_employee on public.payslips(employee_id);
create index if not exists idx_payslips_month on public.payslips(payroll_month);

-- ============================================================
-- 7. PAYROLL APPROVAL / AUDIT TRAIL
-- ============================================================
create table if not exists public.payroll_audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null, -- BATCH, LINE, EMPLOYEE, STRUCTURE, SETTING
  entity_id uuid,
  action text not null, -- CREATE, UPDATE, CALCULATE, SUBMIT, APPROVE, REJECT, PAY, ADJUST, REVERSE
  old_data jsonb,
  new_data jsonb,
  performed_by uuid references public.profiles(id),
  performed_at timestamptz not null default now(),
  ip_address text,
  notes text
);

create index if not exists idx_payroll_audit_entity on public.payroll_audit_log(entity_type, entity_id);

-- ============================================================
-- 8. HELPER FUNCTIONS
-- ============================================================

-- Safe admin check reuse (assumes public.is_admin() exists from core schema)
-- If not present, create a minimal version
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid()
      and upper(trim(coalesce(p.role::text, ''))) = 'ADMIN'
      and p.active = true
      and lower(trim(coalesce(u.email, ''))) = 'mohammadaffan@avenixoverseas.com'
      and lower(trim(coalesce(p.email, ''))) = lower(trim(u.email))
  );
$$;

-- Current user can manage payroll?
create or replace function public.can_manage_payroll()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin();
$$;

-- Get setting value helper
create or replace function public.get_payroll_setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select setting_value
  from public.payroll_settings
  where setting_key = p_key
    and (effective_to is null or effective_to >= current_date)
  order by effective_from desc
  limit 1;
$$;

-- Simple net calculation helper (called from app or more complex RPC)
create or replace function public.calculate_line_net(
  p_gross numeric,
  p_deductions numeric
) returns numeric
language sql
immutable
as $$
  select greatest(0, coalesce(p_gross,0) - coalesce(p_deductions,0));
$$;

-- Prevent duplicate active payroll for same month+employee
create or replace function public.prevent_duplicate_payroll_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.payroll_lines pl
    join public.payroll_batches pb on pb.id = pl.batch_id
    where pl.employee_id = NEW.employee_id
      and pb.payroll_month = (select payroll_month from public.payroll_batches where id = NEW.batch_id)
      and upper(pb.status) not in ('CANCELLED','REJECTED')
      and pl.id is distinct from NEW.id
  ) then
    raise exception 'Duplicate payroll line for employee in the same payroll month is not allowed';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_prevent_duplicate_payroll_line on public.payroll_lines;
create trigger trg_prevent_duplicate_payroll_line
  before insert or update on public.payroll_lines
  for each row execute function public.prevent_duplicate_payroll_line();

-- Protect approved batches from casual modification
create or replace function public.protect_approved_payroll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and upper(OLD.status) in ('APPROVED','PAID') then
    if upper(NEW.status) not in ('APPROVED','PAID','CANCELLED') and not public.is_admin() then
      raise exception 'Approved or paid payroll batches cannot be modified without proper adjustment process';
    end if;
  end if;
  if TG_OP = 'DELETE' and upper(OLD.status) in ('APPROVED','PAID') then
    raise exception 'Approved or paid payroll batches cannot be deleted';
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_protect_approved_payroll on public.payroll_batches;
create trigger trg_protect_approved_payroll
  before update or delete on public.payroll_batches
  for each row execute function public.protect_approved_payroll();

-- ============================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================
alter table public.payroll_settings enable row level security;
alter table public.employees enable row level security;
alter table public.employee_history enable row level security;
alter table public.salary_structures enable row level security;
alter table public.salary_components enable row level security;
alter table public.payroll_attendance enable row level security;
alter table public.payroll_batches enable row level security;
alter table public.payroll_lines enable row level security;
alter table public.payslips enable row level security;
alter table public.payroll_audit_log enable row level security;

-- Policies: only admin for write; authenticated can read non-sensitive if needed (but payroll is admin-only)
do $$ begin
  -- Settings
  drop policy if exists payroll_settings_admin_all on public.payroll_settings;
  create policy payroll_settings_admin_all on public.payroll_settings
    for all using (public.is_admin()) with check (public.is_admin());

  -- Employees
  drop policy if exists employees_admin_all on public.employees;
  create policy employees_admin_all on public.employees
    for all using (public.is_admin()) with check (public.is_admin());

  -- Employee history
  drop policy if exists employee_history_admin_all on public.employee_history;
  create policy employee_history_admin_all on public.employee_history
    for all using (public.is_admin()) with check (public.is_admin());

  -- Salary structures
  drop policy if exists salary_structures_admin_all on public.salary_structures;
  create policy salary_structures_admin_all on public.salary_structures
    for all using (public.is_admin()) with check (public.is_admin());

  -- Components
  drop policy if exists salary_components_admin_all on public.salary_components;
  create policy salary_components_admin_all on public.salary_components
    for all using (public.is_admin()) with check (public.is_admin());

  -- Attendance
  drop policy if exists payroll_attendance_admin_all on public.payroll_attendance;
  create policy payroll_attendance_admin_all on public.payroll_attendance
    for all using (public.is_admin()) with check (public.is_admin());

  -- Batches
  drop policy if exists payroll_batches_admin_all on public.payroll_batches;
  create policy payroll_batches_admin_all on public.payroll_batches
    for all using (public.is_admin()) with check (public.is_admin());

  -- Lines
  drop policy if exists payroll_lines_admin_all on public.payroll_lines;
  create policy payroll_lines_admin_all on public.payroll_lines
    for all using (public.is_admin()) with check (public.is_admin());

  -- Payslips
  drop policy if exists payslips_admin_all on public.payslips;
  create policy payslips_admin_all on public.payslips
    for all using (public.is_admin()) with check (public.is_admin());

  -- Audit
  drop policy if exists payroll_audit_admin_all on public.payroll_audit_log;
  create policy payroll_audit_admin_all on public.payroll_audit_log
    for all using (public.is_admin()) with check (public.is_admin());
exception when others then
  raise notice 'RLS policy creation note: %', SQLERRM;
end $$;

-- Grant usage to authenticated (RLS still applies)
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ============================================================
-- 10. COMMENTS
-- ============================================================
comment on table public.employees is 'Employee master for Avenix payroll. Sensitive fields protected by RLS (admin only).';
comment on table public.payroll_batches is 'Monthly payroll processing batches with approval workflow (payroll-only).';
comment on table public.payroll_lines is 'Per-employee calculated payroll lines inside a batch.';
comment on table public.payslips is 'Generated payslip metadata; PDF may be stored in private Storage bucket.';

-- End of 01_avenix_core_and_payroll.sql


/*
  ============================================================================
  AVENIX OVERSEAS — REPORTS, BACKUP METADATA & AUTOMATION SUPPORT
  ============================================================================
  File: supabase/sql/02_avenix_reports_and_automation.sql
  Run after 01_avenix_core_and_payroll.sql (and base schema.sql).

  Includes:
  - Backup metadata table + helpers
  - Reporting support views / functions for payroll & financial summaries
  - Notes on daily automated backups (pg_cron / Supabase Dashboard / Edge Functions)
  - Grants and security

  IMPORTANT:
  - True external database backups cannot be performed by a pure SQL query alone.
  - Use Supabase Dashboard → Database → Backups, or Point-in-Time Recovery (PITR)
    on a paid plan, or a scheduled Edge Function + Storage export.
  - pg_cron is available only on certain Supabase plans / self-hosted.
  ============================================================================
*/

-- ============================================================
-- 1. BACKUP METADATA
-- ============================================================
create table if not exists public.backup_metadata (
  id uuid primary key default gen_random_uuid(),
  backup_type text not null default 'MANUAL' check (upper(backup_type) in ('MANUAL','SCHEDULED','PRE_RESTORE','EXPORT')),
  status text not null default 'PENDING'
    check (upper(status) in ('PENDING','RUNNING','SUCCESS','FAILED','PARTIAL')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  file_size_bytes bigint,
  storage_path text,          -- path inside Supabase Storage (private bucket preferred)
  checksum text,
  triggered_by uuid references public.profiles(id),
  error_message text,
  notes text,
  retention_until date,
  meta jsonb default '{}'::jsonb
);

create index if not exists idx_backup_metadata_started on public.backup_metadata(started_at desc);
create index if not exists idx_backup_metadata_status on public.backup_metadata(status);

alter table public.backup_metadata enable row level security;

do $$ begin
  drop policy if exists backup_metadata_admin_all on public.backup_metadata;
  create policy backup_metadata_admin_all on public.backup_metadata
    for all using (public.is_admin()) with check (public.is_admin());
exception when others then null;
end $$;

-- Log a backup attempt
create or replace function public.log_backup_start(
  p_type text default 'MANUAL',
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can manage backups';
  end if;
  insert into public.backup_metadata (backup_type, status, triggered_by, notes)
  values (upper(coalesce(p_type,'MANUAL')), 'RUNNING', auth.uid(), p_notes)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.log_backup_complete(
  p_id uuid,
  p_success boolean,
  p_file_size bigint default null,
  p_storage_path text default null,
  p_error text default null,
  p_checksum text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can manage backups';
  end if;
  update public.backup_metadata
  set status = case when p_success then 'SUCCESS' else 'FAILED' end,
      completed_at = now(),
      file_size_bytes = p_file_size,
      storage_path = p_storage_path,
      error_message = p_error,
      checksum = p_checksum
  where id = p_id;
end;
$$;

-- ============================================================
-- 2. PAYROLL REPORTING HELPERS
-- ============================================================

-- Monthly payroll summary for a given month
create or replace function public.payroll_monthly_summary(p_month date)
returns table (
  batch_id uuid,
  batch_code text,
  status text,
  total_employees int,
  total_gross numeric,
  total_deductions numeric,
  total_net numeric,
  approved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.batch_code,
    b.status,
    b.total_employees,
    b.total_gross,
    b.total_deductions,
    b.total_net,
    b.approved_at
  from public.payroll_batches b
  where date_trunc('month', b.payroll_month) = date_trunc('month', p_month)
    and public.is_admin()
  order by b.created_at desc;
$$;

-- Department-wise salary distribution for a month
create or replace function public.payroll_department_summary(p_month date)
returns table (
  department text,
  employee_count bigint,
  total_gross numeric,
  total_net numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(pl.department, 'Unassigned') as department,
    count(*)::bigint as employee_count,
    sum(pl.gross_salary) as total_gross,
    sum(pl.net_salary) as total_net
  from public.payroll_lines pl
  join public.payroll_batches pb on pb.id = pl.batch_id
  where date_trunc('month', pb.payroll_month) = date_trunc('month', p_month)
    and upper(pb.status) in ('APPROVED','PAID')
    and public.is_admin()
  group by 1
  order by sum(pl.net_salary) desc;
$$;

-- Employee salary register (date range)
create or replace function public.employee_salary_register(
  p_from date,
  p_to date
)
returns table (
  employee_code text,
  employee_name text,
  department text,
  designation text,
  payroll_month date,
  gross_salary numeric,
  total_deductions numeric,
  net_salary numeric,
  payment_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pl.employee_code,
    pl.employee_name,
    pl.department,
    pl.designation,
    pb.payroll_month,
    pl.gross_salary,
    pl.total_deductions,
    pl.net_salary,
    pl.payment_status
  from public.payroll_lines pl
  join public.payroll_batches pb on pb.id = pl.batch_id
  where pb.payroll_month between p_from and p_to
    and upper(pb.status) in ('APPROVED','PAID','CALCULATED','PENDING_APPROVAL')
    and public.is_admin()
  order by pb.payroll_month desc, pl.employee_name;
$$;

-- ============================================================
-- 3. FINANCIAL REPORT SUPPORT (lightweight helpers)
--    Full P&L / Balance Sheet still computed primarily in frontend
--    from journal_entries / journal_lines for accuracy with existing schema.
-- ============================================================

-- Simple trial balance snapshot helper (respects existing journal structure)
create or replace function public.trial_balance_summary(
  p_as_of date default current_date
)
returns table (
  account_code text,
  account_name text,
  account_type text,
  debit_total numeric,
  credit_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coa.account_code as account_code,
    coa.account_name as account_name,
    coa.account_type,
    coalesce(sum(case when jl.debit > 0 then jl.debit else 0 end), 0) as debit_total,
    coalesce(sum(case when jl.credit > 0 then jl.credit else 0 end), 0) as credit_total
  from public.chart_of_accounts coa
  left join public.journal_lines jl on jl.account_id = coa.id
  left join public.journal_entries je on je.id = jl.journal_entry_id
    and je.entry_date <= p_as_of
    and upper(coalesce(je.status,'')) not in ('VOID','DELETED','CANCELLED')
  where public.is_admin() or public.has_permission('FINANCIAL REPORTS', 'VIEW')
  group by coa.account_code, coa.account_name, coa.account_type
  order by coa.account_code;
$$;

-- ============================================================
-- 4. AUTOMATION NOTES (comments only — no false claims)
-- ============================================================
comment on table public.backup_metadata is
  'Metadata for application-level backup tracking. True DB-level daily backups must be configured in Supabase Dashboard (Backups / PITR) or via scheduled Edge Function + Storage. pg_cron may be used where the plan supports it.';

-- Optional: example pg_cron job registration (commented — enable only if pg_cron available)
/*
-- Requires: create extension if not exists pg_cron;
-- Schedule a daily reminder / metadata row (actual dump still needs external process)
select cron.schedule(
  'avenix-daily-backup-marker',
  '0 2 * * *',  -- 02:00 UTC daily
  $$select public.log_backup_start('SCHEDULED', 'Daily automated marker — complete via Edge Function or Dashboard');$$
);
*/

-- ============================================================
-- 5. GRANTS
-- ============================================================
grant execute on function public.log_backup_start(text, text) to authenticated;
grant execute on function public.log_backup_complete(uuid, boolean, bigint, text, text, text) to authenticated;
grant execute on function public.payroll_monthly_summary(date) to authenticated;
grant execute on function public.payroll_department_summary(date) to authenticated;
grant execute on function public.employee_salary_register(date, date) to authenticated;
grant execute on function public.trial_balance_summary(date) to authenticated;

-- End of 02_avenix_reports_and_automation.sql



-- ============================================================================
-- AVENIX CONSOLIDATED REPAIR & PAYROLL POSTING LAYER
-- Apply after the base objects in this same file. All changes are idempotent.
-- ============================================================================

-- Repair legacy salary_components rows and future inserts.
alter table public.salary_components
  add column if not exists is_statutory boolean;
update public.salary_components set is_statutory = false where is_statutory is null;
alter table public.salary_components alter column is_statutory set default false;
alter table public.salary_components alter column is_statutory set not null;

-- Keep one payslip per payroll line. Preserve the most recently generated row
-- when cleaning legacy duplicates before adding the uniqueness guarantee.
with ranked_payslips as (
  select id, row_number() over (
    partition by payroll_line_id
    order by generated_at desc nulls last, id desc
  ) as rn
  from public.payslips
)
delete from public.payslips p
using ranked_payslips r
where p.id = r.id and r.rn > 1;

create unique index if not exists uq_payslips_payroll_line
  on public.payslips(payroll_line_id);

-- Global chronological event register. event_number is one uninterrupted
-- sequence across every public business table instrumented below.
create sequence if not exists public.global_activity_number_seq start with 1 increment by 1;

create table if not exists public.global_activity_log (
  id uuid primary key default gen_random_uuid(),
  event_number bigint not null unique default nextval('public.global_activity_number_seq'),
  event_at timestamptz not null default clock_timestamp(),
  table_name text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  record_id text,
  actor_id uuid,
  summary jsonb not null default '{}'::jsonb
);
create index if not exists idx_global_activity_order
  on public.global_activity_log(event_number asc);
alter table public.global_activity_log enable row level security;
drop policy if exists global_activity_admin_read on public.global_activity_log;
create policy global_activity_admin_read on public.global_activity_log
  for select to authenticated using (public.is_admin());
grant select on public.global_activity_log to authenticated;

create or replace function public.capture_global_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_id text;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  v_id := coalesce(v_row->>'id', v_row->>'uuid', v_row->>'employee_code',
                   v_row->>'invoice_no', v_row->>'receipt_no', v_row->>'batch_code');
  insert into public.global_activity_log(table_name, action, record_id, actor_id, summary)
  values (
    tg_table_name, tg_op, v_id, auth.uid(),
    jsonb_build_object('created_at', v_row->>'created_at',
                       'updated_at', v_row->>'updated_at')
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Attach exactly one audit trigger to each public base table except internal
-- event log; trigger creation is deterministic and safe to rerun.
do $$
declare r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not in ('global_activity_log')
  loop
    execute format('drop trigger if exists trg_global_activity on public.%I', r.tablename);
    execute format(
      'create trigger trg_global_activity after insert or update or delete on public.%I '
      'for each row execute function public.capture_global_activity()', r.tablename
    );
  end loop;
end $$;

revoke all on function public.capture_global_activity() from public, anon;

-- Ensure the canonical salary expense account exists.
insert into public.chart_of_accounts(account_code, account_name, account_type, is_system)
values ('5300', 'Staff Salaries', 'expense', true)
on conflict (account_name) do nothing;

-- Idempotent, atomic payroll posting. This posts the bank debit in the ERP
-- double-entry ledger; it does NOT initiate an external bank transfer.
create unique index if not exists uq_journal_payroll_source
  on public.journal_entries(source_type, source_id)
  where source_type = 'PAYROLL_PAYMENT';

create or replace function public.process_payroll_payment(
  p_batch_id uuid,
  p_bank_account_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.payroll_batches%rowtype;
  v_bank public.bank_accounts%rowtype;
  v_bank_ledger uuid;
  v_salary_ledger uuid;
  v_entry_id uuid;
  v_ref text;
  v_count integer;
  v_total numeric(16,2);
  v_now timestamptz := clock_timestamp();
  v_month text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only an authenticated administrator can process payroll payments';
  end if;

  select * into v_batch
  from public.payroll_batches
  where id = p_batch_id
  for update;

  if not found then raise exception 'Payroll batch not found'; end if;
  if upper(v_batch.status) <> 'APPROVED' then
    raise exception 'Only an APPROVED payroll batch can be paid (current status: %)', v_batch.status;
  end if;

  select * into v_bank
  from public.bank_accounts
  where id = p_bank_account_id and active = true
  for update;
  if not found then raise exception 'Active bank account not found'; end if;

  v_bank_ledger := v_bank.ledger_account_id;
  -- Self-heal legacy bank records: create a dedicated asset ledger and persist
  -- the link before posting. The unique account name includes the bank UUID.
  if v_bank_ledger is null then
    insert into public.chart_of_accounts(account_name, account_type, is_active, is_system)
    values (
      'Bank - ' || coalesce(nullif(trim(v_bank.account_label),''), nullif(trim(v_bank.bank_name),''), 'Account')
        || ' (' || left(v_bank.id::text,8) || ')',
      'asset', true, false
    )
    on conflict (account_name) do update set is_active = true
    returning id into v_bank_ledger;

    update public.bank_accounts
      set ledger_account_id = v_bank_ledger
      where id = p_bank_account_id and ledger_account_id is null;

    select ledger_account_id into v_bank_ledger
      from public.bank_accounts where id = p_bank_account_id;
  end if;

  if v_bank_ledger is null then
    raise exception 'Unable to create or link the ledger account for the selected bank. Open Bank Accounts and save the account again.';
  end if;

  select id into v_salary_ledger
  from public.chart_of_accounts
  where account_code = '5300' and is_active = true
  limit 1;
  if v_salary_ledger is null then
    insert into public.chart_of_accounts(account_code, account_name, account_type, is_system)
    values ('5300', 'Staff Salaries', 'expense', true)
    returning id into v_salary_ledger;
  end if;

  select count(*), coalesce(sum(net_salary),0)
    into v_count, v_total
  from public.payroll_lines
  where batch_id = p_batch_id and upper(payment_status) = 'PENDING';

  if v_count = 0 or v_total <= 0 then
    raise exception 'No payable payroll lines found or net payroll is zero';
  end if;

  if exists (
    select 1 from public.payroll_lines
    where batch_id = p_batch_id and net_salary < 0
  ) then raise exception 'Payroll contains a negative net salary; correct the salary structure'; end if;

  v_month := to_char(v_batch.payroll_month, 'YYYYMM');
  v_ref := 'PAY-' || v_month || '-' || upper(substr(replace(p_batch_id::text,'-',''),1,8));

  if exists (select 1 from public.journal_entries where source_type='PAYROLL_PAYMENT' and source_id=p_batch_id) then
    raise exception 'This payroll batch has already been posted. Duplicate payment is blocked.';
  end if;

  insert into public.journal_entries(
    entry_date, reference, description, status, source_type, source_id, created_by
  ) values (
    (v_now at time zone 'Asia/Kolkata')::date,
    v_ref,
    'Monthly payroll payment — ' || to_char(v_batch.payroll_month, 'Month YYYY'),
    'Posted', 'PAYROLL_PAYMENT', p_batch_id, auth.uid()
  ) returning id into v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, description, debit, credit)
  values
    (v_entry_id, v_salary_ledger, 'Staff salary expense', v_total, 0),
    (v_entry_id, v_bank_ledger, 'Payroll paid from ' || coalesce(v_bank.account_label, v_bank.bank_name), 0, v_total);

  -- Mirror the posted journal in the operational expense register so the
  -- existing Bank Accounts balance and bank statement immediately reflect it.
  insert into public.expenses(
    expense_date, category, payee, description, amount, payment_method,
    account_type, account_id, reference, status, created_by, journal_entry_id
  ) values (
    (v_now at time zone 'Asia/Kolkata')::date,
    'Staff Salaries',
    'Payroll — ' || to_char(v_batch.payroll_month, 'Month YYYY'),
    'Approved monthly payroll payment',
    v_total,
    'Bank Transfer',
    'bank',
    p_bank_account_id,
    v_ref,
    'Posted',
    auth.uid(),
    v_entry_id
  );

  update public.payroll_lines
  set payment_status = 'PAID',
      payment_reference = v_ref,
      payment_date = (v_now at time zone 'Asia/Kolkata')::date
  where batch_id = p_batch_id and upper(payment_status) = 'PENDING';

  insert into public.payslips as existing_payslip(
    payroll_line_id, employee_id, batch_id, payslip_number, payroll_month,
    generated_at, generated_by, meta
  )
  select pl.id, pl.employee_id, pl.batch_id,
         'PS-' || v_month || '-' || coalesce(nullif(pl.employee_code,''), substr(pl.employee_id::text,1,8)),
         v_batch.payroll_month, v_now, auth.uid(),
         jsonb_build_object('payment_reference', v_ref, 'payment_status', 'PAID')
  from public.payroll_lines pl
  where pl.batch_id = p_batch_id
  on conflict (payroll_line_id) do update
    set meta = coalesce(existing_payslip.meta,'{}'::jsonb) ||
               jsonb_build_object('payment_reference', v_ref, 'payment_status', 'PAID');

  update public.payroll_batches
  set status = 'PAID',
      payment_date = (v_now at time zone 'Asia/Kolkata')::date,
      updated_at = v_now
  where id = p_batch_id;

  insert into public.payroll_audit_log(entity_type, entity_id, action, notes, performed_by)
  values ('BATCH', p_batch_id, 'PAYMENT_POSTED',
          'Ledger payment ' || v_ref || ' from bank account ' || p_bank_account_id::text,
          auth.uid());

  return jsonb_build_object(
    'success', true, 'payment_reference', v_ref,
    'journal_entry_id', v_entry_id, 'bank_account_id', p_bank_account_id,
    'amount', v_total, 'employees_paid', v_count,
    'payslips_recorded', v_count, 'posted_at', v_now
  );
end;
$$;

revoke all on function public.process_payroll_payment(uuid, uuid) from public, anon;
grant execute on function public.process_payroll_payment(uuid, uuid) to authenticated;

-- The reporting helper uses the actual chart_of_accounts column names.
create or replace function public.trial_balance_summary(p_as_of date default current_date)
returns table (
  account_code text,
  account_name text,
  account_type text,
  debit_total numeric,
  credit_total numeric
)
language sql stable security definer set search_path = public
as $$
  select coa.account_code, coa.account_name, coa.account_type,
         coalesce(sum(case when jl.debit > 0 then jl.debit else 0 end),0),
         coalesce(sum(case when jl.credit > 0 then jl.credit else 0 end),0)
  from public.chart_of_accounts coa
  left join public.journal_lines jl on jl.account_id = coa.id
  left join public.journal_entries je on je.id = jl.journal_entry_id
       and je.entry_date <= p_as_of
       and upper(coalesce(je.status,'')) not in ('VOID','DELETED','CANCELLED')
  where public.is_admin() or public.has_permission('FINANCIAL REPORTS','VIEW')
  group by coa.account_code, coa.account_name, coa.account_type
  order by coa.account_code;
$$;
grant execute on function public.trial_balance_summary(date) to authenticated;

comment on function public.process_payroll_payment(uuid, uuid) is
'Atomically posts approved payroll to the ERP bank ledger, marks lines paid and creates payslips. Does not send real-world bank transfers.';
comment on table public.global_activity_log is
'Append-only global activity stream. event_number is a single monotonically increasing sequence; query ORDER BY event_number ASC for oldest-to-newest.';


-- ============================================================================
-- AVENIX PAYROLL REPAIR MIGRATION (idempotent)
-- Employee code generation is database-side to remain safe with simultaneous
-- mobile/desktop users. Bank accounts receive their own asset ledger account.
-- ============================================================================

-- Employee codes: preserve existing values and continue after the highest AVXT-NNN suffix.
create sequence if not exists public.avenix_employee_code_seq start with 21 increment by 1;
do $$
declare
  v_max bigint;
begin
  select max((substring(employee_code from '^AVXT-([0-9]+)$'))::bigint)
    into v_max
  from public.employees
  where employee_code ~ '^AVXT-[0-9]+$';

  if v_max is null or v_max < 20 then
    perform setval('public.avenix_employee_code_seq', 20, true);
  else
    perform setval('public.avenix_employee_code_seq', v_max, true);
  end if;
end $$;

create or replace function public.assign_avenix_employee_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.employee_code is null or btrim(new.employee_code) = '' then
    new.employee_code := 'AVXT-' || lpad(nextval('public.avenix_employee_code_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_avenix_employee_code on public.employees;
create trigger trg_assign_avenix_employee_code
before insert on public.employees
for each row execute function public.assign_avenix_employee_code();

-- Create a distinct chart-of-accounts asset ledger for each existing bank
-- account that has not yet been linked.
do $$
declare
  b record;
  v_ledger_id uuid;
  v_ledger_name text;
begin
  for b in
    select id, bank_name, account_label
    from public.bank_accounts
    where ledger_account_id is null
  loop
    v_ledger_name := 'Bank - ' ||
      coalesce(nullif(btrim(b.account_label),''), nullif(btrim(b.bank_name),''), 'Account') ||
      ' (' || left(b.id::text,8) || ')';

    insert into public.chart_of_accounts(account_name, account_type, is_active, is_system)
    values (v_ledger_name, 'asset', true, false)
    on conflict (account_name) do update set is_active = true
    returning id into v_ledger_id;

    update public.bank_accounts
      set ledger_account_id = v_ledger_id
      where id = b.id and ledger_account_id is null;
  end loop;
end $$;

-- Automatically link future bank accounts at creation time.
create or replace function public.ensure_bank_account_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ledger_account_id is null then
    insert into public.chart_of_accounts(account_name, account_type, is_active, is_system)
    values (
      'Bank - ' || coalesce(nullif(btrim(new.account_label),''), nullif(btrim(new.bank_name),''), 'Account')
        || ' (' || left(new.id::text,8) || ')',
      'asset', true, false
    )
    on conflict (account_name) do update set is_active = true
    returning id into new.ledger_account_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ensure_bank_account_ledger on public.bank_accounts;
create trigger trg_ensure_bank_account_ledger
before insert or update of bank_name, account_label, ledger_account_id
on public.bank_accounts
for each row execute function public.ensure_bank_account_ledger();

comment on sequence public.avenix_employee_code_seq is
  'Atomic employee-code sequence. First generated code is AVXT-021 unless higher codes already exist.';

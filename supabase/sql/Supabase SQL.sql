/*
  ============================================================================
  AVENIX OVERSEAS — AUTHORITATIVE SUPABASE SQL (SINGLE FILE)
  ============================================================================
  File name: Supabase SQL.sql
  Purpose: Complete, re-runnable schema + functions + RLS + accounting RPCs
           for a clean install OR incremental apply on existing projects.

  Owner / administrator (locked):
    mohammadaffan@avenixoverseas.com

  Instructions:
  1. Take a full database backup first.
  2. Open Supabase Dashboard → SQL Editor.
  3. Paste and run this entire file once.
  4. Deploy Edge Function: supabase functions deploy admin-user-management
  5. Confirm the Auth user email matches the owner above with role ADMIN.

  This file is the single source of truth. Older dated migration files are
  superseded by this consolidated script.
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
  snapshot jsonb,
  deleted_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz not null default now()
);
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
    coalesce(upper(new.raw_user_meta_data->>'role'), 'STAFF'),
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
    when not exists (select 1 from public.profiles where role = 'ADMIN') then 'ADMIN'
    else coalesce(upper(u.raw_user_meta_data->>'role'), 'STAFF')
  end,
  true
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Ensure at least one ADMIN exists (promote the oldest Auth user if none)
do $$
begin
  if not exists (select 1 from public.profiles where upper(role) = 'ADMIN' and active = true) then
    update public.profiles
    set role = 'ADMIN', active = true, updated_at = now()
    where id = (select id from public.profiles order by created_at nulls last, id limit 1);
  end if;
end $$;


-- ============================================================================
-- PROFILE AVATARS — STORAGE (optional; create bucket "avatars" in Dashboard if missing)
-- ============================================================================
-- Policies assume a private bucket named "avatars".
-- Users may upload/update only objects under their own user id folder: {user_id}/...

insert into storage.buckets (id, name, public)
select 'avatars', 'avatars', false
where not exists (select 1 from storage.buckets where id = 'avatars');

drop policy if exists avatars_select_own on storage.objects;
drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;

create policy avatars_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

-- Ensure login_history has useful columns
alter table public.login_history add column if not exists user_email text;
alter table public.login_history add column if not exists event_type text default 'sign_in';
alter table public.login_history add column if not exists outcome text default 'success';

-- download_logs user-friendly view support (names resolved in app via profile_directory)
create or replace view public.profile_directory as
  select id, display_name, email, role, active, avatar_url
  from public.profiles;

grant select on public.profile_directory to authenticated;

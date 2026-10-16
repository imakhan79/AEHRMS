-- =====================================================================
-- Native Finance & Accounting (BRD 6.15 FIN-01..12, 17.x review notes)
-- Fiscal periods + lock, manual journals + reversal (maker-checker), taxes,
-- AP (vendors, bills, payments + WHT), AR (customers, invoices, receipts),
-- bank accounts + statement import + matching + reconciliation, budgets,
-- and reporting functions (P&L, balance sheet, cash flow, ledger, aging, BvA).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Chart of accounts additions
-- ---------------------------------------------------------------------
alter table public.chart_of_accounts
  add column cash_flow_category text not null default 'operating'
    check (cash_flow_category in ('operating', 'investing', 'financing')),
  add column description text;

insert into public.chart_of_accounts (code, name, account_type, parent_id, cash_flow_category)
select v.code, v.name, v.t::public.account_type, p.id, v.cf
from (values
  ('1120', 'Bank — Operating Account', 'asset', '1000', 'operating'),
  ('1210', 'Accounts Receivable', 'asset', '1000', 'operating'),
  ('1410', 'Input Sales Tax (GST)', 'asset', '1000', 'operating'),
  ('1420', 'Advance Income Tax (withheld by customers)', 'asset', '1000', 'operating'),
  ('1610', 'Furniture, Equipment & Vehicles', 'asset', '1000', 'investing'),
  ('2010', 'Accounts Payable', 'liability', '2000', 'operating'),
  ('2210', 'Sales Tax Payable (GST output)', 'liability', '2000', 'operating'),
  ('2220', 'Withholding Tax Payable', 'liability', '2000', 'operating'),
  ('2510', 'Long-term Borrowings', 'liability', '2000', 'financing'),
  ('3110', 'Share Capital', 'equity', '3000', 'financing'),
  ('4110', 'Services Revenue', 'revenue', '4000', 'operating'),
  ('4120', 'Project Revenue', 'revenue', '4000', 'operating'),
  ('4190', 'Other Income', 'revenue', '4000', 'operating'),
  ('5210', 'Rent', 'expense', '5000', 'operating'),
  ('5220', 'Utilities', 'expense', '5000', 'operating'),
  ('5230', 'Office Supplies', 'expense', '5000', 'operating'),
  ('5240', 'Travel & Conveyance', 'expense', '5000', 'operating'),
  ('5250', 'Professional Fees', 'expense', '5000', 'operating'),
  ('5260', 'Repairs & Maintenance', 'expense', '5000', 'operating'),
  ('5270', 'IT & Software', 'expense', '5000', 'operating'),
  ('5280', 'Bank Charges', 'expense', '5000', 'operating'),
  ('5290', 'Miscellaneous Expenses', 'expense', '5000', 'operating')
) as v (code, name, t, parent, cf)
join public.chart_of_accounts p on p.code = v.parent;
update public.chart_of_accounts set is_postable = false where code = '4100'; -- header only

-- New journal sources
alter table public.journal_entries drop constraint journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check
  check (source in ('manual', 'payroll', 'payroll_payment', 'loan', 'fnf', 'ap_bill', 'ap_payment', 'ar_invoice', 'ar_receipt', 'reversal'));
alter table public.journal_entries add column reversal_of uuid references public.journal_entries (id);
alter table public.journal_entries add column reversed_by_entry uuid references public.journal_entries (id);

-- ---------------------------------------------------------------------
-- Fiscal periods & closing lock (FIN-11). Fiscal year = Jul–Jun, named by its ending year.
-- ---------------------------------------------------------------------
create table public.fiscal_periods (
  period_start  date primary key check (extract(day from period_start) = 1),
  fiscal_year   integer not null,
  status        text not null default 'open' check (status in ('open', 'closed')),
  closed_by     uuid,
  closed_at     timestamptz
);
insert into public.fiscal_periods (period_start, fiscal_year)
select d::date, private.tax_year_of(d::date)
from generate_series('2025-07-01'::date, '2027-06-01'::date, interval '1 month') d;

-- Posting validates balance AND that the period is open.
create or replace function private.post_journal(p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  dr  numeric;
  cr  numeric;
  n   integer;
  d   date;
  ps  text;
begin
  select entry_date into d from public.journal_entries where id = p_entry;
  select status into ps from public.fiscal_periods where period_start = date_trunc('month', d)::date;
  if ps is null then
    raise exception 'No fiscal period is set up for %. Open the fiscal year first.', to_char(d, 'Mon YYYY');
  end if;
  if ps = 'closed' then
    raise exception 'The period % is closed. Reopen it or post in an open period.', to_char(d, 'Mon YYYY');
  end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into dr, cr, n
    from public.journal_entry_lines where journal_entry_id = p_entry;
  if n < 2 then
    raise exception 'A journal entry needs at least two lines.';
  end if;
  if dr <> cr then
    raise exception 'Journal entry is not balanced: debits % ≠ credits %.', dr, cr;
  end if;
  update public.journal_entries set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_entry and status = 'draft';
end $$;

-- Direct (API) edits may only touch a draft's date/description; status changes go through functions.
create or replace function private.journal_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Posted journal entries cannot be deleted.';
    end if;
    return old;
  end if;
  if current_user = 'authenticated' and (new.status, new.source, new.posted_at, new.posted_by, new.reversal_of, new.reversed_by_entry)
     is distinct from (old.status, old.source, old.posted_at, old.posted_by, old.reversal_of, old.reversed_by_entry) then
    raise exception 'Use the post / reverse actions to change a journal''s status.';
  end if;
  if old.status = 'posted' and not (new.status = 'reversed' and
     (new.entry_date, new.description, new.source, new.source_id) is not distinct from
     (old.entry_date, old.description, old.source, old.source_id)) then
    raise exception 'Posted journal entries cannot be changed.';
  end if;
  if old.status = 'reversed' then
    raise exception 'Reversed journal entries cannot be changed.';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Taxes (FIN-08)
-- ---------------------------------------------------------------------
create table public.taxes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  tax_type    text not null check (tax_type in ('gst_output', 'gst_input', 'wht_payable', 'wht_receivable')),
  rate_pct    numeric(6, 3) not null check (rate_pct between 0 and 100),
  account_id  uuid not null references public.chart_of_accounts (id),
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into public.taxes (code, name, tax_type, rate_pct, account_id, notes)
select v.code, v.name, v.t, v.rate, a.id, v.notes
from (values
  ('GST18-OUT', 'Sales tax 18% (output)', 'gst_output', 18, '2210', 'Standard rate. Provincial services sales tax rates differ — add them as needed.'),
  ('GST18-IN', 'Sales tax 18% (input)', 'gst_input', 18, '1410', 'Claimable input tax on purchases.')
) as v (code, name, t, rate, acct, notes)
join public.chart_of_accounts a on a.code = v.acct;
-- Withholding-tax rates (s.153 etc.) depend on section and filer status: Finance adds them.

-- ---------------------------------------------------------------------
-- Masters
-- ---------------------------------------------------------------------
create table public.vendors (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null,
  ntn                 text,
  strn                text,
  contact_person      text,
  email               text,
  phone               text,
  address             text,
  default_wht_tax_id  uuid references public.taxes (id),
  payment_terms_days  integer not null default 30 check (payment_terms_days between 0 and 365),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null,
  ntn                 text,
  strn                text,
  contact_person      text,
  email               text,
  phone               text,
  address             text,
  payment_terms_days  integer not null default 30 check (payment_terms_days between 0 and 365),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

create table public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  bank_name       text,
  account_number  text,
  iban            text,
  gl_account_id   uuid not null unique references public.chart_of_accounts (id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
insert into public.bank_accounts (name, gl_account_id)
select a.name, a.id from public.chart_of_accounts a where a.code in ('1110', '1120');

-- ---------------------------------------------------------------------
-- Accounts payable (FIN-04)
-- ---------------------------------------------------------------------
create sequence public.ap_payment_no_seq;
create sequence public.ar_invoice_no_seq;
create sequence public.ar_receipt_no_seq;
create sequence public.ap_bill_ref_seq;

create table public.bills (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default ('BILL-' || lpad(nextval('public.ap_bill_ref_seq')::text, 6, '0')),
  vendor_id         uuid not null references public.vendors (id),
  vendor_invoice_no text,
  bill_date         date not null,
  due_date          date not null,
  description       text,
  status            text not null default 'draft' check (status in ('draft', 'posted')),
  subtotal          numeric(16, 2) not null default 0,
  tax_total         numeric(16, 2) not null default 0,
  total             numeric(16, 2) not null default 0,
  amount_paid       numeric(16, 2) not null default 0,
  journal_entry_id  uuid references public.journal_entries (id),
  created_by        uuid default auth.uid(),
  posted_by         uuid,
  posted_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique (vendor_id, vendor_invoice_no),
  check (due_date >= bill_date)
);

create table public.bill_lines (
  id              uuid primary key default gen_random_uuid(),
  bill_id         uuid not null references public.bills (id) on delete cascade,
  account_id      uuid not null references public.chart_of_accounts (id),
  cost_center_id  uuid references public.cost_centers (id),
  description     text,
  amount          numeric(16, 2) not null check (amount > 0),
  tax_id          uuid references public.taxes (id),
  tax_amount      numeric(16, 2) not null default 0
);
create index bill_lines_bill_idx on public.bill_lines (bill_id);

create table public.vendor_payments (
  id                uuid primary key default gen_random_uuid(),
  payment_no        text not null unique default ('PV-' || lpad(nextval('public.ap_payment_no_seq')::text, 6, '0')),
  vendor_id         uuid not null references public.vendors (id),
  payment_date      date not null,
  bank_account_id   uuid not null references public.bank_accounts (id),
  amount            numeric(16, 2) not null check (amount > 0), -- settles this much of the bills
  wht_tax_id        uuid references public.taxes (id),
  wht_amount        numeric(16, 2) not null default 0 check (wht_amount >= 0),
  net_paid          numeric(16, 2) generated always as (amount - wht_amount) stored,
  reference         text,
  status            text not null default 'draft' check (status in ('draft', 'posted')),
  journal_entry_id  uuid references public.journal_entries (id),
  created_by        uuid default auth.uid(),
  posted_by         uuid,
  posted_at         timestamptz,
  created_at        timestamptz not null default now(),
  check (wht_amount < amount)
);

create table public.payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.vendor_payments (id) on delete cascade,
  bill_id     uuid not null references public.bills (id),
  amount      numeric(16, 2) not null check (amount > 0),
  unique (payment_id, bill_id)
);

-- ---------------------------------------------------------------------
-- Accounts receivable (FIN-05)
-- ---------------------------------------------------------------------
create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  invoice_no        text not null unique default ('INV-' || lpad(nextval('public.ar_invoice_no_seq')::text, 6, '0')),
  customer_id       uuid not null references public.customers (id),
  invoice_date      date not null,
  due_date          date not null,
  description       text,
  status            text not null default 'draft' check (status in ('draft', 'posted')),
  subtotal          numeric(16, 2) not null default 0,
  tax_total         numeric(16, 2) not null default 0,
  total             numeric(16, 2) not null default 0,
  amount_received   numeric(16, 2) not null default 0,
  journal_entry_id  uuid references public.journal_entries (id),
  created_by        uuid default auth.uid(),
  posted_by         uuid,
  posted_at         timestamptz,
  created_at        timestamptz not null default now(),
  check (due_date >= invoice_date)
);

create table public.invoice_lines (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices (id) on delete cascade,
  account_id      uuid not null references public.chart_of_accounts (id),
  cost_center_id  uuid references public.cost_centers (id),
  description     text,
  amount          numeric(16, 2) not null check (amount > 0),
  tax_id          uuid references public.taxes (id),
  tax_amount      numeric(16, 2) not null default 0
);
create index invoice_lines_inv_idx on public.invoice_lines (invoice_id);

create table public.customer_receipts (
  id                uuid primary key default gen_random_uuid(),
  receipt_no        text not null unique default ('RV-' || lpad(nextval('public.ar_receipt_no_seq')::text, 6, '0')),
  customer_id       uuid not null references public.customers (id),
  receipt_date      date not null,
  bank_account_id   uuid not null references public.bank_accounts (id),
  amount            numeric(16, 2) not null check (amount > 0), -- settles this much of the invoices
  wht_amount        numeric(16, 2) not null default 0 check (wht_amount >= 0), -- tax the customer withheld
  net_received      numeric(16, 2) generated always as (amount - wht_amount) stored,
  reference         text,
  status            text not null default 'draft' check (status in ('draft', 'posted')),
  journal_entry_id  uuid references public.journal_entries (id),
  created_by        uuid default auth.uid(),
  posted_by         uuid,
  posted_at         timestamptz,
  created_at        timestamptz not null default now(),
  check (wht_amount < amount)
);

create table public.receipt_allocations (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.customer_receipts (id) on delete cascade,
  invoice_id  uuid not null references public.invoices (id),
  amount      numeric(16, 2) not null check (amount > 0),
  unique (receipt_id, invoice_id)
);

-- ---------------------------------------------------------------------
-- Bank statements & reconciliation (FIN-06)
-- ---------------------------------------------------------------------
create table public.bank_statement_lines (
  id               uuid primary key default gen_random_uuid(),
  bank_account_id  uuid not null references public.bank_accounts (id) on delete cascade,
  txn_date         date not null,
  description      text not null default '',
  reference        text not null default '',
  amount           numeric(16, 2) not null check (amount <> 0), -- + deposit, − withdrawal
  import_batch     uuid,
  matched_line_id  uuid unique references public.journal_entry_lines (id),
  status           text not null default 'unmatched' check (status in ('unmatched', 'matched', 'ignored')),
  matched_by       uuid,
  matched_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (bank_account_id, txn_date, amount, reference, description)
);
create index bsl_account_idx on public.bank_statement_lines (bank_account_id, txn_date);

create table public.bank_reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  bank_account_id    uuid not null references public.bank_accounts (id),
  statement_date     date not null,
  statement_balance  numeric(16, 2) not null,
  book_balance       numeric(16, 2) not null,
  uncleared_book     numeric(16, 2) not null,
  unbooked_bank      numeric(16, 2) not null,
  difference         numeric(16, 2) not null,
  notes              text,
  completed_by       uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  unique (bank_account_id, statement_date)
);

-- ---------------------------------------------------------------------
-- Budgets (FIN-10)
-- ---------------------------------------------------------------------
create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  fiscal_year  integer not null,
  name         text not null,
  status       text not null default 'draft' check (status in ('draft', 'approved')),
  created_by   uuid default auth.uid(),
  approved_by  uuid,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (fiscal_year, name)
);

create table public.budget_lines (
  id              uuid primary key default gen_random_uuid(),
  budget_id       uuid not null references public.budgets (id) on delete cascade,
  account_id      uuid not null references public.chart_of_accounts (id),
  cost_center_id  uuid references public.cost_centers (id),
  period_start    date not null check (extract(day from period_start) = 1),
  amount          numeric(16, 2) not null check (amount >= 0),
  unique nulls not distinct (budget_id, account_id, cost_center_id, period_start)
);
create index budget_lines_budget_idx on public.budget_lines (budget_id);

-- ---------------------------------------------------------------------
-- Document guards: lines editable only while the parent is a draft; tax computed here.
-- ---------------------------------------------------------------------
create function private.doc_line_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  parent_status text;
  rate numeric;
begin
  if tg_table_name = 'bill_lines' then
    select status into parent_status from public.bills where id = coalesce(new.bill_id, old.bill_id);
  else
    select status into parent_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  end if;
  if parent_status <> 'draft' then
    raise exception 'Posted documents can''t be changed.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.tax_id is not null then
    select rate_pct into rate from public.taxes where id = new.tax_id;
    new.tax_amount := round(new.amount * rate / 100, 2);
  else
    new.tax_amount := 0;
  end if;
  return new;
end $$;

create trigger bill_lines_before before insert or update or delete on public.bill_lines
  for each row execute function private.doc_line_before();
create trigger invoice_lines_before before insert or update or delete on public.invoice_lines
  for each row execute function private.doc_line_before();

create function private.doc_line_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'bill_lines' then
    update public.bills b set
      subtotal = s.sub, tax_total = s.tax, total = s.sub + s.tax
    from (select coalesce(sum(amount), 0) sub, coalesce(sum(tax_amount), 0) tax
            from public.bill_lines where bill_id = coalesce(new.bill_id, old.bill_id)) s
    where b.id = coalesce(new.bill_id, old.bill_id);
  else
    update public.invoices i set
      subtotal = s.sub, tax_total = s.tax, total = s.sub + s.tax
    from (select coalesce(sum(amount), 0) sub, coalesce(sum(tax_amount), 0) tax
            from public.invoice_lines where invoice_id = coalesce(new.invoice_id, old.invoice_id)) s
    where i.id = coalesce(new.invoice_id, old.invoice_id);
  end if;
  return null;
end $$;

create trigger bill_lines_after after insert or update or delete on public.bill_lines
  for each row execute function private.doc_line_after();
create trigger invoice_lines_after after insert or update or delete on public.invoice_lines
  for each row execute function private.doc_line_after();

-- Headers: once posted, API callers can't change them; system functions can (current_user ≠ authenticated).
create function private.doc_header_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Posted documents can''t be deleted.'; end if;
    return old;
  end if;
  if old.status <> 'draft' then
    raise exception 'Posted documents can''t be changed.';
  end if;
  if new.status <> old.status or new.journal_entry_id is distinct from old.journal_entry_id then
    raise exception 'Use the post action to post this document.';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['bills', 'invoices', 'vendor_payments', 'customer_receipts'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.doc_header_guard()', t || '_guard', t);
  end loop;
end $$;

-- Allocations editable only while the payment/receipt is a draft.
create function private.allocation_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  if tg_table_name = 'payment_allocations' then
    select status into s from public.vendor_payments where id = coalesce(new.payment_id, old.payment_id);
  else
    select status into s from public.customer_receipts where id = coalesce(new.receipt_id, old.receipt_id);
  end if;
  if s <> 'draft' then raise exception 'Posted payments can''t be changed.'; end if;
  return coalesce(new, old);
end $$;

create trigger payment_allocations_guard before insert or update or delete on public.payment_allocations
  for each row execute function private.allocation_guard();
create trigger receipt_allocations_guard before insert or update or delete on public.receipt_allocations
  for each row execute function private.allocation_guard();

create function private.budget_line_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.budgets where id = coalesce(new.budget_id, old.budget_id)) <> 'draft' then
    raise exception 'Approved budgets can''t be changed.';
  end if;
  return coalesce(new, old);
end $$;

create trigger budget_lines_guard before insert or update or delete on public.budget_lines
  for each row execute function private.budget_line_guard();

create function private.budget_header_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and (new.status, new.approved_by, new.approved_at) is distinct from (old.status, old.approved_by, old.approved_at) then
    raise exception 'Use the approve action.';
  end if;
  return new;
end $$;

create trigger budgets_guard before update on public.budgets
  for each row execute function private.budget_header_guard();

-- ---------------------------------------------------------------------
-- Posting functions
-- ---------------------------------------------------------------------
create function private.require_finance() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then
    raise exception 'Only Finance can do this.' using errcode = '42501';
  end if;
end $$;

create function public.fin_post_manual_journal(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.journal_entries;
begin
  perform private.require_finance();
  select * into j from public.journal_entries where id = p_id for update;
  if j.id is null or j.source <> 'manual' then raise exception 'Manual journal not found.'; end if;
  if j.status <> 'draft' then raise exception 'This journal is already posted.'; end if;
  if j.created_by = auth.uid() then
    raise exception 'Maker-checker: the person who prepared a journal can''t post it.' using errcode = '42501';
  end if;
  perform private.post_journal(p_id);
end $$;

-- Reversal (FIN-12 corrections): new entry with debits/credits swapped, original marked reversed.
create function public.fin_reverse_journal(p_id uuid, p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  j   public.journal_entries;
  rv  uuid;
begin
  perform private.require_finance();
  select * into j from public.journal_entries where id = p_id for update;
  if j.id is null then raise exception 'Journal not found.'; end if;
  if j.status <> 'posted' then raise exception 'Only posted journals can be reversed.'; end if;
  if j.source not in ('manual', 'reversal') then
    raise exception 'System-generated entries (payroll, AP, AR) are corrected from their source document or with a manual journal.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the reversal.'; end if;
  insert into public.journal_entries (entry_date, description, source, source_id, reversal_of)
  values (coalesce(p_date, current_date), 'Reversal of ' || j.entry_no || ': ' || p_reason, 'reversal', j.id, j.id)
  returning id into rv;
  insert into public.journal_entry_lines (journal_entry_id, account_id, cost_center_id, debit, credit, description)
  select rv, account_id, cost_center_id, credit, debit, description from public.journal_entry_lines where journal_entry_id = p_id;
  perform private.post_journal(rv);
  update public.journal_entries set status = 'reversed', reversed_by_entry = rv where id = p_id;
  return rv;
end $$;

create function public.fin_post_bill(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b   public.bills;
  je  uuid;
  vname text;
begin
  perform private.require_finance();
  select * into b from public.bills where id = p_id for update;
  if b.id is null then raise exception 'Bill not found.'; end if;
  if b.status <> 'draft' then raise exception 'This bill is already posted.'; end if;
  if b.total <= 0 then raise exception 'Add at least one line before posting.'; end if;
  select name into vname from public.vendors where id = b.vendor_id;
  insert into public.journal_entries (entry_date, description, source, source_id)
  values (b.bill_date, 'Bill ' || b.reference || ' — ' || vname || coalesce(' (' || b.vendor_invoice_no || ')', ''), 'ap_bill', b.id)
  returning id into je;
  insert into public.journal_entry_lines (journal_entry_id, account_id, cost_center_id, debit, description)
  select je, account_id, cost_center_id, amount, coalesce(description, 'Bill line') from public.bill_lines where bill_id = p_id;
  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, description)
  select je, t.account_id, sum(l.tax_amount), t.name
    from public.bill_lines l join public.taxes t on t.id = l.tax_id
   where l.bill_id = p_id and l.tax_amount > 0 group by t.account_id, t.name;
  insert into public.journal_entry_lines (journal_entry_id, account_id, credit, description)
  values (je, private.account_id('2010'), b.total, 'Payable to ' || vname);
  perform private.post_journal(je);
  update public.bills set status = 'posted', journal_entry_id = je, posted_by = auth.uid(), posted_at = now() where id = p_id;
  return je;
end $$;

create function public.fin_post_vendor_payment(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p      public.vendor_payments;
  je     uuid;
  alloc  numeric;
  bank   uuid;
  wht_acct uuid;
  vname  text;
begin
  perform private.require_finance();
  select * into p from public.vendor_payments where id = p_id for update;
  if p.id is null then raise exception 'Payment not found.'; end if;
  if p.status <> 'draft' then raise exception 'This payment is already posted.'; end if;
  if p.created_by = auth.uid() then
    raise exception 'Maker-checker: the person who prepared a payment can''t release it.' using errcode = '42501';
  end if;
  select coalesce(sum(amount), 0) into alloc from public.payment_allocations where payment_id = p_id;
  if alloc <> p.amount then
    raise exception 'Allocate the full payment to bills: % allocated of %.', alloc, p.amount;
  end if;
  if exists (
    select 1 from public.payment_allocations a join public.bills b on b.id = a.bill_id
     where a.payment_id = p_id and (b.status <> 'posted' or b.vendor_id <> p.vendor_id or a.amount > b.total - b.amount_paid)
  ) then
    raise exception 'An allocation exceeds a bill''s outstanding amount, or the bill isn''t posted for this vendor.';
  end if;
  if p.wht_amount > 0 then
    select account_id into wht_acct from public.taxes where id = p.wht_tax_id;
    if wht_acct is null then raise exception 'Choose the withholding tax for the withheld amount.'; end if;
  end if;
  select gl_account_id into bank from public.bank_accounts where id = p.bank_account_id;
  select name into vname from public.vendors where id = p.vendor_id;

  insert into public.journal_entries (entry_date, description, source, source_id)
  values (p.payment_date, 'Payment ' || p.payment_no || ' — ' || vname, 'ap_payment', p.id)
  returning id into je;
  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
    (je, private.account_id('2010'), p.amount, 0, 'Settle payable — ' || vname),
    (je, bank, 0, p.net_paid, coalesce('Ref ' || p.reference, 'Bank payment'));
  if p.wht_amount > 0 then
    insert into public.journal_entry_lines (journal_entry_id, account_id, credit, description)
    values (je, wht_acct, p.wht_amount, 'Tax withheld from ' || vname);
  end if;
  perform private.post_journal(je);
  update public.bills b set amount_paid = b.amount_paid + a.amount
    from public.payment_allocations a where a.payment_id = p_id and a.bill_id = b.id;
  update public.vendor_payments set status = 'posted', journal_entry_id = je, posted_by = auth.uid(), posted_at = now() where id = p_id;
  return je;
end $$;

create function public.fin_post_invoice(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  i   public.invoices;
  je  uuid;
  cname text;
begin
  perform private.require_finance();
  select * into i from public.invoices where id = p_id for update;
  if i.id is null then raise exception 'Invoice not found.'; end if;
  if i.status <> 'draft' then raise exception 'This invoice is already posted.'; end if;
  if i.total <= 0 then raise exception 'Add at least one line before posting.'; end if;
  select name into cname from public.customers where id = i.customer_id;
  insert into public.journal_entries (entry_date, description, source, source_id)
  values (i.invoice_date, 'Invoice ' || i.invoice_no || ' — ' || cname, 'ar_invoice', i.id)
  returning id into je;
  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, description)
  values (je, private.account_id('1210'), i.total, 'Receivable from ' || cname);
  insert into public.journal_entry_lines (journal_entry_id, account_id, cost_center_id, credit, description)
  select je, account_id, cost_center_id, amount, coalesce(description, 'Invoice line') from public.invoice_lines where invoice_id = p_id;
  insert into public.journal_entry_lines (journal_entry_id, account_id, credit, description)
  select je, t.account_id, sum(l.tax_amount), t.name
    from public.invoice_lines l join public.taxes t on t.id = l.tax_id
   where l.invoice_id = p_id and l.tax_amount > 0 group by t.account_id, t.name;
  perform private.post_journal(je);
  update public.invoices set status = 'posted', journal_entry_id = je, posted_by = auth.uid(), posted_at = now() where id = p_id;
  return je;
end $$;

create function public.fin_post_receipt(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r      public.customer_receipts;
  je     uuid;
  alloc  numeric;
  bank   uuid;
  cname  text;
begin
  perform private.require_finance();
  select * into r from public.customer_receipts where id = p_id for update;
  if r.id is null then raise exception 'Receipt not found.'; end if;
  if r.status <> 'draft' then raise exception 'This receipt is already posted.'; end if;
  select coalesce(sum(amount), 0) into alloc from public.receipt_allocations where receipt_id = p_id;
  if alloc <> r.amount then
    raise exception 'Allocate the full receipt to invoices: % allocated of %.', alloc, r.amount;
  end if;
  if exists (
    select 1 from public.receipt_allocations a join public.invoices i on i.id = a.invoice_id
     where a.receipt_id = p_id and (i.status <> 'posted' or i.customer_id <> r.customer_id or a.amount > i.total - i.amount_received)
  ) then
    raise exception 'An allocation exceeds an invoice''s outstanding amount, or the invoice isn''t posted for this customer.';
  end if;
  select gl_account_id into bank from public.bank_accounts where id = r.bank_account_id;
  select name into cname from public.customers where id = r.customer_id;
  insert into public.journal_entries (entry_date, description, source, source_id)
  values (r.receipt_date, 'Receipt ' || r.receipt_no || ' — ' || cname, 'ar_receipt', r.id)
  returning id into je;
  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
    (je, bank, r.net_received, 0, coalesce('Ref ' || r.reference, 'Bank receipt')),
    (je, private.account_id('1210'), 0, r.amount, 'Settle receivable — ' || cname);
  if r.wht_amount > 0 then
    insert into public.journal_entry_lines (journal_entry_id, account_id, debit, description)
    values (je, private.account_id('1420'), r.wht_amount, 'Tax withheld by ' || cname);
  end if;
  perform private.post_journal(je);
  update public.invoices i set amount_received = i.amount_received + a.amount
    from public.receipt_allocations a where a.receipt_id = p_id and a.invoice_id = i.id;
  update public.customer_receipts set status = 'posted', journal_entry_id = je, posted_by = auth.uid(), posted_at = now() where id = p_id;
  return je;
end $$;

create function public.fin_set_period_status(p_period date, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_finance();
  if p_status not in ('open', 'closed') then raise exception 'Invalid status.'; end if;
  if p_status = 'open' and not private.has_any_role(array['system_admin']::public.app_role[])
     and exists (select 1 from public.fiscal_periods where period_start = date_trunc('month', p_period)::date and status = 'closed') then
    raise exception 'Only a System Admin can reopen a closed period.' using errcode = '42501';
  end if;
  update public.fiscal_periods
     set status = p_status,
         closed_by = case when p_status = 'closed' then auth.uid() end,
         closed_at = case when p_status = 'closed' then now() end
   where period_start = date_trunc('month', p_period)::date;
  if not found then raise exception 'No such fiscal period.'; end if;
end $$;

create function public.fin_open_fiscal_year(p_fy integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.require_finance();
  insert into public.fiscal_periods (period_start, fiscal_year)
  select d::date, p_fy from generate_series(make_date(p_fy - 1, 7, 1), make_date(p_fy, 6, 1), interval '1 month') d
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create function public.fin_approve_budget(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.budgets;
begin
  perform private.require_finance();
  select * into b from public.budgets where id = p_id for update;
  if b.id is null then raise exception 'Budget not found.'; end if;
  if b.status <> 'draft' then raise exception 'Already approved.'; end if;
  if b.created_by = auth.uid() then
    raise exception 'Maker-checker: the preparer can''t approve the budget.' using errcode = '42501';
  end if;
  update public.budgets set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Bank matching
-- ---------------------------------------------------------------------
-- GL lines on the bank's account that no statement line has matched yet.
create function private.unmatched_book_lines(p_bank uuid, p_to date)
returns table (line_id uuid, entry_date date, amount numeric, description text, entry_no text)
language sql stable security definer set search_path = '' as $$
  select l.id, e.entry_date, l.debit - l.credit, coalesce(l.description, e.description), e.entry_no
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.journal_entry_id and e.status in ('posted', 'reversed')
    join public.bank_accounts b on b.gl_account_id = l.account_id and b.id = p_bank
   where e.entry_date <= p_to
     and not exists (select 1 from public.bank_statement_lines s where s.matched_line_id = l.id);
$$;

create function public.fin_auto_match(p_bank uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s  record;
  m  uuid;
  n  integer := 0;
begin
  perform private.require_finance();
  for s in select * from public.bank_statement_lines where bank_account_id = p_bank and status = 'unmatched' order by txn_date loop
    select u.line_id into m
      from private.unmatched_book_lines(p_bank, s.txn_date + 10) u
     where u.amount = s.amount and abs(u.entry_date - s.txn_date) <= 7
     order by abs(u.entry_date - s.txn_date) limit 1;
    if m is not null then
      update public.bank_statement_lines set matched_line_id = m, status = 'matched', matched_by = auth.uid(), matched_at = now() where id = s.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create function public.fin_match_statement_line(p_stmt uuid, p_line uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s  public.bank_statement_lines;
  amt numeric;
begin
  perform private.require_finance();
  select * into s from public.bank_statement_lines where id = p_stmt for update;
  if s.id is null then raise exception 'Statement line not found.'; end if;
  if p_line is null then
    update public.bank_statement_lines set matched_line_id = null, status = 'unmatched', matched_by = null, matched_at = null where id = p_stmt;
    return;
  end if;
  select u.amount into amt from private.unmatched_book_lines(s.bank_account_id, 'infinity'::date) u where u.line_id = p_line;
  if amt is null then raise exception 'That ledger line is not an unmatched entry on this bank account.'; end if;
  if amt <> s.amount then raise exception 'Amounts differ: statement % vs ledger %.', s.amount, amt; end if;
  update public.bank_statement_lines set matched_line_id = p_line, status = 'matched', matched_by = auth.uid(), matched_at = now() where id = p_stmt;
end $$;

create function public.fin_ignore_statement_line(p_stmt uuid, p_ignore boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_finance();
  update public.bank_statement_lines
     set status = case when p_ignore then 'ignored' else 'unmatched' end, matched_line_id = null
   where id = p_stmt and status <> 'matched';
end $$;

create function public.fin_unmatched_book_lines(p_bank uuid, p_to date)
returns table (line_id uuid, entry_date date, amount numeric, description text, entry_no text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_read_payroll() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query select * from private.unmatched_book_lines(p_bank, p_to) order by 2;
end $$;

-- Statement balance vs book balance with reconciling items (FIN-06).
create function public.fin_reconciliation_summary(p_bank uuid, p_as_of date, p_statement_balance numeric)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  book      numeric;
  uncleared numeric;
  unbooked  numeric;
begin
  if not private.can_read_payroll() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select coalesce(sum(l.debit - l.credit), 0) into book
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.journal_entry_id and e.status in ('posted', 'reversed') and e.entry_date <= p_as_of
    join public.bank_accounts b on b.gl_account_id = l.account_id and b.id = p_bank;
  select coalesce(sum(amount), 0) into uncleared from private.unmatched_book_lines(p_bank, p_as_of);
  select coalesce(sum(amount), 0) into unbooked
    from public.bank_statement_lines where bank_account_id = p_bank and status = 'unmatched' and txn_date <= p_as_of;
  -- statement + book items not yet on the statement − bank items not yet in the books = book balance
  return jsonb_build_object(
    'book_balance', book,
    'statement_balance', p_statement_balance,
    'uncleared_book', uncleared,
    'unbooked_bank', unbooked,
    'difference', (p_statement_balance + uncleared - unbooked) - book
  );
end $$;

-- ---------------------------------------------------------------------
-- Reports (FIN-07). SECURITY INVOKER: RLS on the journal tables applies.
-- ---------------------------------------------------------------------
create function public.fin_profit_and_loss(p_from date, p_to date, p_cost_center uuid default null)
returns table (account_type public.account_type, code text, name text, amount numeric)
language sql stable security invoker set search_path = '' as $$
  select a.account_type, a.code, a.name,
         case when a.account_type = 'revenue' then coalesce(sum(l.credit - l.debit), 0)
              else coalesce(sum(l.debit - l.credit), 0) end
    from public.chart_of_accounts a
    left join (
      public.journal_entry_lines l
      join public.journal_entries e on e.id = l.journal_entry_id and e.status in ('posted', 'reversed')
        and e.entry_date between p_from and p_to
    ) on l.account_id = a.id and (p_cost_center is null or l.cost_center_id = p_cost_center)
   where a.account_type in ('revenue', 'expense') and a.is_postable
   group by a.id
   order by a.account_type desc, a.code;
$$;

-- Balance sheet with computed earnings lines so it always balances (17.y note 1).
create function public.fin_balance_sheet(p_as_of date)
returns table (section text, code text, name text, balance numeric)
language sql stable security invoker set search_path = '' as $$
  with fy as (select make_date(private.tax_year_of(p_as_of) - 1, 7, 1) as start),
  bal as (
    select a.id, a.code, a.name, a.account_type,
           coalesce(sum(l.debit - l.credit) filter (where e.id is not null), 0) as dr_minus_cr,
           coalesce(sum(l.debit - l.credit) filter (where e.id is not null and e.entry_date < (select start from fy)), 0) as prior_dr_minus_cr
      from public.chart_of_accounts a
      left join public.journal_entry_lines l on l.account_id = a.id
      left join public.journal_entries e on e.id = l.journal_entry_id and e.status in ('posted', 'reversed') and e.entry_date <= p_as_of
     where a.is_postable
     group by a.id
  )
  select 'asset', code, name, dr_minus_cr from bal where account_type = 'asset'
  union all
  select 'liability', code, name, -dr_minus_cr from bal where account_type = 'liability'
  union all
  select 'equity', code, name, -dr_minus_cr from bal where account_type = 'equity'
  union all
  select 'equity', '—', 'Retained earnings (prior years, unclosed)',
         -coalesce(sum(prior_dr_minus_cr), 0) from bal where account_type in ('revenue', 'expense')
  union all
  select 'equity', '—', 'Current year earnings',
         -coalesce(sum(dr_minus_cr - prior_dr_minus_cr), 0) from bal where account_type in ('revenue', 'expense');
$$;

create function public.fin_account_ledger(p_account uuid, p_from date, p_to date)
returns table (entry_date date, entry_no text, description text, debit numeric, credit numeric, running_balance numeric, opening boolean)
language sql stable security invoker set search_path = '' as $$
  with acct as (select account_type from public.chart_of_accounts where id = p_account),
  sign as (select case when (select account_type from acct) in ('asset', 'expense') then 1 else -1 end as s),
  opening as (
    select coalesce(sum(l.debit - l.credit), 0) as ob
      from public.journal_entry_lines l
      join public.journal_entries e on e.id = l.journal_entry_id and e.status in ('posted', 'reversed') and e.entry_date < p_from
     where l.account_id = p_account
  ),
  moves as (
    select e.entry_date, e.entry_no, coalesce(l.description, e.description) as description, l.debit, l.credit, e.created_at
      from public.journal_entry_lines l
      join public.journal_entries e on e.id = l.journal_entry_id and e.status in ('posted', 'reversed')
       and e.entry_date between p_from and p_to
     where l.account_id = p_account
  )
  select p_from, null, 'Opening balance', null::numeric, null::numeric, (select ob from opening) * (select s from sign), true
  union all
  select entry_date, entry_no, description, debit, credit,
         ((select ob from opening) + sum(debit - credit) over (order by entry_date, created_at, entry_no rows unbounded preceding)) * (select s from sign),
         false
    from moves;
$$;

-- Direct-method cash flow: bank movements classified by the counter-account's category.
create function public.fin_cash_flow(p_from date, p_to date)
returns table (category text, counter_account text, inflow numeric, outflow numeric)
language sql stable security invoker set search_path = '' as $$
  with bank_moves as (
    select e.id as entry_id, sum(l.debit - l.credit) as net
      from public.journal_entry_lines l
      join public.journal_entries e on e.id = l.journal_entry_id and e.status in ('posted', 'reversed')
        and e.entry_date between p_from and p_to
      join public.bank_accounts b on b.gl_account_id = l.account_id
     group by e.id
  ),
  counter as (
    select distinct on (m.entry_id) m.entry_id, m.net, a.cash_flow_category, a.code || ' ' || a.name as acct
      from bank_moves m
      join public.journal_entry_lines l on l.journal_entry_id = m.entry_id
      join public.chart_of_accounts a on a.id = l.account_id
     where not exists (select 1 from public.bank_accounts b where b.gl_account_id = l.account_id)
     order by m.entry_id, (l.debit + l.credit) desc
  )
  select coalesce(cash_flow_category, 'transfers'), coalesce(acct, 'Transfers between bank accounts'),
         sum(greatest(m.net, 0)), sum(greatest(-m.net, 0))
    from bank_moves m left join counter c on c.entry_id = m.entry_id
   group by 1, 2
   order by 1, 2;
$$;

create function public.fin_ap_aging(p_as_of date)
returns table (vendor_id uuid, vendor text, current_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric)
language sql stable security invoker set search_path = '' as $$
  with open_bills as (
    select b.vendor_id, b.due_date,
           b.total - coalesce((select sum(a.amount) from public.payment_allocations a
                                join public.vendor_payments p on p.id = a.payment_id and p.status = 'posted' and p.payment_date <= p_as_of
                               where a.bill_id = b.id), 0) as outstanding
      from public.bills b
     where b.status = 'posted' and b.bill_date <= p_as_of
  )
  select v.id, v.name,
         sum(outstanding) filter (where p_as_of <= due_date),
         sum(outstanding) filter (where p_as_of - due_date between 1 and 30),
         sum(outstanding) filter (where p_as_of - due_date between 31 and 60),
         sum(outstanding) filter (where p_as_of - due_date between 61 and 90),
         sum(outstanding) filter (where p_as_of - due_date > 90),
         sum(outstanding)
    from open_bills o join public.vendors v on v.id = o.vendor_id
   where outstanding > 0
   group by v.id
   order by v.name;
$$;

create function public.fin_ar_aging(p_as_of date)
returns table (customer_id uuid, customer text, current_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric)
language sql stable security invoker set search_path = '' as $$
  with open_inv as (
    select i.customer_id, i.due_date,
           i.total - coalesce((select sum(a.amount) from public.receipt_allocations a
                                join public.customer_receipts r on r.id = a.receipt_id and r.status = 'posted' and r.receipt_date <= p_as_of
                               where a.invoice_id = i.id), 0) as outstanding
      from public.invoices i
     where i.status = 'posted' and i.invoice_date <= p_as_of
  )
  select c.id, c.name,
         sum(outstanding) filter (where p_as_of <= due_date),
         sum(outstanding) filter (where p_as_of - due_date between 1 and 30),
         sum(outstanding) filter (where p_as_of - due_date between 31 and 60),
         sum(outstanding) filter (where p_as_of - due_date between 61 and 90),
         sum(outstanding) filter (where p_as_of - due_date > 90),
         sum(outstanding)
    from open_inv o join public.customers c on c.id = o.customer_id
   where outstanding > 0
   group by c.id
   order by c.name;
$$;

create function public.fin_budget_vs_actual(p_budget uuid, p_from date, p_to date)
returns table (code text, name text, account_type public.account_type, cost_center text, budget numeric, actual numeric, variance numeric)
language sql stable security invoker set search_path = '' as $$
  with bl as (
    select account_id, cost_center_id, sum(amount) as budget
      from public.budget_lines
     where budget_id = p_budget and period_start between date_trunc('month', p_from)::date and p_to
     group by account_id, cost_center_id
  ),
  act as (
    select bl.account_id, bl.cost_center_id,
           coalesce(sum(case when a.account_type = 'revenue' then l.credit - l.debit else l.debit - l.credit end), 0) as actual
      from bl
      join public.chart_of_accounts a on a.id = bl.account_id
      left join public.journal_entry_lines l on l.account_id = bl.account_id
        and (bl.cost_center_id is null or l.cost_center_id = bl.cost_center_id)
      left join public.journal_entries e on e.id = l.journal_entry_id
     where l.id is null or (e.status in ('posted', 'reversed') and e.entry_date between p_from and p_to)
     group by bl.account_id, bl.cost_center_id
  )
  select a.code, a.name, a.account_type, cc.code, bl.budget, coalesce(act.actual, 0),
         case when a.account_type = 'revenue' then coalesce(act.actual, 0) - bl.budget else bl.budget - coalesce(act.actual, 0) end
    from bl
    join public.chart_of_accounts a on a.id = bl.account_id
    left join public.cost_centers cc on cc.id = bl.cost_center_id
    left join act on act.account_id = bl.account_id and act.cost_center_id is not distinct from bl.cost_center_id
   order by a.code, cc.code;
$$;

-- ---------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'fiscal_periods', 'taxes', 'vendors', 'customers', 'bank_accounts', 'bills', 'bill_lines', 'vendor_payments',
    'payment_allocations', 'invoices', 'invoice_lines', 'customer_receipts', 'receipt_allocations',
    'bank_statement_lines', 'bank_reconciliations', 'budgets', 'budget_lines'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit()',
                   t || '_audit', t);
  end loop;
end $$;
-- fiscal_periods has no id column: the audit record_id falls back to null; old/new rows carry period_start.

-- ---------------------------------------------------------------------
-- RLS: Finance CRUD (drafts), HR/Executive/Auditor read (matrix: Finance module).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'fiscal_periods', 'taxes', 'vendors', 'customers', 'bank_accounts', 'bills', 'bill_lines', 'vendor_payments',
    'payment_allocations', 'invoices', 'invoice_lines', 'customer_receipts', 'receipt_allocations',
    'bank_statement_lines', 'bank_reconciliations', 'budgets', 'budget_lines'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s: read" on public.%I for select to authenticated using ((select private.can_read_payroll()))', t, t);
  end loop;
  foreach t in array array[
    'taxes', 'vendors', 'customers', 'bank_accounts', 'bills', 'bill_lines', 'vendor_payments',
    'payment_allocations', 'invoices', 'invoice_lines', 'customer_receipts', 'receipt_allocations',
    'bank_statement_lines', 'bank_reconciliations', 'budgets', 'budget_lines'
  ] loop
    execute format('create policy "%s: finance insert" on public.%I for insert to authenticated with check ((select private.is_finance()))', t, t);
    execute format('create policy "%s: finance update" on public.%I for update to authenticated using ((select private.is_finance())) with check ((select private.is_finance()))', t, t);
    execute format('create policy "%s: finance delete" on public.%I for delete to authenticated using ((select private.is_finance()))', t, t);
  end loop;
end $$;

-- Manual journals: Finance drafts them directly; posting/reversal via functions.
create policy "je: finance draft insert" on public.journal_entries for insert to authenticated
  with check ((select private.is_finance()) and source = 'manual' and status = 'draft');
create policy "je: finance draft update" on public.journal_entries for update to authenticated
  using ((select private.is_finance()) and status = 'draft' and source = 'manual')
  with check ((select private.is_finance()) and status = 'draft' and source = 'manual');
create policy "je: finance draft delete" on public.journal_entries for delete to authenticated
  using ((select private.is_finance()) and status = 'draft' and source = 'manual');
create policy "jel: finance draft insert" on public.journal_entry_lines for insert to authenticated
  with check ((select private.is_finance()) and exists (
    select 1 from public.journal_entries e where e.id = journal_entry_id and e.status = 'draft' and e.source = 'manual'));
create policy "jel: finance draft delete" on public.journal_entry_lines for delete to authenticated
  using ((select private.is_finance()) and exists (
    select 1 from public.journal_entries e where e.id = journal_entry_id and e.status = 'draft' and e.source = 'manual'));

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on public.fiscal_periods, public.taxes, public.vendors, public.customers, public.bank_accounts, public.bills,
  public.bill_lines, public.vendor_payments, public.payment_allocations, public.invoices, public.invoice_lines,
  public.customer_receipts, public.receipt_allocations, public.bank_statement_lines, public.bank_reconciliations,
  public.budgets, public.budget_lines from anon, authenticated;
revoke all on sequence public.ap_payment_no_seq, public.ar_invoice_no_seq, public.ar_receipt_no_seq, public.ap_bill_ref_seq from anon;
grant usage on sequence public.ap_payment_no_seq, public.ar_invoice_no_seq, public.ar_receipt_no_seq, public.ap_bill_ref_seq,
  public.journal_entry_no_seq to authenticated;

grant select on public.fiscal_periods to authenticated;
grant select, insert, update, delete on public.taxes, public.vendors, public.customers, public.bank_accounts, public.bills,
  public.bill_lines, public.vendor_payments, public.payment_allocations, public.invoices, public.invoice_lines,
  public.customer_receipts, public.receipt_allocations, public.bank_statement_lines, public.bank_reconciliations,
  public.budgets, public.budget_lines to authenticated;
grant insert, update, delete on public.journal_entries to authenticated;
grant insert, delete on public.journal_entry_lines to authenticated;
-- Statement matching is done through functions only.
revoke update on public.bank_statement_lines from authenticated;
grant update (description, reference) on public.bank_statement_lines to authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_any_role(public.app_role[]), private.is_hr(), private.current_employee_id(), private.can_see_team(uuid),
  private.is_payroll(), private.is_finance(), private.can_read_payroll(), private.payroll_released(uuid),
  private.tax_year_of(date)
to authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.link_auth_user() to supabase_auth_admin;

do $$
declare f text;
begin
  foreach f in array array[
    'public.fin_post_manual_journal(uuid)', 'public.fin_reverse_journal(uuid, date, text)', 'public.fin_post_bill(uuid)',
    'public.fin_post_vendor_payment(uuid)', 'public.fin_post_invoice(uuid)', 'public.fin_post_receipt(uuid)',
    'public.fin_set_period_status(date, text)', 'public.fin_open_fiscal_year(integer)', 'public.fin_approve_budget(uuid)',
    'public.fin_auto_match(uuid)', 'public.fin_match_statement_line(uuid, uuid)', 'public.fin_ignore_statement_line(uuid, boolean)',
    'public.fin_unmatched_book_lines(uuid, date)', 'public.fin_reconciliation_summary(uuid, date, numeric)',
    'public.fin_profit_and_loss(date, date, uuid)', 'public.fin_balance_sheet(date)', 'public.fin_account_ledger(uuid, date, date)',
    'public.fin_cash_flow(date, date)', 'public.fin_ap_aging(date)', 'public.fin_ar_aging(date)',
    'public.fin_budget_vs_actual(uuid, date, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- =====================================================================
-- Payroll (BRD 6.7 PAY-01..11, 7.5, 7.9) + GL core (FIN-01..03, FIN-12)
-- Salary setup → monthly run (draft → review → approved → posted → paid)
-- → payslips → balanced journal entry posted to the general ledger.
-- Loans (6.11, basic) and Full & Final settlement (PAY-09, 7.6).
-- =====================================================================

create type public.account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');
create type public.journal_status as enum ('draft', 'posted', 'reversed');
create type public.payroll_status as enum ('draft', 'review', 'approved', 'posted', 'paid');
create type public.component_kind as enum ('earning', 'deduction');
create type public.calc_type as enum ('fixed', 'percent_of_basic');

-- ---------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------
create function private.is_payroll() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_any_role(array['hr_admin', 'finance', 'system_admin']::public.app_role[]);
$$;

create function private.is_finance() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_any_role(array['finance', 'system_admin']::public.app_role[]);
$$;

create function private.can_read_payroll() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_any_role(array['hr_admin', 'finance', 'system_admin', 'executive', 'auditor']::public.app_role[]);
$$;

-- ---------------------------------------------------------------------
-- General ledger core
-- ---------------------------------------------------------------------
create table public.chart_of_accounts (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  account_type  public.account_type not null,
  parent_id     uuid references public.chart_of_accounts (id),
  is_postable   boolean not null default true,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create sequence public.journal_entry_no_seq;

create table public.journal_entries (
  id           uuid primary key default gen_random_uuid(),
  entry_no     text not null unique default ('JE-' || lpad(nextval('public.journal_entry_no_seq')::text, 6, '0')),
  entry_date   date not null,
  description  text not null,
  source       text not null default 'manual' check (source in ('manual', 'payroll', 'payroll_payment', 'loan', 'fnf')),
  source_id    uuid,
  status       public.journal_status not null default 'draft',
  posted_at    timestamptz,
  posted_by    uuid,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index journal_entries_date_idx on public.journal_entries (entry_date, status);
create index journal_entries_source_idx on public.journal_entries (source, source_id);

create table public.journal_entry_lines (
  id                uuid primary key default gen_random_uuid(),
  journal_entry_id  uuid not null references public.journal_entries (id) on delete cascade,
  account_id        uuid not null references public.chart_of_accounts (id),
  cost_center_id    uuid references public.cost_centers (id),
  debit             numeric(16, 2) not null default 0 check (debit >= 0),
  credit            numeric(16, 2) not null default 0 check (credit >= 0),
  description       text,
  check ((debit = 0) <> (credit = 0))
);
create index jel_entry_idx on public.journal_entry_lines (journal_entry_id);
create index jel_account_idx on public.journal_entry_lines (account_id);

create function private.account_id(p_code text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare a uuid;
begin
  select id into a from public.chart_of_accounts where code = p_code and is_active and is_postable;
  if a is null then
    raise exception 'GL account % is missing or inactive.', p_code;
  end if;
  return a;
end $$;

-- Double-entry validation at posting time (FIN-03; 13.5 note 6).
create function private.post_journal(p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  dr numeric;
  cr numeric;
  n  integer;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into dr, cr, n
    from public.journal_entry_lines where journal_entry_id = p_entry;
  if n < 2 then
    raise exception 'A journal entry needs at least two lines.';
  end if;
  if dr <> cr then
    raise exception 'Journal entry is not balanced: debits % ≠ credits %.', dr, cr;
  end if;
  update public.journal_entries
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_entry and status = 'draft';
end $$;

-- Posted entries are immutable (FIN-12): corrections are reversing entries.
create function private.journal_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Posted journal entries cannot be deleted.';
    end if;
    return old;
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

create trigger journal_entries_guard
  before update or delete on public.journal_entries
  for each row execute function private.journal_guard();

create function private.journal_line_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.journal_entries
    where id = coalesce(new.journal_entry_id, old.journal_entry_id) and status <> 'draft'
  ) then
    raise exception 'Lines of a posted journal entry cannot be changed.';
  end if;
  return coalesce(new, old);
end $$;

create trigger journal_lines_guard
  before insert or update or delete on public.journal_entry_lines
  for each row execute function private.journal_line_guard();

-- ---------------------------------------------------------------------
-- Statutory configuration (effective-dated; NFR-25 "configurable engine")
-- ---------------------------------------------------------------------
create table public.tax_slabs (
  id           uuid primary key default gen_random_uuid(),
  tax_year     integer not null,           -- e.g. 2027 = 1 Jul 2026 – 30 Jun 2027
  lower_limit  numeric(14, 2) not null,    -- exclusive
  upper_limit  numeric(14, 2),             -- inclusive; null = no upper limit
  fixed_tax    numeric(14, 2) not null default 0,
  rate_pct     numeric(5, 2) not null check (rate_pct between 0 and 100),
  unique (tax_year, lower_limit),
  check (upper_limit is null or upper_limit > lower_limit)
);

create table public.tax_surcharges (
  tax_year         integer primary key,
  threshold        numeric(14, 2) not null,
  surcharge_pct    numeric(5, 2) not null
);

create table public.statutory_rates (
  id                   uuid primary key default gen_random_uuid(),
  effective_from       date not null unique,
  eobi_wage_base       numeric(12, 2) not null,  -- minimum wage EOBI is computed on
  eobi_employee_pct    numeric(5, 2) not null default 1,
  eobi_employer_pct    numeric(5, 2) not null default 5,
  pessi_wage_base      numeric(12, 2) not null,
  pessi_employer_pct   numeric(5, 2) not null default 6,
  ot_multiplier        numeric(4, 2) not null default 2,
  ot_basis_hours       numeric(6, 2) not null default 208, -- monthly hours for the hourly rate
  notes                text,
  created_at           timestamptz not null default now()
);

create function private.tax_year_of(d date) returns integer
language sql immutable set search_path = '' as $$
  select (extract(year from d) + case when extract(month from d) >= 7 then 1 else 0 end)::int;
$$;

create function private.annual_tax(p_tax_year integer, p_income numeric) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  s    public.tax_slabs;
  tax  numeric := 0;
  sur  public.tax_surcharges;
begin
  if p_income <= 0 then return 0; end if;
  select * into s from public.tax_slabs
   where tax_year = p_tax_year and p_income > lower_limit and (upper_limit is null or p_income <= upper_limit)
   order by lower_limit desc limit 1;
  if s.id is null then
    if not exists (select 1 from public.tax_slabs where tax_year = p_tax_year) then
      raise exception 'No income tax slabs configured for tax year %.', p_tax_year;
    end if;
    return 0;
  end if;
  tax := s.fixed_tax + (p_income - s.lower_limit) * s.rate_pct / 100;
  select * into sur from public.tax_surcharges where tax_year = p_tax_year;
  if sur.tax_year is not null and p_income > sur.threshold then
    tax := tax * (1 + sur.surcharge_pct / 100);
  end if;
  return round(tax, 2);
end $$;

-- ---------------------------------------------------------------------
-- Salary setup (PAY-01)
-- ---------------------------------------------------------------------
create table public.salary_components (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  kind        public.component_kind not null,
  is_taxable  boolean not null default true,
  is_system   boolean not null default false, -- BASIC / OT / LOAN are computed, not configured
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.salary_structures (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.salary_structure_components (
  id            uuid primary key default gen_random_uuid(),
  structure_id  uuid not null references public.salary_structures (id) on delete cascade,
  component_id  uuid not null references public.salary_components (id),
  calc_type     public.calc_type not null,
  value         numeric(14, 2) not null check (value >= 0),
  unique (structure_id, component_id)
);

create table public.employee_salaries (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.employees (id) on delete cascade,
  effective_from       date not null,
  structure_id         uuid references public.salary_structures (id),
  basic_salary         numeric(14, 2) not null check (basic_salary >= 0),
  overtime_eligible    boolean not null default true,
  eobi_covered         boolean not null default true,
  pessi_covered        boolean not null default false,
  pf_member            boolean not null default false,
  pf_pct               numeric(5, 2) not null default 8.33 check (pf_pct between 0 and 20),
  vps_employee_pct     numeric(5, 2) not null default 0 check (vps_employee_pct between 0 and 50),
  vps_employer_pct     numeric(5, 2) not null default 0 check (vps_employer_pct between 0 and 50),
  payment_mode         text not null default 'bank' check (payment_mode in ('bank', 'cash', 'cheque')),
  notes                text,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  unique (employee_id, effective_from)
);

-- Per-employee fixed allowances/deductions that override or extend the structure.
create table public.employee_salary_components (
  id                  uuid primary key default gen_random_uuid(),
  employee_salary_id  uuid not null references public.employee_salaries (id) on delete cascade,
  component_id        uuid not null references public.salary_components (id),
  calc_type           public.calc_type not null default 'fixed',
  value               numeric(14, 2) not null check (value >= 0),
  unique (employee_salary_id, component_id)
);

-- ---------------------------------------------------------------------
-- Loans & advances (6.11, basic: HR records, payroll recovers)
-- ---------------------------------------------------------------------
create table public.loans (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete cascade,
  loan_type           text not null default 'loan' check (loan_type in ('loan', 'advance')),
  principal           numeric(14, 2) not null check (principal > 0),
  installment_amount  numeric(14, 2) not null check (installment_amount > 0),
  balance             numeric(14, 2) not null,
  start_month         date not null check (extract(day from start_month) = 1),
  status              text not null default 'active' check (status in ('active', 'closed')),
  purpose             text,
  disbursed_on        date not null default current_date,
  journal_entry_id    uuid references public.journal_entries (id),
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  check (installment_amount <= principal),
  check (balance between 0 and principal)
);
create index loans_employee_idx on public.loans (employee_id, status);

-- ---------------------------------------------------------------------
-- Payroll runs & payslips (PAY-02..07, PAY-10, PAY-11)
-- ---------------------------------------------------------------------
create table public.payroll_runs (
  id                uuid primary key default gen_random_uuid(),
  period_month      date not null check (extract(day from period_month) = 1),
  tax_year          integer not null,
  is_parallel       boolean not null default false, -- validation run against legacy payroll; never posted
  status            public.payroll_status not null default 'draft',
  employee_count    integer not null default 0,
  total_gross       numeric(16, 2) not null default 0,
  total_deductions  numeric(16, 2) not null default 0,
  total_net         numeric(16, 2) not null default 0,
  total_tax         numeric(16, 2) not null default 0,
  total_employer    numeric(16, 2) not null default 0,
  processed_at      timestamptz,
  processed_by      uuid,
  submitted_at      timestamptz,
  submitted_by      uuid,
  approved_at       timestamptz,
  approved_by       uuid,
  posted_at         timestamptz,
  posted_by         uuid,
  paid_at           timestamptz,
  paid_by           uuid,
  journal_entry_id  uuid references public.journal_entries (id),
  payment_entry_id  uuid references public.journal_entries (id),
  notes             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now()
);
create unique index payroll_one_regular_run_per_month on public.payroll_runs (period_month) where not is_parallel;

create table public.payslips (
  id                 uuid primary key default gen_random_uuid(),
  payroll_run_id     uuid not null references public.payroll_runs (id) on delete cascade,
  employee_id        uuid not null references public.employees (id),
  employee_code      text not null,
  employee_name      text not null,
  department_id      uuid references public.departments (id),
  department_name    text,
  position_title     text,
  cnic               text,
  bank_name          text,
  account_title      text,
  iban               text,
  payment_mode       text not null default 'bank',
  days_in_month      integer not null,
  employed_days      integer not null,
  unpaid_days        numeric(5, 1) not null default 0,
  payable_days       numeric(5, 1) not null,
  overtime_hours     numeric(7, 2) not null default 0,
  basic_salary       numeric(14, 2) not null default 0,
  gross_pay          numeric(14, 2) not null default 0,
  overtime_amount    numeric(14, 2) not null default 0,
  taxable_income     numeric(14, 2) not null default 0,
  income_tax         numeric(14, 2) not null default 0,
  projected_annual_taxable numeric(16, 2) not null default 0,
  projected_annual_tax     numeric(16, 2) not null default 0,
  eobi_employee      numeric(12, 2) not null default 0,
  eobi_employer      numeric(12, 2) not null default 0,
  pessi_employer     numeric(12, 2) not null default 0,
  pf_employee        numeric(12, 2) not null default 0,
  pf_employer        numeric(12, 2) not null default 0,
  vps_employee       numeric(12, 2) not null default 0,
  vps_employer       numeric(12, 2) not null default 0,
  loan_deduction     numeric(14, 2) not null default 0,
  other_deductions   numeric(14, 2) not null default 0,
  total_deductions   numeric(14, 2) not null default 0,
  net_pay            numeric(14, 2) not null default 0,
  warnings           text[] not null default '{}',
  created_at         timestamptz not null default now(),
  unique (payroll_run_id, employee_id)
);
create index payslips_employee_idx on public.payslips (employee_id);

create table public.payslip_lines (
  id           uuid primary key default gen_random_uuid(),
  payslip_id   uuid not null references public.payslips (id) on delete cascade,
  code         text not null,
  name         text not null,
  kind         public.component_kind not null,
  amount       numeric(14, 2) not null,
  is_taxable   boolean not null default false,
  loan_id      uuid references public.loans (id),
  sort_order   integer not null default 100
);
create index payslip_lines_slip_idx on public.payslip_lines (payslip_id);

create table public.loan_repayments (
  id          uuid primary key default gen_random_uuid(),
  loan_id     uuid not null references public.loans (id) on delete cascade,
  payslip_id  uuid references public.payslips (id),
  fnf_id      uuid,
  amount      numeric(14, 2) not null check (amount > 0),
  repaid_on   date not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Full & Final settlement (PAY-09, 7.6)
-- ---------------------------------------------------------------------
create table public.fnf_settlements (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null unique references public.employees (id),
  exit_date            date not null,
  basic_salary         numeric(14, 2) not null,
  leave_days_encashed  numeric(5, 1) not null default 0 check (leave_days_encashed >= 0),
  leave_encashment     numeric(14, 2) not null default 0 check (leave_encashment >= 0),
  gratuity             numeric(14, 2) not null default 0 check (gratuity >= 0),
  other_additions      numeric(14, 2) not null default 0 check (other_additions >= 0),
  loan_recovery        numeric(14, 2) not null default 0 check (loan_recovery >= 0),
  other_deductions     numeric(14, 2) not null default 0 check (other_deductions >= 0),
  net_amount           numeric(14, 2) generated always as
                         (leave_encashment + gratuity + other_additions - loan_recovery - other_deductions) stored,
  notes                text,
  status               text not null default 'draft' check (status in ('draft', 'approved')),
  prepared_by          uuid default auth.uid(),
  approved_by          uuid,
  approved_at          timestamptz,
  journal_entry_id     uuid references public.journal_entries (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.loan_repayments add constraint loan_repayments_fnf_fk foreign key (fnf_id) references public.fnf_settlements (id);

create function private.fnf_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'approved' then
    raise exception 'An approved settlement cannot be changed.';
  end if;
  if new.status = 'approved' and coalesce(current_setting('app.fnf_approving', true), '') <> 'on' then
    raise exception 'Use the approval action to approve a settlement.';
  end if;
  return new;
end $$;

create trigger fnf_guard before update on public.fnf_settlements
  for each row execute function private.fnf_guard();
create trigger fnf_updated_at before update on public.fnf_settlements
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Calculation (PAY-02, PAY-03, PAY-04)
-- ---------------------------------------------------------------------
create function private.payroll_calc_employee(p_run public.payroll_runs, p_emp uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m_start      date := p_run.period_month;
  m_end        date := (p_run.period_month + interval '1 month' - interval '1 day')::date;
  d_in_month   integer := extract(day from (p_run.period_month + interval '1 month' - interval '1 day'))::int;
  emp          public.employees;
  priv         public.employee_private;
  sal          public.employee_salaries;
  st           public.statutory_rates;
  dept         public.departments;
  pos_title    text;
  emp_from     date;
  emp_to       date;
  employed     integer;
  absent_d     numeric := 0;
  half_d       numeric := 0;
  missing_d    integer := 0;
  unpaid_lv    numeric := 0;
  unpaid       numeric;
  payable      numeric;
  factor       numeric;
  ot_min       integer := 0;
  ot_amt       numeric := 0;
  basic_m      numeric;
  gross        numeric := 0;
  taxable      numeric := 0;
  other_ded    numeric := 0;
  amt          numeric;
  ty           integer;
  months_left  integer;
  ytd_taxable  numeric;
  ytd_tax      numeric;
  projected    numeric;
  annual       numeric;
  tax          numeric;
  eobi_ee      numeric := 0;
  eobi_er      numeric := 0;
  pessi_er     numeric := 0;
  pf_ee        numeric := 0;
  pf_er        numeric := 0;
  vps_ee       numeric := 0;
  vps_er       numeric := 0;
  loan_total   numeric := 0;
  total_ded    numeric;
  exiting      boolean;
  warn         text[] := '{}';
  slip         uuid;
  c            record;
  l            record;
begin
  select * into emp from public.employees where id = p_emp;
  select * into sal from public.employee_salaries
   where employee_id = p_emp and effective_from <= m_end order by effective_from desc limit 1;
  if sal.id is null then
    return; -- no salary set up: not on payroll
  end if;
  select * into st from public.statutory_rates where effective_from <= m_end order by effective_from desc limit 1;
  if st.id is null then
    raise exception 'No statutory rates configured for %.', to_char(m_start, 'Mon YYYY');
  end if;

  emp_from := greatest(m_start, coalesce(emp.joining_date, m_start));
  emp_to := least(m_end, coalesce(emp.exit_date, m_end));
  if emp_to < emp_from then
    return;
  end if;
  employed := emp_to - emp_from + 1;
  exiting := emp.exit_date is not null and emp.exit_date <= m_end;

  -- Attendance & unpaid leave (ATT-10, LV-07)
  select count(*) filter (where status = 'absent'),
         count(*) filter (where status = 'half_day'),
         count(*) filter (where status = 'missing_punch'),
         coalesce(sum(overtime_minutes), 0)
    into absent_d, half_d, missing_d, ot_min
    from public.attendance
   where employee_id = p_emp and work_date between emp_from and emp_to;
  select coalesce(sum(case when r.half_day then 0.5
                      else private.leave_days(greatest(r.start_date, emp_from), least(r.end_date, emp_to), emp.location_id) end), 0)
    into unpaid_lv
    from public.leave_requests r join public.leave_types t on t.id = r.leave_type_id
   where r.employee_id = p_emp and r.status = 'approved' and not t.is_paid
     and r.start_date <= emp_to and r.end_date >= emp_from;
  unpaid := absent_d + half_d * 0.5 + unpaid_lv;
  payable := greatest(0, employed - unpaid);
  factor := payable / d_in_month;
  if missing_d > 0 then
    warn := array_append(warn, missing_d || ' day(s) with a missing punch were paid in full — regularize if needed');
  end if;
  if employed < d_in_month then
    warn := array_append(warn, 'Prorated: employed ' || employed || ' of ' || d_in_month || ' days');
  end if;

  select * into priv from public.employee_private where employee_id = p_emp;
  select * into dept from public.departments where id = emp.department_id;
  select title into pos_title from public.positions where id = emp.position_id;

  insert into public.payslips (
    payroll_run_id, employee_id, employee_code, employee_name, department_id, department_name, position_title,
    cnic, bank_name, account_title, iban, payment_mode, days_in_month, employed_days, unpaid_days, payable_days
  ) values (
    p_run.id, p_emp, emp.employee_code, emp.full_name, emp.department_id, dept.name, pos_title,
    priv.cnic, priv.bank_name, priv.account_title, priv.iban, sal.payment_mode, d_in_month, employed, unpaid, payable
  ) returning id into slip;

  -- Earnings: basic + structure components (+ employee overrides), prorated
  basic_m := round(sal.basic_salary * factor);
  insert into public.payslip_lines (payslip_id, code, name, kind, amount, is_taxable, sort_order)
  values (slip, 'BASIC', 'Basic Salary', 'earning', basic_m, true, 1);
  gross := basic_m;
  taxable := basic_m;

  for c in
    select sc2.code, sc2.name, sc2.kind, sc2.is_taxable, sc2.sort_order,
           coalesce(o.calc_type, s.calc_type) as calc_type,
           coalesce(o.value, s.value) as value
      from public.salary_components sc2
      left join public.salary_structure_components s on s.component_id = sc2.id and s.structure_id = sal.structure_id
      left join public.employee_salary_components o on o.component_id = sc2.id and o.employee_salary_id = sal.id
     where sc2.is_active and not sc2.is_system and (s.id is not null or o.id is not null)
     order by sc2.sort_order
  loop
    amt := round((case when c.calc_type = 'percent_of_basic' then sal.basic_salary * c.value / 100 else c.value end) * factor);
    if amt = 0 then continue; end if;
    insert into public.payslip_lines (payslip_id, code, name, kind, amount, is_taxable, sort_order)
    values (slip, c.code, c.name, c.kind, amt, c.is_taxable, c.sort_order);
    if c.kind = 'earning' then
      gross := gross + amt;
      if c.is_taxable then taxable := taxable + amt; end if;
    else
      other_ded := other_ded + amt;
    end if;
  end loop;

  -- Overtime (ATT-03): basic / basis hours × multiplier
  if sal.overtime_eligible and ot_min > 0 then
    ot_amt := round(sal.basic_salary / st.ot_basis_hours * st.ot_multiplier * ot_min / 60.0);
    insert into public.payslip_lines (payslip_id, code, name, kind, amount, is_taxable, sort_order)
    values (slip, 'OT', 'Overtime (' || round(ot_min / 60.0, 1) || ' h)', 'earning', ot_amt, true, 50);
    gross := gross + ot_amt;
    taxable := taxable + ot_amt;
  end if;

  -- Statutory (PAY-03)
  if sal.eobi_covered then
    eobi_ee := round(st.eobi_wage_base * st.eobi_employee_pct / 100);
    eobi_er := round(st.eobi_wage_base * st.eobi_employer_pct / 100);
  end if;
  if sal.pessi_covered then
    pessi_er := round(st.pessi_wage_base * st.pessi_employer_pct / 100);
  end if;
  if sal.pf_member then
    pf_ee := round(basic_m * sal.pf_pct / 100);
    pf_er := pf_ee;
  end if;
  vps_ee := round(gross * sal.vps_employee_pct / 100);
  vps_er := round(gross * sal.vps_employer_pct / 100);

  -- Income tax: annualised projection, spread over the remaining months of the tax year.
  ty := p_run.tax_year;
  months_left := (ty * 12 + 6) - (extract(year from m_start)::int * 12 + extract(month from m_start)::int) + 1;
  select coalesce(sum(p.taxable_income), 0), coalesce(sum(p.income_tax), 0)
    into ytd_taxable, ytd_tax
    from public.payslips p join public.payroll_runs r on r.id = p.payroll_run_id
   where p.employee_id = p_emp and r.tax_year = ty and not r.is_parallel
     and r.status in ('posted', 'paid') and r.period_month < m_start;
  if exiting then
    projected := ytd_taxable + taxable; -- final month: settle the year's tax now
    months_left := 1;
  else
    projected := ytd_taxable + taxable * months_left;
  end if;
  annual := private.annual_tax(ty, projected);
  tax := greatest(0, round((annual - ytd_tax) / months_left));

  -- Loan / advance recovery (LN-03); everything outstanding on exit
  for l in
    select id, installment_amount, balance, loan_type from public.loans
     where employee_id = p_emp and status = 'active' and start_month <= m_start and balance > 0
     order by created_at
  loop
    amt := case when exiting then l.balance else least(l.installment_amount, l.balance) end;
    insert into public.payslip_lines (payslip_id, code, name, kind, amount, is_taxable, loan_id, sort_order)
    values (slip, 'LOAN', case when l.loan_type = 'advance' then 'Advance recovery' else 'Loan installment' end,
            'deduction', amt, false, l.id, 80);
    loan_total := loan_total + amt;
  end loop;

  total_ded := tax + eobi_ee + pf_ee + vps_ee + loan_total + other_ded;
  if gross - total_ded < 0 then
    warn := array_append(warn, 'Deductions exceed gross pay — net is negative; reduce loan recovery before approval');
  end if;

  update public.payslips set
    overtime_hours = round(ot_min / 60.0, 2),
    basic_salary = basic_m,
    gross_pay = gross,
    overtime_amount = ot_amt,
    taxable_income = taxable,
    income_tax = tax,
    projected_annual_taxable = projected,
    projected_annual_tax = annual,
    eobi_employee = eobi_ee,
    eobi_employer = eobi_er,
    pessi_employer = pessi_er,
    pf_employee = pf_ee,
    pf_employer = pf_er,
    vps_employee = vps_ee,
    vps_employer = vps_er,
    loan_deduction = loan_total,
    other_deductions = other_ded,
    total_deductions = total_ded,
    net_pay = gross - total_ded,
    warnings = warn
  where id = slip;
end $$;

-- ---------------------------------------------------------------------
-- Run lifecycle (PAY-05). All writes go through these functions.
-- ---------------------------------------------------------------------
create function public.payroll_create_run(p_month date, p_parallel boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r uuid;
  m date := date_trunc('month', p_month)::date;
begin
  if not private.is_payroll() then
    raise exception 'Only HR or Finance can create payroll runs.' using errcode = '42501';
  end if;
  insert into public.payroll_runs (period_month, tax_year, is_parallel)
  values (m, private.tax_year_of(m), coalesce(p_parallel, false))
  returning id into r;
  return r;
exception when unique_violation then
  raise exception 'A payroll run for % already exists.', to_char(m, 'Mon YYYY');
end $$;

create function public.payroll_process_run(p_run uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  run  public.payroll_runs;
  e    record;
  m_end date;
begin
  if not private.is_payroll() then
    raise exception 'Only HR or Finance can process payroll.' using errcode = '42501';
  end if;
  select * into run from public.payroll_runs where id = p_run for update;
  if run.id is null then raise exception 'Payroll run not found.'; end if;
  if run.status <> 'draft' then
    raise exception 'Only draft runs can be (re)processed. Return it to draft first.';
  end if;
  m_end := (run.period_month + interval '1 month' - interval '1 day')::date;

  delete from public.payslips where payroll_run_id = p_run;
  for e in
    select id from public.employees
     where deleted_at is null and status <> 'draft'
       and (joining_date is null or joining_date <= m_end)
       and (exit_date is null or exit_date >= run.period_month)
     order by employee_code
  loop
    perform private.payroll_calc_employee(run, e.id);
  end loop;

  update public.payroll_runs r set
    employee_count = s.n, total_gross = s.gross, total_deductions = s.ded, total_net = s.net,
    total_tax = s.tax, total_employer = s.er, processed_at = now(), processed_by = auth.uid()
  from (
    select count(*)::int n, coalesce(sum(gross_pay), 0) gross, coalesce(sum(total_deductions), 0) ded,
           coalesce(sum(net_pay), 0) net, coalesce(sum(income_tax), 0) tax,
           coalesce(sum(eobi_employer + pessi_employer + pf_employer + vps_employer), 0) er
      from public.payslips where payroll_run_id = p_run
  ) s
  where r.id = p_run;
  return (select employee_count from public.payroll_runs where id = p_run);
end $$;

-- Posting (7.9 + BRD 7.10 corrections): employer contributions expensed; loans credit the asset.
create function private.payroll_post(run public.payroll_runs) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  je uuid;
  t  record;
begin
  insert into public.journal_entries (entry_date, description, source, source_id)
  values ((run.period_month + interval '1 month' - interval '1 day')::date,
          'Payroll ' || to_char(run.period_month, 'Mon YYYY'), 'payroll', run.id)
  returning id into je;

  -- Salary and overtime expense, split by department cost center (FIN-09)
  insert into public.journal_entry_lines (journal_entry_id, account_id, cost_center_id, debit, description)
  select je, private.account_id('5110'), d.cost_center_id, sum(p.gross_pay - p.overtime_amount), 'Salaries & allowances'
    from public.payslips p left join public.departments d on d.id = p.department_id
   where p.payroll_run_id = run.id
   group by d.cost_center_id having sum(p.gross_pay - p.overtime_amount) > 0;
  insert into public.journal_entry_lines (journal_entry_id, account_id, cost_center_id, debit, description)
  select je, private.account_id('5120'), d.cost_center_id, sum(p.overtime_amount), 'Overtime'
    from public.payslips p left join public.departments d on d.id = p.department_id
   where p.payroll_run_id = run.id
   group by d.cost_center_id having sum(p.overtime_amount) > 0;

  select coalesce(sum(net_pay), 0) net, coalesce(sum(income_tax), 0) tax,
         coalesce(sum(eobi_employee), 0) eobi_ee, coalesce(sum(eobi_employer), 0) eobi_er,
         coalesce(sum(pessi_employer), 0) pessi_er,
         coalesce(sum(pf_employee), 0) pf_ee, coalesce(sum(pf_employer), 0) pf_er,
         coalesce(sum(vps_employee), 0) vps_ee, coalesce(sum(vps_employer), 0) vps_er,
         coalesce(sum(loan_deduction), 0) loans, coalesce(sum(other_deductions), 0) other
    into t from public.payslips where payroll_run_id = run.id;

  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  select je, private.account_id(code), dr, cr, label
    from (values
      ('5130', t.eobi_er, 0::numeric, 'EOBI — employer'),
      ('5140', t.pessi_er, 0, 'PESSI — employer'),
      ('5150', t.pf_er, 0, 'Provident fund — employer'),
      ('5160', t.vps_er, 0, 'VPS — employer'),
      ('2110', 0, t.net, 'Net salaries payable'),
      ('2120', 0, t.tax, 'Income tax withheld'),
      ('2130', 0, t.eobi_ee + t.eobi_er, 'EOBI payable'),
      ('2140', 0, t.pessi_er, 'PESSI payable'),
      ('2150', 0, t.pf_ee + t.pf_er, 'Provident fund payable'),
      ('2160', 0, t.vps_ee + t.vps_er, 'VPS payable'),
      ('1310', 0, t.loans, 'Loan & advance recoveries'),
      ('2190', 0, t.other, 'Other payroll deductions')
    ) as v (code, dr, cr, label)
   where dr > 0 or cr > 0;

  perform private.post_journal(je);

  -- Loan balances (LN-04)
  insert into public.loan_repayments (loan_id, payslip_id, amount, repaid_on)
  select pl.loan_id, pl.payslip_id, pl.amount, (run.period_month + interval '1 month' - interval '1 day')::date
    from public.payslip_lines pl join public.payslips p on p.id = pl.payslip_id
   where p.payroll_run_id = run.id and pl.loan_id is not null;
  update public.loans l set
    balance = l.balance - x.paid,
    status = case when l.balance - x.paid <= 0 then 'closed' else 'active' end
  from (
    select pl.loan_id, sum(pl.amount) paid
      from public.payslip_lines pl join public.payslips p on p.id = pl.payslip_id
     where p.payroll_run_id = run.id and pl.loan_id is not null
     group by pl.loan_id
  ) x
  where l.id = x.loan_id;
  perform set_config('app.loan_system', '', true);
  return je;
end $$;

create function public.payroll_transition(p_run uuid, p_to public.payroll_status, p_note text default null)
returns public.payroll_status
language plpgsql security definer set search_path = '' as $$
declare
  run  public.payroll_runs;
  je   uuid;
  me   uuid := auth.uid();
begin
  select * into run from public.payroll_runs where id = p_run for update;
  if run.id is null then raise exception 'Payroll run not found.'; end if;

  if run.status = 'draft' and p_to = 'review' then
    if not private.is_payroll() then raise exception 'Only HR or Finance can submit payroll.' using errcode = '42501'; end if;
    if run.processed_at is null or run.employee_count = 0 then raise exception 'Process the run before submitting it.'; end if;
    update public.payroll_runs set status = 'review', submitted_at = now(), submitted_by = me, notes = coalesce(p_note, notes) where id = p_run;

  elsif run.status = 'review' and p_to = 'draft' then
    if not private.is_payroll() then raise exception 'Only HR or Finance can return payroll to draft.' using errcode = '42501'; end if;
    update public.payroll_runs set status = 'draft', submitted_at = null, submitted_by = null, notes = coalesce(p_note, notes) where id = p_run;

  elsif run.status = 'review' and p_to = 'approved' then
    if not private.is_finance() then raise exception 'Only Finance can approve payroll.' using errcode = '42501'; end if;
    if run.is_parallel then raise exception 'Parallel (validation) runs cannot be approved or posted.'; end if;
    if me = run.submitted_by then
      raise exception 'Separation of duties: the person who submitted the payroll cannot approve it.' using errcode = '42501';
    end if;
    if exists (select 1 from public.payslips where payroll_run_id = p_run and net_pay < 0) then
      raise exception 'Some payslips have negative net pay. Fix them before approval.';
    end if;
    update public.payroll_runs set status = 'approved', approved_at = now(), approved_by = me where id = p_run;

  elsif run.status = 'approved' and p_to = 'posted' then
    if not private.is_finance() then raise exception 'Only Finance can post payroll to the ledger.' using errcode = '42501'; end if;
    je := private.payroll_post(run);
    update public.payroll_runs set status = 'posted', posted_at = now(), posted_by = me, journal_entry_id = je where id = p_run;

  elsif run.status = 'posted' and p_to = 'paid' then
    if not private.is_finance() then raise exception 'Only Finance can mark payroll as paid.' using errcode = '42501'; end if;
    insert into public.journal_entries (entry_date, description, source, source_id)
    values (current_date, 'Salary disbursement ' || to_char(run.period_month, 'Mon YYYY'), 'payroll_payment', run.id)
    returning id into je;
    insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
      (je, private.account_id('2110'), run.total_net, 0, 'Clear net salaries payable'),
      (je, private.account_id('1110'), 0, run.total_net, 'Paid from salary bank account');
    perform private.post_journal(je);
    update public.payroll_runs set status = 'paid', paid_at = now(), paid_by = me, payment_entry_id = je where id = p_run;

  else
    raise exception 'Cannot move a % payroll run to %.', run.status, p_to;
  end if;
  return p_to;
end $$;

-- Loan disbursement posts Dr Employee Loans & Advances / Cr Bank (LN-06).
create function private.loan_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare je uuid;
begin
  insert into public.journal_entries (entry_date, description, source, source_id)
  values (new.disbursed_on, initcap(new.loan_type) || ' disbursed to ' ||
          (select full_name || ' (' || employee_code || ')' from public.employees where id = new.employee_id), 'loan', new.id)
  returning id into je;
  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
    (je, private.account_id('1310'), new.principal, 0, 'Employee loans & advances'),
    (je, private.account_id('1110'), 0, new.principal, 'Paid from bank');
  perform private.post_journal(je);
  perform set_config('app.loan_system', 'on', true);
  update public.loans set journal_entry_id = je where id = new.id;
  perform set_config('app.loan_system', '', true);
  return null;
end $$;

create trigger loans_after_insert after insert on public.loans
  for each row execute function private.loan_after_insert();

create function private.loan_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.balance := new.principal;
  new.status := 'active';
  return new;
end $$;

create trigger loans_before_insert before insert on public.loans
  for each row execute function private.loan_before_insert();

-- Loans: only HR/Finance can record; amounts can't be edited once disbursed.
create function private.loan_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (new.principal, new.employee_id, new.balance, new.disbursed_on, new.journal_entry_id)
     is distinct from (old.principal, old.employee_id, old.balance, old.disbursed_on, old.journal_entry_id)
     and coalesce(current_setting('app.loan_system', true), '') <> 'on' then
    raise exception 'Disbursed loans can''t be edited; only the installment and start month can change.';
  end if;
  return new;
end $$;

create trigger loans_before_update before update on public.loans
  for each row execute function private.loan_before_update();

-- F&F suggestion: unused annual leave × daily basic (basic / 30) + outstanding loans.
create function public.fnf_suggest(p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  emp    public.employees;
  sal    public.employee_salaries;
  leave_days numeric;
  loans  numeric;
begin
  if not private.is_payroll() then raise exception 'Only HR or Finance can prepare settlements.' using errcode = '42501'; end if;
  select * into emp from public.employees where id = p_employee;
  if emp.exit_date is null then raise exception 'Set the employee''s exit date first.'; end if;
  select * into sal from public.employee_salaries where employee_id = p_employee and effective_from <= emp.exit_date
   order by effective_from desc limit 1;
  select coalesce(sum(b.allocated + b.carried_forward - coalesce(u.used, 0)), 0) into leave_days
    from public.leave_balances b
    join public.leave_types t on t.id = b.leave_type_id and t.code = 'AL'
    left join lateral (
      select sum(r.days) used from public.leave_requests r
       where r.employee_id = b.employee_id and r.leave_type_id = b.leave_type_id
         and r.status = 'approved' and extract(year from r.start_date) = b.year
    ) u on true
   where b.employee_id = p_employee and b.year = extract(year from emp.exit_date);
  select coalesce(sum(balance), 0) into loans from public.loans where employee_id = p_employee and status = 'active';
  return jsonb_build_object(
    'exit_date', emp.exit_date,
    'basic_salary', coalesce(sal.basic_salary, 0),
    'leave_days', greatest(leave_days, 0),
    'leave_encashment', round(greatest(leave_days, 0) * coalesce(sal.basic_salary, 0) / 30),
    'loan_balance', loans
  );
end $$;

create function public.fnf_approve(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f   public.fnf_settlements;
  je  uuid;
  l   record;
  remaining numeric;
  amt numeric;
begin
  if not private.is_finance() then raise exception 'Only Finance can approve settlements.' using errcode = '42501'; end if;
  select * into f from public.fnf_settlements where id = p_id for update;
  if f.id is null then raise exception 'Settlement not found.'; end if;
  if f.status <> 'draft' then raise exception 'This settlement is already approved.'; end if;
  if f.prepared_by = auth.uid() then
    raise exception 'Separation of duties: the preparer cannot approve the settlement.' using errcode = '42501';
  end if;
  if f.net_amount < 0 then
    raise exception 'Net settlement is negative — recover the balance separately or reduce deductions.';
  end if;

  insert into public.journal_entries (entry_date, description, source, source_id)
  values (f.exit_date, 'Full & final settlement — ' ||
          (select full_name || ' (' || employee_code || ')' from public.employees where id = f.employee_id), 'fnf', f.id)
  returning id into je;
  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  select je, private.account_id(code), dr, cr, label
    from (values
      ('5170', f.leave_encashment, 0::numeric, 'Leave encashment'),
      ('5180', f.gratuity, 0, 'Gratuity'),
      ('5110', f.other_additions, 0, 'Other final dues'),
      ('1310', 0, f.loan_recovery, 'Loan recovery'),
      ('2190', 0, f.other_deductions, 'Other recoveries'),
      ('2110', 0, f.net_amount, 'Final settlement payable')
    ) as v (code, dr, cr, label)
   where dr > 0 or cr > 0;
  perform private.post_journal(je);

  -- Apply the loan recovery to open loans, oldest first.
  remaining := f.loan_recovery;
  perform set_config('app.loan_system', 'on', true);
  for l in select id, balance from public.loans where employee_id = f.employee_id and status = 'active' order by created_at loop
    exit when remaining <= 0;
    amt := least(remaining, l.balance);
    insert into public.loan_repayments (loan_id, fnf_id, amount, repaid_on) values (l.id, f.id, amt, f.exit_date);
    update public.loans set balance = balance - amt, status = case when balance - amt <= 0 then 'closed' else 'active' end where id = l.id;
    remaining := remaining - amt;
  end loop;
  perform set_config('app.loan_system', '', true);

  perform set_config('app.fnf_approving', 'on', true);
  update public.fnf_settlements set status = 'approved', approved_by = auth.uid(), approved_at = now(), journal_entry_id = je where id = p_id;
  perform set_config('app.fnf_approving', '', true);
end $$;

-- Trial balance (FIN-07), invoker so RLS on journal tables applies; all accounts listed.
create function public.trial_balance(p_as_of date default current_date)
returns table (account_id uuid, code text, name text, account_type public.account_type, debit numeric, credit numeric, balance numeric)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.code, a.name, a.account_type,
         coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0),
         case when a.account_type in ('asset', 'expense') then coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)
              else coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0) end
    from public.chart_of_accounts a
    left join (
      public.journal_entry_lines l
      join public.journal_entries e on e.id = l.journal_entry_id and e.status = 'posted' and e.entry_date <= p_as_of
    ) on l.account_id = a.id
   where a.is_postable
   group by a.id
   order by a.code;
$$;

-- ---------------------------------------------------------------------
-- updated_at, audit
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'chart_of_accounts', 'journal_entries', 'journal_entry_lines', 'tax_slabs', 'tax_surcharges', 'statutory_rates',
    'salary_components', 'salary_structures', 'salary_structure_components', 'employee_salaries',
    'employee_salary_components', 'loans', 'loan_repayments', 'payroll_runs', 'fnf_settlements'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit()',
                   t || '_audit', t);
  end loop;
end $$;
-- payslips/payslip_lines are regenerated on every reprocess; the run row + JE carry the audit trail.

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.chart_of_accounts          enable row level security;
alter table public.journal_entries            enable row level security;
alter table public.journal_entry_lines        enable row level security;
alter table public.tax_slabs                  enable row level security;
alter table public.tax_surcharges             enable row level security;
alter table public.statutory_rates            enable row level security;
alter table public.salary_components          enable row level security;
alter table public.salary_structures          enable row level security;
alter table public.salary_structure_components enable row level security;
alter table public.employee_salaries          enable row level security;
alter table public.employee_salary_components enable row level security;
alter table public.loans                      enable row level security;
alter table public.loan_repayments            enable row level security;
alter table public.payroll_runs               enable row level security;
alter table public.payslips                   enable row level security;
alter table public.payslip_lines              enable row level security;
alter table public.fnf_settlements            enable row level security;

-- Finance data: Finance/Admin/Auditor/Executive/HR read (matrix: Finance R for Exec + HR).
create policy "coa: read" on public.chart_of_accounts for select to authenticated using ((select private.can_read_payroll()));
create policy "coa: finance insert" on public.chart_of_accounts for insert to authenticated with check ((select private.is_finance()));
create policy "coa: finance update" on public.chart_of_accounts for update to authenticated
  using ((select private.is_finance())) with check ((select private.is_finance()));
create policy "je: read" on public.journal_entries for select to authenticated using ((select private.can_read_payroll()));
create policy "jel: read" on public.journal_entry_lines for select to authenticated using ((select private.can_read_payroll()));

-- Statutory config & salary setup: payroll roles read; HR/Finance maintain.
do $$
declare t text;
begin
  foreach t in array array['tax_slabs', 'tax_surcharges', 'statutory_rates', 'salary_components', 'salary_structures', 'salary_structure_components'] loop
    execute format('create policy "%s: read" on public.%I for select to authenticated using ((select private.can_read_payroll()))', t, t);
    execute format('create policy "%s: insert" on public.%I for insert to authenticated with check ((select private.is_payroll()))', t, t);
    execute format('create policy "%s: update" on public.%I for update to authenticated using ((select private.is_payroll())) with check ((select private.is_payroll()))', t, t);
    execute format('create policy "%s: delete" on public.%I for delete to authenticated using ((select private.is_payroll()))', t, t);
  end loop;
end $$;

-- Salaries: payroll readers + the employee themselves; HR/Finance write.
create policy "employee_salaries: read" on public.employee_salaries for select to authenticated
  using ((select private.can_read_payroll()) or employee_id = (select private.current_employee_id()));
create policy "employee_salaries: insert" on public.employee_salaries for insert to authenticated with check ((select private.is_payroll()));
create policy "employee_salaries: update" on public.employee_salaries for update to authenticated
  using ((select private.is_payroll())) with check ((select private.is_payroll()));
create policy "employee_salaries: delete" on public.employee_salaries for delete to authenticated using ((select private.is_payroll()));
create policy "employee_salary_components: read" on public.employee_salary_components for select to authenticated
  using (
    (select private.can_read_payroll())
    or exists (select 1 from public.employee_salaries s where s.id = employee_salary_id and s.employee_id = (select private.current_employee_id()))
  );
create policy "employee_salary_components: insert" on public.employee_salary_components for insert to authenticated with check ((select private.is_payroll()));
create policy "employee_salary_components: update" on public.employee_salary_components for update to authenticated
  using ((select private.is_payroll())) with check ((select private.is_payroll()));
create policy "employee_salary_components: delete" on public.employee_salary_components for delete to authenticated using ((select private.is_payroll()));

create policy "loans: read" on public.loans for select to authenticated
  using ((select private.can_read_payroll()) or employee_id = (select private.current_employee_id()));
create policy "loans: insert" on public.loans for insert to authenticated with check ((select private.is_payroll()));
create policy "loans: update" on public.loans for update to authenticated
  using ((select private.is_payroll())) with check ((select private.is_payroll()));
create policy "loan_repayments: read" on public.loan_repayments for select to authenticated
  using (
    (select private.can_read_payroll())
    or exists (select 1 from public.loans l where l.id = loan_id and l.employee_id = (select private.current_employee_id()))
  );

create policy "payroll_runs: read" on public.payroll_runs for select to authenticated using ((select private.can_read_payroll()));

-- Employees see only their own payslips, and only once the run is approved (not drafts / parallel runs).
create policy "payslips: read" on public.payslips for select to authenticated
  using (
    (select private.can_read_payroll())
    or (
      employee_id = (select private.current_employee_id())
      and exists (select 1 from public.payroll_runs r where r.id = payroll_run_id and r.status in ('approved', 'posted', 'paid') and not r.is_parallel)
    )
  );
create policy "payslip_lines: read" on public.payslip_lines for select to authenticated
  using (exists (select 1 from public.payslips p where p.id = payslip_id));

create policy "fnf: read" on public.fnf_settlements for select to authenticated
  using ((select private.can_read_payroll()) or employee_id = (select private.current_employee_id()));
create policy "fnf: insert" on public.fnf_settlements for insert to authenticated with check ((select private.is_payroll()));
create policy "fnf: update" on public.fnf_settlements for update to authenticated
  using ((select private.is_payroll())) with check ((select private.is_payroll()));
create policy "fnf: delete" on public.fnf_settlements for delete to authenticated using ((select private.is_payroll()) and status = 'draft');

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on public.chart_of_accounts, public.journal_entries, public.journal_entry_lines, public.tax_slabs,
  public.tax_surcharges, public.statutory_rates, public.salary_components, public.salary_structures,
  public.salary_structure_components, public.employee_salaries, public.employee_salary_components, public.loans,
  public.loan_repayments, public.payroll_runs, public.payslips, public.payslip_lines, public.fnf_settlements
  from anon, authenticated;
revoke all on sequence public.journal_entry_no_seq from anon, authenticated;

grant select on public.journal_entries, public.journal_entry_lines, public.payroll_runs, public.payslips,
  public.payslip_lines, public.loan_repayments to authenticated;
grant select, insert, update on public.chart_of_accounts, public.loans to authenticated;
grant select, insert, update, delete on public.tax_slabs, public.tax_surcharges, public.statutory_rates,
  public.salary_components, public.salary_structures, public.salary_structure_components,
  public.employee_salaries, public.employee_salary_components, public.fnf_settlements to authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_any_role(public.app_role[]), private.is_hr(), private.current_employee_id(), private.can_see_team(uuid),
  private.is_payroll(), private.is_finance(), private.can_read_payroll()
to authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.link_auth_user() to supabase_auth_admin;

revoke execute on function public.payroll_create_run(date, boolean), public.payroll_process_run(uuid),
  public.payroll_transition(uuid, public.payroll_status, text), public.fnf_suggest(uuid), public.fnf_approve(uuid),
  public.trial_balance(date) from public, anon;
grant execute on function public.payroll_create_run(date, boolean), public.payroll_process_run(uuid),
  public.payroll_transition(uuid, public.payroll_status, text), public.fnf_suggest(uuid), public.fnf_approve(uuid),
  public.trial_balance(date) to authenticated;

-- ---------------------------------------------------------------------
-- Seed: chart of accounts (payroll-relevant), components, structure, statutory rules
-- ---------------------------------------------------------------------
insert into public.chart_of_accounts (code, name, account_type, is_postable) values
  ('1000', 'Assets', 'asset', false),
  ('2000', 'Liabilities', 'liability', false),
  ('3000', 'Equity', 'equity', false),
  ('4000', 'Revenue', 'revenue', false),
  ('5000', 'Expenses', 'expense', false);
insert into public.chart_of_accounts (code, name, account_type, parent_id)
select v.code, v.name, v.t::public.account_type, p.id
from (values
  ('1110', 'Bank — Salary Account', 'asset', '1000'),
  ('1310', 'Employee Loans & Advances', 'asset', '1000'),
  ('2110', 'Salaries Payable', 'liability', '2000'),
  ('2120', 'Income Tax Payable (Salaries)', 'liability', '2000'),
  ('2130', 'EOBI Payable', 'liability', '2000'),
  ('2140', 'PESSI Payable', 'liability', '2000'),
  ('2150', 'Provident Fund Payable', 'liability', '2000'),
  ('2160', 'VPS Payable', 'liability', '2000'),
  ('2190', 'Other Payroll Deductions Payable', 'liability', '2000'),
  ('3100', 'Retained Earnings', 'equity', '3000'),
  ('4100', 'Revenue', 'revenue', '4000'),
  ('5110', 'Salaries & Allowances', 'expense', '5000'),
  ('5120', 'Overtime', 'expense', '5000'),
  ('5130', 'EOBI — Employer Contribution', 'expense', '5000'),
  ('5140', 'PESSI — Employer Contribution', 'expense', '5000'),
  ('5150', 'Provident Fund — Employer Contribution', 'expense', '5000'),
  ('5160', 'VPS — Employer Contribution', 'expense', '5000'),
  ('5170', 'Leave Encashment', 'expense', '5000'),
  ('5180', 'Gratuity', 'expense', '5000')
) as v (code, name, t, parent)
join public.chart_of_accounts p on p.code = v.parent;

insert into public.salary_components (code, name, kind, is_taxable, is_system, sort_order) values
  ('BASIC', 'Basic Salary', 'earning', true, true, 1),
  ('HRA', 'House Rent Allowance', 'earning', true, false, 10),
  ('UTIL', 'Utilities Allowance', 'earning', true, false, 20),
  ('MED', 'Medical Allowance', 'earning', false, false, 30), -- exempt up to 10% of basic
  ('CONV', 'Conveyance Allowance', 'earning', true, false, 40),
  ('FUEL', 'Fuel Allowance', 'earning', true, false, 41),
  ('MOB', 'Mobile Allowance', 'earning', true, false, 42),
  ('SITE', 'Site / Field Allowance', 'earning', true, false, 43),
  ('OT', 'Overtime', 'earning', true, true, 50),
  ('BONUS', 'Bonus', 'earning', true, false, 60),
  ('ARREARS', 'Arrears', 'earning', true, false, 61),
  ('LOAN', 'Loan / Advance Recovery', 'deduction', false, true, 80),
  ('OTHER_DED', 'Other Deduction', 'deduction', false, false, 90);

insert into public.salary_structures (code, name) values ('STD', 'Standard (Basic + HRA 45% + Utilities 10% + Medical 10%)');
insert into public.salary_structure_components (structure_id, component_id, calc_type, value)
select s.id, c.id, 'percent_of_basic', v.pct
from (values ('HRA', 45), ('UTIL', 10), ('MED', 10)) as v (code, pct)
join public.salary_components c on c.code = v.code
cross join public.salary_structures s where s.code = 'STD';

-- EOBI is computed on the minimum wage. Punjab's FY2026-27 minimum wage isn't notified yet:
-- PKR 40,000 is the last notified figure — update when the notification is issued.
insert into public.statutory_rates (effective_from, eobi_wage_base, pessi_wage_base, notes) values
  ('2025-07-01', 40000, 40000, 'Punjab minimum wage FY2025-26'),
  ('2026-07-01', 40000, 40000, 'Carried forward pending Punjab FY2026-27 minimum wage notification — verify');

-- Salaried slabs. TY2026 = Finance Act 2025; TY2027 = Finance Act 2026 (in force 1 Jul 2026).
-- Verify against the FBR/Gazette text before the first live payroll.
insert into public.tax_slabs (tax_year, lower_limit, upper_limit, fixed_tax, rate_pct) values
  (2026, 0, 600000, 0, 0),
  (2026, 600000, 1200000, 0, 1),
  (2026, 1200000, 2200000, 6000, 11),
  (2026, 2200000, 3200000, 116000, 23),
  (2026, 3200000, 4100000, 346000, 30),
  (2026, 4100000, null, 616000, 35),
  (2027, 0, 600000, 0, 0),
  (2027, 600000, 1200000, 0, 1),
  (2027, 1200000, 2200000, 6000, 11),
  (2027, 2200000, 3200000, 116000, 20),
  (2027, 3200000, 4100000, 316000, 25),
  (2027, 4100000, 5600000, 541000, 29),
  (2027, 5600000, 7000000, 976000, 32),
  (2027, 7000000, null, 1424000, 35);
insert into public.tax_surcharges (tax_year, threshold, surcharge_pct) values (2026, 10000000, 9);

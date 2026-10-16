-- =====================================================================
-- Assets (6.13), Benefits (6.12), Exit & clearance (7.6, AST-05)
-- =====================================================================

-- =================== ASSETS ===================
create type public.asset_status as enum ('available', 'assigned', 'maintenance', 'retired');

create table public.assets (
  id             uuid primary key default gen_random_uuid(),
  asset_tag      text not null unique,
  name           text not null,
  category       text not null default 'laptop' check (category in ('laptop', 'desktop', 'phone', 'tablet', 'vehicle', 'furniture', 'equipment', 'other')),
  serial_number  text,
  location_id    uuid references public.locations (id),
  purchase_date  date,
  purchase_cost  numeric(14, 2) check (purchase_cost >= 0),
  condition      text not null default 'good' check (condition in ('new', 'good', 'fair', 'poor', 'damaged')),
  status         public.asset_status not null default 'available',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index assets_location_idx on public.assets (location_id);

create table public.asset_assignments (
  id                uuid primary key default gen_random_uuid(),
  asset_id          uuid not null references public.assets (id) on delete cascade,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  issued_on         date not null default current_date,
  issued_by         uuid references public.employees (id),
  acknowledged_at   timestamptz,
  returned_on       date,
  return_condition  text check (return_condition in ('new', 'good', 'fair', 'poor', 'damaged', 'lost')),
  notes             text,
  created_at        timestamptz not null default now()
);
create unique index asset_one_open_assignment on public.asset_assignments (asset_id) where returned_on is null;
create index asset_assignments_employee_idx on public.asset_assignments (employee_id);
create index asset_assignments_issued_by_idx on public.asset_assignments (issued_by);

create function public.asset_issue(p_asset uuid, p_employee uuid, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.assets; aid uuid;
begin
  if not private.is_hr() then raise exception 'Only HR / Admin can issue assets.' using errcode = '42501'; end if;
  select * into a from public.assets where id = p_asset for update;
  if a.id is null then raise exception 'Asset not found.'; end if;
  if a.status <> 'available' then raise exception 'Asset % is %, not available.', a.asset_tag, a.status; end if;
  if not exists (select 1 from public.employees where id = p_employee and deleted_at is null and status <> 'exited') then
    raise exception 'Choose an active employee.';
  end if;
  insert into public.asset_assignments (asset_id, employee_id, issued_by, notes)
  values (p_asset, p_employee, private.current_employee_id(), p_notes) returning id into aid;
  update public.assets set status = 'assigned', updated_at = now() where id = p_asset;
  perform private.notify_employee(p_employee, 'Asset issued: ' || a.name, a.asset_tag || ' — please acknowledge receipt', '/assets');
  return aid;
end $$;

create function public.asset_acknowledge(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.asset_assignments set acknowledged_at = now()
   where id = p_assignment and employee_id = private.current_employee_id() and acknowledged_at is null and returned_on is null;
  if not found then raise exception 'Nothing to acknowledge.'; end if;
end $$;

create function public.asset_return(p_asset uuid, p_condition text, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare asg public.asset_assignments;
begin
  if not private.is_hr() then raise exception 'Only HR / Admin can receive returns.' using errcode = '42501'; end if;
  select * into asg from public.asset_assignments where asset_id = p_asset and returned_on is null for update;
  if asg.id is null then raise exception 'This asset is not issued to anyone.'; end if;
  update public.asset_assignments set returned_on = current_date, return_condition = p_condition,
    notes = coalesce(nullif(p_notes, ''), notes) where id = asg.id;
  update public.assets set
    status = case when p_condition = 'lost' then 'retired' when p_condition in ('poor', 'damaged') then 'maintenance' else 'available' end::public.asset_status,
    condition = case when p_condition = 'lost' then condition else p_condition end,
    updated_at = now()
   where id = p_asset;
  perform private.exit_refresh_assets(asg.employee_id);
end $$;

create function public.asset_transfer(p_asset uuid, p_to uuid, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cond text;
begin
  select condition into cond from public.assets where id = p_asset;
  perform public.asset_return(p_asset, cond, coalesce(p_notes, 'Transferred'));
  return public.asset_issue(p_asset, p_to, coalesce(p_notes, 'Transfer'));
end $$;

-- =================== BENEFITS ===================
create table public.benefit_plans (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  name                   text not null,
  plan_type              text not null default 'health' check (plan_type in ('health', 'life', 'retirement', 'transport', 'meal', 'other')),
  provider               text,
  description            text,
  employee_contribution  numeric(12, 2) not null default 0 check (employee_contribution >= 0),
  employer_contribution  numeric(12, 2) not null default 0 check (employer_contribution >= 0),
  covers_dependents      boolean not null default false,
  max_dependents         integer not null default 0 check (max_dependents >= 0),
  min_tenure_months      integer not null default 0 check (min_tenure_months >= 0),
  eligible_grades        text[],                     -- null = all grades
  eligible_types         public.employment_type[],  -- null = all employment types
  is_active              boolean not null default true,
  created_at             timestamptz not null default now()
);

create table public.benefit_enrollments (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.benefit_plans (id),
  employee_id     uuid not null references public.employees (id) on delete cascade,
  status          text not null default 'active' check (status in ('active', 'cancelled')),
  start_date      date not null default (date_trunc('month', current_date))::date,
  end_date        date,
  dependent_ids   uuid[] not null default '{}',
  created_at      timestamptz not null default now()
);
create unique index benefit_one_active on public.benefit_enrollments (plan_id, employee_id) where status = 'active';
create index benefit_enrollments_employee_idx on public.benefit_enrollments (employee_id);
create index benefit_enrollments_plan_idx on public.benefit_enrollments (plan_id);

-- BEN-02: eligibility by tenure, grade and employment type. Returns null when eligible, else the reason.
create function public.benefit_ineligibility(p_plan uuid, p_employee uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.benefit_plans;
  e public.employees;
  g text;
  months integer;
begin
  select * into p from public.benefit_plans where id = p_plan;
  select * into e from public.employees where id = p_employee;
  if p.id is null or not p.is_active then return 'Plan is not available.'; end if;
  if e.id is null or e.status in ('exited', 'draft') then return 'Not an active employee.'; end if;
  months := coalesce((extract(year from age(current_date, e.joining_date)) * 12 + extract(month from age(current_date, e.joining_date)))::int, 0);
  if months < p.min_tenure_months then
    return format('Requires %s months of service (you have %s).', p.min_tenure_months, months);
  end if;
  select grade into g from public.positions where id = e.position_id;
  if p.eligible_grades is not null and (g is null or not g = any (p.eligible_grades)) then
    return 'Not available for your grade.';
  end if;
  if p.eligible_types is not null and not e.employment_type = any (p.eligible_types) then
    return 'Not available for your employment type.';
  end if;
  return null;
end $$;

create function private.enrollment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  reason text;
  p public.benefit_plans;
  bad integer;
begin
  if auth.uid() is not null and not private.is_hr() and coalesce(new.employee_id, old.employee_id) is distinct from private.current_employee_id() then
    raise exception 'You can only manage your own benefits.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'cancelled' then raise exception 'Cancelled enrollments can''t be changed.'; end if;
    if new.status = 'cancelled' then
      new.end_date := coalesce(new.end_date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date);
      return new;
    end if;
  end if;
  reason := public.benefit_ineligibility(new.plan_id, new.employee_id);
  if reason is not null then raise exception '%', reason; end if;
  select * into p from public.benefit_plans where id = new.plan_id;
  if cardinality(new.dependent_ids) > 0 and not p.covers_dependents then
    raise exception 'This plan does not cover dependents.';
  end if;
  if cardinality(new.dependent_ids) > p.max_dependents then
    raise exception 'This plan covers at most % dependent(s).', p.max_dependents;
  end if;
  select count(*) into bad from unnest(new.dependent_ids) d
   where not exists (select 1 from public.employee_dependents x where x.id = d and x.employee_id = new.employee_id);
  if bad > 0 then raise exception 'Dependents must be your own registered dependents.'; end if;
  return new;
end $$;
create trigger benefit_enrollments_guard before insert or update on public.benefit_enrollments
  for each row execute function private.enrollment_guard();

-- Payroll: active enrollments deduct the employee contribution (credited to 2190 via other deductions).
create or replace function private.payroll_calc_employee(p_run public.payroll_runs, p_emp uuid) returns void
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
  bp           record;
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

  -- Benefit plan contributions (BEN-04): active enrollments covering this month.
  for bp in
    select p.name, p.employee_contribution
      from public.benefit_enrollments be join public.benefit_plans p on p.id = be.plan_id
     where be.employee_id = p_emp and be.status = 'active' and p.employee_contribution > 0
       and be.start_date <= m_end and (be.end_date is null or be.end_date >= m_start)
  loop
    insert into public.payslip_lines (payslip_id, code, name, kind, amount, is_taxable, sort_order)
    values (slip, 'BENEFIT', 'Benefit: ' || bp.name, 'deduction', bp.employee_contribution, false, 85);
    other_ded := other_ded + bp.employee_contribution;
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

-- =================== EXIT & CLEARANCE ===================
create table public.separations (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees (id) on delete cascade,
  separation_type   text not null default 'resignation' check (separation_type in ('resignation', 'termination', 'retirement', 'contract_end', 'other')),
  notice_date       date not null default current_date,
  last_working_day  date not null,
  reason            text not null,
  status            text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'withdrawn', 'completed')),
  decided_by        uuid references public.employees (id),
  decided_at        timestamptz,
  decision_comment  text,
  exit_interview    text,
  completed_at      timestamptz,
  created_by        uuid references public.employees (id),
  created_at        timestamptz not null default now(),
  check (last_working_day >= notice_date)
);
create unique index separations_one_open on public.separations (employee_id) where status in ('submitted', 'approved');
create index separations_decided_by_idx on public.separations (decided_by);
create index separations_created_by_idx on public.separations (created_by);

create table public.clearance_items (
  id             uuid primary key default gen_random_uuid(),
  separation_id  uuid not null references public.separations (id) on delete cascade,
  area           text not null check (area in ('department', 'assets', 'finance', 'it', 'hr')),
  title          text not null,
  status         text not null default 'pending' check (status in ('pending', 'cleared')),
  cleared_by     uuid references public.employees (id),
  cleared_at     timestamptz,
  notes          text,
  sort_order     integer not null default 0,
  unique (separation_id, area)
);
create index clearance_cleared_by_idx on public.clearance_items (cleared_by);

create function private.can_clear(p_area text, p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_area
    when 'department' then private.is_hr() or private.can_see_team(p_employee)
    when 'finance' then private.is_finance()
    else private.is_hr()
  end;
$$;

-- Assets clearance flips automatically when nothing is still issued (AST-05).
create function private.exit_refresh_assets(p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare open_n integer;
begin
  select count(*) into open_n from public.asset_assignments where employee_id = p_employee and returned_on is null;
  update public.clearance_items ci set
    status = case when open_n = 0 then 'cleared' else 'pending' end,
    cleared_at = case when open_n = 0 then coalesce(ci.cleared_at, now()) end,
    notes = case when open_n = 0 then 'All assets returned' else open_n || ' asset(s) still issued' end
   from public.separations s
  where ci.separation_id = s.id and s.employee_id = p_employee and s.status = 'approved' and ci.area = 'assets';
end $$;

create function public.exit_submit(p_employee uuid, p_type text, p_last_day date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.current_employee_id();
  sid uuid;
  e public.employees;
begin
  if p_employee is distinct from me and not private.is_hr() then
    raise exception 'You can only resign for yourself.' using errcode = '42501';
  end if;
  if p_employee = me and p_type <> 'resignation' then raise exception 'Employees can only submit a resignation.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason.'; end if;
  select * into e from public.employees where id = p_employee;
  if e.status = 'exited' then raise exception 'Already exited.'; end if;
  insert into public.separations (employee_id, separation_type, last_working_day, reason, created_by)
  values (p_employee, p_type, p_last_day, p_reason, me) returning id into sid;
  perform private.notify_approver(p_employee, initcap(replace(p_type, '_', ' ')) || ': ' || e.full_name,
    'Last working day ' || to_char(p_last_day, 'DD Mon YYYY'), '/exit/' || sid);
  perform private.notify_roles(array['hr_admin']::public.app_role[], initcap(replace(p_type, '_', ' ')) || ': ' || e.full_name,
    'Last working day ' || to_char(p_last_day, 'DD Mon YYYY'), '/exit/' || sid);
  return sid;
exception when unique_violation then
  raise exception 'There is already an open separation for this employee.';
end $$;

create function public.exit_decide(p_sep uuid, p_approve boolean, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.separations;
begin
  select * into s from public.separations where id = p_sep for update;
  if s.id is null or s.status <> 'submitted' then raise exception 'This separation isn''t awaiting a decision.'; end if;
  if s.employee_id = private.current_employee_id() then raise exception 'You can''t approve your own separation.' using errcode = '42501'; end if;
  if not (private.is_hr() or private.can_see_team(s.employee_id)) then
    raise exception 'Only the line manager, HOD or HR can decide.' using errcode = '42501';
  end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Give a reason when rejecting.'; end if;
  update public.separations set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = private.current_employee_id(), decided_at = now(), decision_comment = p_comment where id = p_sep;
  if p_approve then
    update public.employees set status = 'notice', exit_date = s.last_working_day where id = s.employee_id;
    insert into public.clearance_items (separation_id, area, title, sort_order) values
      (p_sep, 'department', 'Work handover to line manager', 1),
      (p_sep, 'assets', 'All company assets returned', 2),
      (p_sep, 'finance', 'Loans, advances and expense claims settled', 3),
      (p_sep, 'it', 'System and email access revoked', 4),
      (p_sep, 'hr', 'Exit interview and documents returned', 5);
    perform private.exit_refresh_assets(s.employee_id);
  end if;
  perform private.notify_employee(s.employee_id, 'Your ' || replace(s.separation_type, '_', ' ') || ' was ' || case when p_approve then 'approved' else 'rejected' end,
    coalesce(p_comment, 'Last working day ' || to_char(s.last_working_day, 'DD Mon YYYY')), '/exit/' || p_sep);
end $$;

create function public.exit_clear(p_item uuid, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ci public.clearance_items;
  s  public.separations;
  open_n integer;
begin
  select * into ci from public.clearance_items where id = p_item for update;
  select * into s from public.separations where id = ci.separation_id;
  if s.status <> 'approved' then raise exception 'Clearance is only possible on an approved separation.'; end if;
  if not private.can_clear(ci.area, s.employee_id) then raise exception 'You can''t clear the % item.', ci.area using errcode = '42501'; end if;
  if ci.area = 'assets' then
    select count(*) into open_n from public.asset_assignments where employee_id = s.employee_id and returned_on is null;
    if open_n > 0 then raise exception '% asset(s) are still issued — receive them in Assets first.', open_n; end if;
  end if;
  if ci.area = 'finance' and exists (select 1 from public.expense_claims where employee_id = s.employee_id and status in ('submitted', 'approved')) then
    raise exception 'Settle or reject open expense claims first.';
  end if;
  update public.clearance_items set status = 'cleared', cleared_by = private.current_employee_id(), cleared_at = now(),
    notes = coalesce(nullif(p_notes, ''), notes) where id = p_item;
end $$;

create function public.exit_complete(p_sep uuid, p_interview text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.separations; pending integer;
begin
  if not private.is_hr() then raise exception 'Only HR completes the exit.' using errcode = '42501'; end if;
  select * into s from public.separations where id = p_sep for update;
  if s.status <> 'approved' then raise exception 'Only approved separations can be completed.'; end if;
  select count(*) into pending from public.clearance_items where separation_id = p_sep and status <> 'cleared';
  if pending > 0 then raise exception '% clearance item(s) still pending.', pending; end if;
  update public.separations set status = 'completed', completed_at = now(), exit_interview = coalesce(p_interview, exit_interview) where id = p_sep;
  update public.employees set status = 'exited', exit_date = s.last_working_day where id = s.employee_id;
  update public.benefit_enrollments set status = 'cancelled', end_date = s.last_working_day where employee_id = s.employee_id and status = 'active';
  -- Revoke elevated access; the login itself is disabled by removing the employee link only after F&F.
  delete from public.user_roles where user_id = (select user_id from public.employees where id = s.employee_id);
end $$;

create function public.exit_withdraw(p_sep uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.separations;
begin
  select * into s from public.separations where id = p_sep for update;
  if s.status not in ('submitted', 'approved') then raise exception 'Nothing to withdraw.'; end if;
  if not (private.is_hr() or (s.employee_id = private.current_employee_id() and s.status = 'submitted')) then
    raise exception 'Ask HR to withdraw an approved resignation.' using errcode = '42501';
  end if;
  update public.separations set status = 'withdrawn' where id = p_sep;
  if s.status = 'approved' then
    update public.employees set status = 'confirmed', exit_date = null where id = s.employee_id and status = 'notice';
  end if;
end $$;

-- =================== Audit, RLS, grants ===================
do $$
declare t text;
begin
  foreach t in array array['assets', 'asset_assignments', 'benefit_plans', 'benefit_enrollments', 'separations', 'clearance_items'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit()', t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Assets (matrix: Exec R, HR CRUD, Finance R, HOD R, Employee R own)
create policy "assets: read" on public.assets for select to authenticated
  using ((select private.has_any_role(array['hr_admin', 'system_admin', 'finance', 'executive', 'auditor', 'hod']::public.app_role[]))
         or exists (select 1 from public.asset_assignments x where x.asset_id = assets.id and x.employee_id = (select private.current_employee_id())));
create policy "assets: hr insert" on public.assets for insert to authenticated with check ((select private.is_hr()));
create policy "assets: hr update" on public.assets for update to authenticated using ((select private.is_hr())) with check ((select private.is_hr()));
create policy "asset_assignments: read" on public.asset_assignments for select to authenticated
  using (employee_id = (select private.current_employee_id()) or private.can_see_team(employee_id)
         or (select private.has_any_role(array['hr_admin', 'system_admin', 'finance', 'executive', 'auditor']::public.app_role[])));

-- Benefits (matrix: Benefits not in source — HR CRUD, employees self-service, exec/finance/auditor read)
create policy "benefit_plans: read" on public.benefit_plans for select to authenticated using (true);
create policy "benefit_plans: hr insert" on public.benefit_plans for insert to authenticated with check ((select private.is_hr()));
create policy "benefit_plans: hr update" on public.benefit_plans for update to authenticated using ((select private.is_hr())) with check ((select private.is_hr()));
create policy "benefit_enrollments: read" on public.benefit_enrollments for select to authenticated
  using (employee_id = (select private.current_employee_id())
         or (select private.has_any_role(array['hr_admin', 'system_admin', 'finance', 'executive', 'auditor']::public.app_role[])));
create policy "benefit_enrollments: enroll" on public.benefit_enrollments for insert to authenticated
  with check (employee_id = (select private.current_employee_id()) or (select private.is_hr()));
create policy "benefit_enrollments: update" on public.benefit_enrollments for update to authenticated
  using (employee_id = (select private.current_employee_id()) or (select private.is_hr()))
  with check (employee_id = (select private.current_employee_id()) or (select private.is_hr()));

-- Exit
create policy "separations: read" on public.separations for select to authenticated
  using (employee_id = (select private.current_employee_id()) or private.can_see_team(employee_id)
         or (select private.has_any_role(array['hr_admin', 'system_admin', 'finance', 'executive', 'auditor']::public.app_role[])));
create policy "clearance: read" on public.clearance_items for select to authenticated
  using (exists (select 1 from public.separations s where s.id = separation_id));

revoke all on public.assets, public.asset_assignments, public.benefit_plans, public.benefit_enrollments, public.separations, public.clearance_items from anon, authenticated;
grant select, insert, update on public.assets, public.benefit_plans, public.benefit_enrollments to authenticated;
grant select on public.asset_assignments, public.separations, public.clearance_items to authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_any_role(public.app_role[]), private.is_hr(), private.current_employee_id(), private.can_see_team(uuid),
  private.is_payroll(), private.is_finance(), private.can_read_payroll(), private.payroll_released(uuid),
  private.tax_year_of(date), private.is_ticket_agent(uuid), private.is_recruiter(), private.appraisal_role(uuid)
to authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.link_auth_user() to supabase_auth_admin;

do $$
declare f text;
begin
  foreach f in array array[
    'public.asset_issue(uuid, uuid, text)', 'public.asset_acknowledge(uuid)', 'public.asset_return(uuid, text, text)',
    'public.asset_transfer(uuid, uuid, text)', 'public.benefit_ineligibility(uuid, uuid)',
    'public.exit_submit(uuid, text, date, text)', 'public.exit_decide(uuid, boolean, text)', 'public.exit_clear(uuid, text)',
    'public.exit_complete(uuid, text)', 'public.exit_withdraw(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Starter benefit plans (HR adjusts amounts/eligibility).
insert into public.benefit_plans (code, name, plan_type, provider, employee_contribution, employer_contribution, covers_dependents, max_dependents, min_tenure_months, description) values
  ('GHI', 'Group health insurance', 'health', 'To be confirmed', 1500, 4500, true, 5, 3, 'Hospitalisation cover for employee, spouse and children.'),
  ('GLI', 'Group life insurance', 'life', 'To be confirmed', 0, 800, false, 0, 0, 'Company-paid life cover.'),
  ('PICK', 'Staff pick & drop', 'transport', 'Company fleet', 3000, 0, false, 0, 0, 'Daily transport on fixed routes.');

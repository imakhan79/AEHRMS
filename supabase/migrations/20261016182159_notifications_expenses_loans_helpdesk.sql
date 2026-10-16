-- =====================================================================
-- Batch A: in-app notifications (ESS-10), expenses + travel (6.10, 7.7),
-- loan applications (6.11, 7.8), helpdesk with SLA (6.14).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create function private.notify_user(p_user uuid, p_title text, p_body text, p_link text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, title, body, link)
  select p_user, p_title, p_body, p_link where p_user is not null and p_user is distinct from auth.uid();
$$;

create function private.notify_employee(p_emp uuid, p_title text, p_body text, p_link text) returns void
language sql security definer set search_path = '' as $$
  select private.notify_user((select user_id from public.employees where id = p_emp), p_title, p_body, p_link);
$$;

-- Everyone holding one of the roles (e.g. all Finance users).
create function private.notify_roles(p_roles public.app_role[], p_title text, p_body text, p_link text) returns void
language sql security definer set search_path = '' as $$
  select private.notify_user(u.user_id, p_title, p_body, p_link)
    from (select distinct user_id from public.user_roles where role = any (p_roles)) u;
$$;

-- Approver for a manager-stage request: the line manager, else HR.
create function private.notify_approver(p_emp uuid, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin
  select manager_id into m from public.employees where id = p_emp;
  if m is not null then
    perform private.notify_employee(m, p_title, p_body, p_link);
  else
    perform private.notify_roles(array['hr_admin']::public.app_role[], p_title, p_body, p_link);
  end if;
end $$;

-- Leave + attendance corrections + payroll release now notify (retrofit of earlier workflows).
create function private.leave_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  select full_name into who from public.employees where id = new.employee_id;
  if tg_op = 'INSERT' then
    if new.stage = 'manager' then
      perform private.notify_approver(new.employee_id, 'Leave request from ' || who, new.days || ' day(s) from ' || to_char(new.start_date, 'DD Mon'), '/leave#approvals');
    else
      perform private.notify_roles(array['hr_admin']::public.app_role[], 'Leave request from ' || who, new.days || ' day(s) — HR approval', '/leave#approvals');
    end if;
  elsif new.status is distinct from old.status or new.stage is distinct from old.stage then
    if new.status in ('approved', 'rejected') then
      perform private.notify_employee(new.employee_id, 'Leave ' || new.status, to_char(new.start_date, 'DD Mon') || coalesce(' — ' || new.decision_comment, ''), '/leave');
    elsif new.status = 'pending' and new.stage = 'hr' then
      perform private.notify_roles(array['hr_admin']::public.app_role[], 'Leave awaiting HR: ' || who, new.days || ' day(s)', '/leave#approvals');
    end if;
  end if;
  return null;
end $$;
create trigger leave_requests_notify after insert or update on public.leave_requests
  for each row execute function private.leave_notify();

create function private.regularization_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  select full_name into who from public.employees where id = new.employee_id;
  if tg_op = 'INSERT' then
    perform private.notify_approver(new.employee_id, 'Attendance correction from ' || who, to_char(new.work_date, 'DD Mon'), '/attendance/approvals');
  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform private.notify_employee(new.employee_id, 'Attendance correction ' || new.status, to_char(new.work_date, 'DD Mon') || coalesce(' — ' || new.decision_comment, ''), '/attendance');
  end if;
  return null;
end $$;
create trigger regularizations_notify after insert or update on public.attendance_regularizations
  for each row execute function private.regularization_notify();

create function private.payroll_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status = 'review' then
    insert into public.notifications (user_id, title, body, link)
    select e.user_id, 'Your payslip is ready', to_char(new.period_month, 'FMMonth YYYY'), '/payroll/payslips/' || p.id
      from public.payslips p join public.employees e on e.id = p.employee_id
     where p.payroll_run_id = new.id and e.user_id is not null;
  elsif new.status = 'review' and old.status = 'draft' then
    perform private.notify_roles(array['finance']::public.app_role[], 'Payroll awaiting approval', to_char(new.period_month, 'FMMonth YYYY'), '/payroll/runs/' || new.id);
  end if;
  return null;
end $$;
create trigger payroll_runs_notify after update of status on public.payroll_runs
  for each row execute function private.payroll_notify();

-- ---------------------------------------------------------------------
-- GL accounts for expenses
-- ---------------------------------------------------------------------
insert into public.chart_of_accounts (code, name, account_type, parent_id)
select v.code, v.name, v.t::public.account_type, p.id
from (values
  ('1320', 'Travel & Expense Advances', 'asset', '1000'),
  ('2310', 'Employee Reimbursements Payable', 'liability', '2000'),
  ('5241', 'Accommodation & Per Diem', 'expense', '5000'),
  ('5242', 'Fuel & Vehicle Running', 'expense', '5000'),
  ('5243', 'Meals & Entertainment', 'expense', '5000')
) as v (code, name, t, parent)
join public.chart_of_accounts p on p.code = v.parent;

-- ---------------------------------------------------------------------
-- Expenses & travel (6.10)
-- ---------------------------------------------------------------------
create table public.expense_categories (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  account_id        uuid not null references public.chart_of_accounts (id),
  requires_receipt  boolean not null default true,
  per_item_limit    numeric(14, 2) check (per_item_limit > 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);
insert into public.expense_categories (code, name, account_id, requires_receipt, per_item_limit)
select v.code, v.name, a.id, v.req, v.lim
from (values
  ('TRAVEL', 'Travel (air / rail / bus / taxi)', '5240', true, null::numeric),
  ('HOTEL', 'Accommodation', '5241', true, null),
  ('PERDIEM', 'Daily allowance (DA)', '5241', false, 6000),
  ('FUEL', 'Fuel & mileage', '5242', true, null),
  ('MEALS', 'Meals & client entertainment', '5243', true, 25000),
  ('SUPPLIES', 'Office supplies', '5230', true, null),
  ('MISC', 'Other', '5290', true, 10000)
) as v (code, name, acct, req, lim)
join public.chart_of_accounts a on a.code = v.acct;

create table public.travel_requests (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees (id) on delete cascade,
  purpose            text not null,
  destination        text not null,
  start_date         date not null,
  end_date           date not null,
  estimated_cost     numeric(14, 2) not null default 0 check (estimated_cost >= 0),
  advance_requested  numeric(14, 2) not null default 0 check (advance_requested >= 0),
  status             public.leave_status not null default 'pending',
  stage              text not null default 'manager' check (stage in ('manager', 'finance', 'done')),
  decided_by         uuid references public.employees (id),
  decided_at         timestamptz,
  decision_comment   text,
  advance_paid       numeric(14, 2) not null default 0,
  advance_settled    numeric(14, 2) not null default 0,
  advance_entry_id   uuid references public.journal_entries (id),
  created_at         timestamptz not null default now(),
  check (end_date >= start_date)
);
create index travel_employee_idx on public.travel_requests (employee_id);

create sequence public.expense_claim_no_seq;
create table public.expense_claims (
  id                 uuid primary key default gen_random_uuid(),
  claim_no           text not null unique default ('EXP-' || lpad(nextval('public.expense_claim_no_seq')::text, 6, '0')),
  employee_id        uuid not null references public.employees (id) on delete cascade,
  travel_request_id  uuid references public.travel_requests (id),
  title              text not null,
  status             text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'paid')),
  stage              text not null default 'manager' check (stage in ('manager', 'finance', 'done')),
  total              numeric(14, 2) not null default 0,
  advance_adjusted   numeric(14, 2) not null default 0,
  net_payable        numeric(14, 2) generated always as (total - advance_adjusted) stored,
  submitted_at       timestamptz,
  manager_decided_by uuid references public.employees (id),
  manager_decided_at timestamptz,
  finance_decided_by uuid references public.employees (id),
  finance_decided_at timestamptz,
  decision_comment   text,
  journal_entry_id   uuid references public.journal_entries (id),
  paid_entry_id      uuid references public.journal_entries (id),
  paid_at            timestamptz,
  created_at         timestamptz not null default now()
);
create index expense_claims_employee_idx on public.expense_claims (employee_id);

create table public.expense_items (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid not null references public.expense_claims (id) on delete cascade,
  category_id     uuid not null references public.expense_categories (id),
  expense_date    date not null,
  description     text not null,
  amount          numeric(14, 2) not null check (amount > 0),
  receipt_path    text,
  created_at      timestamptz not null default now()
);
create index expense_items_claim_idx on public.expense_items (claim_id);

create function private.expense_item_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c   public.expense_claims;
  cat public.expense_categories;
begin
  select * into c from public.expense_claims where id = coalesce(new.claim_id, old.claim_id);
  if c.status <> 'draft' then raise exception 'Submitted claims can''t be changed.'; end if;
  if tg_op = 'DELETE' then return old; end if;
  select * into cat from public.expense_categories where id = new.category_id;
  if cat.per_item_limit is not null and new.amount > cat.per_item_limit then
    raise exception '% is limited to % per item.', cat.name, cat.per_item_limit;
  end if;
  if new.receipt_path is not null and new.receipt_path not like c.employee_id::text || '/%' then
    new.receipt_path := null;
  end if;
  if new.expense_date > current_date then raise exception 'Expenses can''t be dated in the future.'; end if;
  return new;
end $$;
create trigger expense_items_guard before insert or update or delete on public.expense_items
  for each row execute function private.expense_item_guard();

create function private.expense_item_total() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.expense_claims c set total = coalesce((select sum(amount) from public.expense_items where claim_id = c.id), 0)
   where c.id = coalesce(new.claim_id, old.claim_id);
  return null;
end $$;
create trigger expense_items_total after insert or update or delete on public.expense_items
  for each row execute function private.expense_item_total();

-- Direct edits: the employee may change title / travel link of their own draft; nothing else.
create function private.expense_claim_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Only draft claims can be deleted.'; end if;
    return old;
  end if;
  if old.status <> 'draft' or (new.status, new.stage, new.total, new.advance_adjusted, new.journal_entry_id, new.paid_entry_id)
     is distinct from (old.status, old.stage, old.total, old.advance_adjusted, old.journal_entry_id, old.paid_entry_id) then
    raise exception 'Use submit / approve actions to change a claim.';
  end if;
  return new;
end $$;
create trigger expense_claims_guard before update or delete on public.expense_claims
  for each row execute function private.expense_claim_guard();

create function public.exp_submit(p_claim uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c    public.expense_claims;
  miss integer;
  emp  public.employees;
  tr   public.travel_requests;
begin
  select * into c from public.expense_claims where id = p_claim for update;
  if c.id is null or c.employee_id is distinct from private.current_employee_id() then
    raise exception 'Claim not found.' using errcode = '42501';
  end if;
  if c.status <> 'draft' then raise exception 'This claim was already submitted.'; end if;
  if c.total <= 0 then raise exception 'Add at least one expense.'; end if;
  select count(*) into miss from public.expense_items i join public.expense_categories k on k.id = i.category_id
   where i.claim_id = p_claim and k.requires_receipt and i.receipt_path is null;
  if miss > 0 then raise exception '% item(s) need a receipt.', miss; end if;
  select * into emp from public.employees where id = c.employee_id;
  -- Adjust any unsettled travel advance against this claim (EXP-04).
  if c.travel_request_id is not null then
    select * into tr from public.travel_requests where id = c.travel_request_id and employee_id = c.employee_id;
  end if;
  update public.expense_claims set
    status = 'submitted', submitted_at = now(),
    stage = case when emp.manager_id is null then 'finance' else 'manager' end,
    advance_adjusted = least(c.total, greatest(coalesce(tr.advance_paid - tr.advance_settled, 0), 0))
   where id = p_claim;
  if emp.manager_id is null then
    perform private.notify_roles(array['finance']::public.app_role[], 'Expense claim ' || c.claim_no, emp.full_name || ' — PKR ' || c.total, '/expenses/approvals');
  else
    perform private.notify_employee(emp.manager_id, 'Expense claim from ' || emp.full_name, c.claim_no || ' — PKR ' || c.total, '/expenses/approvals');
  end if;
end $$;

-- Manager stage → Finance stage → approved & posted (EXP-03, EXP-05).
create function public.exp_decide(p_claim uuid, p_approve boolean, p_comment text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c   public.expense_claims;
  me  uuid := private.current_employee_id();
  je  uuid;
  emp public.employees;
  dept_cc uuid;
begin
  select * into c from public.expense_claims where id = p_claim for update;
  if c.id is null or c.status <> 'submitted' then raise exception 'This claim isn''t awaiting a decision.'; end if;
  if c.employee_id = me then raise exception 'You can''t approve your own claim.' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Give a reason when rejecting.'; end if;
  select * into emp from public.employees where id = c.employee_id;

  if c.stage = 'manager' then
    if not (private.is_hr() or private.can_see_team(c.employee_id)) then
      raise exception 'Only the line manager, HOD or HR can decide this claim.' using errcode = '42501';
    end if;
    update public.expense_claims set manager_decided_by = me, manager_decided_at = now(), decision_comment = p_comment,
      status = case when p_approve then 'submitted' else 'rejected' end,
      stage = case when p_approve then 'finance' else 'done' end
     where id = p_claim;
    if p_approve then
      perform private.notify_roles(array['finance']::public.app_role[], 'Expense claim to verify', c.claim_no || ' — ' || emp.full_name, '/expenses/approvals');
    end if;
  elsif c.stage = 'finance' then
    if not private.is_finance() then raise exception 'Finance verifies claims at this stage.' using errcode = '42501'; end if;
    if p_approve then
      select cost_center_id into dept_cc from public.departments where id = emp.department_id;
      insert into public.journal_entries (entry_date, description, source, source_id)
      values (current_date, 'Expense claim ' || c.claim_no || ' — ' || emp.full_name, 'manual', c.id)
      returning id into je;
      insert into public.journal_entry_lines (journal_entry_id, account_id, cost_center_id, debit, description)
      select je, k.account_id, dept_cc, sum(i.amount), k.name
        from public.expense_items i join public.expense_categories k on k.id = i.category_id
       where i.claim_id = p_claim group by k.account_id, k.name;
      if c.advance_adjusted > 0 then
        insert into public.journal_entry_lines (journal_entry_id, account_id, credit, description)
        values (je, private.account_id('1320'), c.advance_adjusted, 'Travel advance adjusted');
        update public.travel_requests set advance_settled = advance_settled + c.advance_adjusted where id = c.travel_request_id;
      end if;
      if c.net_payable > 0 then
        insert into public.journal_entry_lines (journal_entry_id, account_id, credit, description)
        values (je, private.account_id('2310'), c.net_payable, 'Reimbursable to ' || emp.full_name);
      end if;
      -- Source tag for traceability; 'manual' + system creator keeps the journal non-reversible from the UI.
      update public.journal_entries set source = 'manual' where id = je;
      perform private.post_journal(je);
    end if;
    update public.expense_claims set finance_decided_by = me, finance_decided_at = now(),
      decision_comment = coalesce(p_comment, decision_comment),
      status = case when p_approve then (case when c.net_payable <= 0 then 'paid' else 'approved' end) else 'rejected' end,
      stage = 'done', journal_entry_id = je
     where id = p_claim;
  else
    raise exception 'This claim has already been decided.';
  end if;
  perform private.notify_employee(c.employee_id,
    'Expense claim ' || case when not p_approve then 'rejected' when c.stage = 'manager' then 'approved by manager' else 'approved' end,
    c.claim_no || coalesce(' — ' || p_comment, ''), '/expenses');
  return (select status from public.expense_claims where id = p_claim);
end $$;

-- Reimbursement by bank (EXP-06): Dr reimbursements payable / Cr bank.
create function public.exp_pay(p_claim uuid, p_bank uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c    public.expense_claims;
  je   uuid;
  bank uuid;
begin
  perform private.require_finance();
  select * into c from public.expense_claims where id = p_claim for update;
  if c.id is null or c.status <> 'approved' then raise exception 'Only approved, unpaid claims can be paid.'; end if;
  select gl_account_id into bank from public.bank_accounts where id = p_bank;
  if bank is null then raise exception 'Choose a bank account.'; end if;
  insert into public.journal_entries (entry_date, description, source, source_id)
  values (current_date, 'Reimbursement ' || c.claim_no, 'manual', c.id) returning id into je;
  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
    (je, private.account_id('2310'), c.net_payable, 0, 'Reimbursement payable cleared'),
    (je, bank, 0, c.net_payable, 'Paid to employee');
  perform private.post_journal(je);
  update public.expense_claims set status = 'paid', paid_entry_id = je, paid_at = now() where id = p_claim;
  perform private.notify_employee(c.employee_id, 'Expense reimbursed', c.claim_no || ' — PKR ' || c.net_payable, '/expenses');
end $$;

create function private.travel_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare emp public.employees;
begin
  if auth.uid() is not null and new.employee_id is distinct from private.current_employee_id() then
    raise exception 'You can only request travel for yourself.' using errcode = '42501';
  end if;
  select * into emp from public.employees where id = new.employee_id;
  new.status := 'pending';
  new.stage := case when emp.manager_id is null then 'finance' else 'manager' end;
  new.advance_paid := 0;
  new.advance_settled := 0;
  new.advance_entry_id := null;
  if new.stage = 'manager' then
    perform private.notify_employee(emp.manager_id, 'Travel request from ' || emp.full_name, new.destination || ', ' || to_char(new.start_date, 'DD Mon'), '/expenses/approvals');
  else
    perform private.notify_roles(array['finance']::public.app_role[], 'Travel request from ' || emp.full_name, new.destination, '/expenses/approvals');
  end if;
  return new;
end $$;
create trigger travel_before_insert before insert on public.travel_requests
  for each row execute function private.travel_before_insert();

create function private.travel_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if new.status = 'cancelled' and old.status = 'pending' and old.employee_id = private.current_employee_id()
       and (new.employee_id, new.purpose, new.destination, new.start_date, new.end_date, new.estimated_cost, new.advance_requested, new.advance_paid)
           is not distinct from (old.employee_id, old.purpose, old.destination, old.start_date, old.end_date, old.estimated_cost, old.advance_requested, old.advance_paid) then
      new.stage := 'done';
      return new;
    end if;
    raise exception 'Use the approve actions to change a travel request.';
  end if;
  return new;
end $$;
create trigger travel_guard before update on public.travel_requests
  for each row execute function private.travel_guard();

-- Manager approves → Finance approves and (optionally) pays the advance: Dr 1320 / Cr bank.
create function public.travel_decide(p_req uuid, p_approve boolean, p_comment text, p_bank uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  t    public.travel_requests;
  me   uuid := private.current_employee_id();
  je   uuid;
  bank uuid;
  who  text;
begin
  select * into t from public.travel_requests where id = p_req for update;
  if t.id is null or t.status <> 'pending' then raise exception 'This request isn''t awaiting a decision.'; end if;
  if t.employee_id = me then raise exception 'You can''t approve your own request.' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Give a reason when rejecting.'; end if;
  select full_name into who from public.employees where id = t.employee_id;
  if t.stage = 'manager' then
    if not (private.is_hr() or private.can_see_team(t.employee_id)) then
      raise exception 'Only the line manager, HOD or HR can decide this request.' using errcode = '42501';
    end if;
    if p_approve and t.advance_requested > 0 then
      update public.travel_requests set stage = 'finance', decision_comment = p_comment where id = p_req;
      perform private.notify_roles(array['finance']::public.app_role[], 'Travel advance to approve', who || ' — PKR ' || t.advance_requested, '/expenses/approvals');
    else
      update public.travel_requests set status = case when p_approve then 'approved' else 'rejected' end, stage = 'done',
        decided_by = me, decided_at = now(), decision_comment = p_comment where id = p_req;
    end if;
  else
    if not private.is_finance() then raise exception 'Finance approves travel advances.' using errcode = '42501'; end if;
    if p_approve and t.advance_requested > 0 then
      select gl_account_id into bank from public.bank_accounts where id = p_bank;
      if bank is null then raise exception 'Choose the bank account the advance is paid from.'; end if;
      insert into public.journal_entries (entry_date, description, source, source_id)
      values (current_date, 'Travel advance — ' || who || ' (' || t.destination || ')', 'manual', t.id) returning id into je;
      insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
        (je, private.account_id('1320'), t.advance_requested, 0, 'Travel advance'),
        (je, bank, 0, t.advance_requested, 'Paid to ' || who);
      perform private.post_journal(je);
    end if;
    update public.travel_requests set status = case when p_approve then 'approved' else 'rejected' end, stage = 'done',
      decided_by = me, decided_at = now(), decision_comment = coalesce(p_comment, decision_comment),
      advance_paid = case when p_approve then t.advance_requested else 0 end, advance_entry_id = je
     where id = p_req;
  end if;
  if (select status from public.travel_requests where id = p_req) <> 'pending' then
    perform private.notify_employee(t.employee_id, 'Travel request ' || (select status from public.travel_requests where id = p_req)::text,
      t.destination || coalesce(' — ' || p_comment, ''), '/expenses');
  end if;
  return (select status::text from public.travel_requests where id = p_req);
end $$;

-- ---------------------------------------------------------------------
-- Loan applications (LN-01, 7.8): employee → manager → Finance → loan created & disbursed.
-- ---------------------------------------------------------------------
create table public.loan_applications (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees (id) on delete cascade,
  loan_type         text not null default 'loan' check (loan_type in ('loan', 'advance')),
  amount            numeric(14, 2) not null check (amount > 0),
  installments      integer not null check (installments between 1 and 60),
  purpose           text not null,
  status            public.leave_status not null default 'pending',
  stage             text not null default 'manager' check (stage in ('manager', 'finance', 'done')),
  decided_by        uuid references public.employees (id),
  decided_at        timestamptz,
  decision_comment  text,
  loan_id           uuid references public.loans (id),
  created_at        timestamptz not null default now()
);
create index loan_apps_employee_idx on public.loan_applications (employee_id);

create function private.loan_app_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare emp public.employees;
begin
  if auth.uid() is not null and new.employee_id is distinct from private.current_employee_id() then
    raise exception 'You can only apply for yourself.' using errcode = '42501';
  end if;
  if exists (select 1 from public.loan_applications where employee_id = new.employee_id and status = 'pending') then
    raise exception 'You already have a pending application.';
  end if;
  select * into emp from public.employees where id = new.employee_id;
  new.status := 'pending';
  new.stage := case when emp.manager_id is null then 'finance' else 'manager' end;
  new.loan_id := null;
  if new.stage = 'manager' then
    perform private.notify_employee(emp.manager_id, initcap(new.loan_type) || ' application from ' || emp.full_name, 'PKR ' || new.amount, '/loans/approvals');
  else
    perform private.notify_roles(array['finance']::public.app_role[], initcap(new.loan_type) || ' application from ' || emp.full_name, 'PKR ' || new.amount, '/loans/approvals');
  end if;
  return new;
end $$;
create trigger loan_app_before_insert before insert on public.loan_applications
  for each row execute function private.loan_app_before_insert();

create function private.loan_app_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if new.status = 'cancelled' and old.status = 'pending' and old.employee_id = private.current_employee_id()
       and (new.amount, new.installments, new.employee_id) is not distinct from (old.amount, old.installments, old.employee_id) then
      new.stage := 'done';
      return new;
    end if;
    raise exception 'Use the approve actions to change an application.';
  end if;
  return new;
end $$;
create trigger loan_app_guard before update on public.loan_applications
  for each row execute function private.loan_app_guard();

create function public.loan_app_decide(p_app uuid, p_approve boolean, p_comment text, p_start_month date default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  a    public.loan_applications;
  me   uuid := private.current_employee_id();
  ln   uuid;
  who  text;
  start date;
begin
  select * into a from public.loan_applications where id = p_app for update;
  if a.id is null or a.status <> 'pending' then raise exception 'This application isn''t awaiting a decision.'; end if;
  if a.employee_id = me then raise exception 'You can''t approve your own application.' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Give a reason when rejecting.'; end if;
  select full_name into who from public.employees where id = a.employee_id;
  if a.stage = 'manager' then
    if not (private.is_hr() or private.can_see_team(a.employee_id)) then
      raise exception 'Only the line manager, HOD or HR can decide this application.' using errcode = '42501';
    end if;
    if p_approve then
      update public.loan_applications set stage = 'finance', decision_comment = p_comment where id = p_app;
      perform private.notify_roles(array['finance']::public.app_role[], initcap(a.loan_type) || ' to approve', who || ' — PKR ' || a.amount, '/loans/approvals');
      return 'pending';
    end if;
  else
    if not private.is_finance() then raise exception 'Finance approves loans.' using errcode = '42501'; end if;
    if p_approve then
      start := coalesce(date_trunc('month', p_start_month)::date, (date_trunc('month', current_date) + interval '1 month')::date);
      insert into public.loans (employee_id, loan_type, principal, installment_amount, start_month, purpose)
      values (a.employee_id, a.loan_type, a.amount, round(a.amount / a.installments, 2), start, a.purpose)
      returning id into ln;
    end if;
  end if;
  update public.loan_applications set status = case when p_approve then 'approved' else 'rejected' end, stage = 'done',
    decided_by = me, decided_at = now(), decision_comment = coalesce(p_comment, decision_comment), loan_id = ln
   where id = p_app;
  perform private.notify_employee(a.employee_id, initcap(a.loan_type) || case when p_approve then ' approved' else ' rejected' end,
    'PKR ' || a.amount || coalesce(' — ' || p_comment, ''), '/payslips');
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

-- ---------------------------------------------------------------------
-- Helpdesk (6.14)
-- ---------------------------------------------------------------------
create type public.ticket_status as enum ('open', 'in_progress', 'pending', 'resolved', 'closed');
create type public.ticket_priority as enum ('low', 'medium', 'high', 'critical');

create table public.ticket_categories (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null unique,
  default_assignee_id    uuid references public.employees (id),
  sla_response_hours     integer not null default 8 check (sla_response_hours > 0),
  sla_resolution_hours   integer not null default 48 check (sla_resolution_hours > 0),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now()
);
insert into public.ticket_categories (name, sla_response_hours, sla_resolution_hours) values
  ('Payroll & payslips', 8, 48),
  ('Leave & attendance', 8, 24),
  ('IT & system access', 4, 24),
  ('Documents & letters', 8, 72),
  ('Benefits & loans', 8, 72),
  ('Other HR query', 24, 120);

create sequence public.ticket_no_seq;
create table public.tickets (
  id                 uuid primary key default gen_random_uuid(),
  ticket_no          text not null unique default ('HD-' || lpad(nextval('public.ticket_no_seq')::text, 6, '0')),
  requester_id       uuid not null references public.employees (id) on delete cascade,
  category_id        uuid not null references public.ticket_categories (id),
  subject            text not null,
  description        text not null,
  priority           public.ticket_priority not null default 'medium',
  status             public.ticket_status not null default 'open',
  assignee_id        uuid references public.employees (id),
  response_due_at    timestamptz,
  resolution_due_at  timestamptz,
  first_response_at  timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  escalated          boolean not null default false,
  satisfaction       integer check (satisfaction between 1 and 5),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index tickets_requester_idx on public.tickets (requester_id);
create index tickets_assignee_idx on public.tickets (assignee_id, status);

create table public.ticket_comments (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.tickets (id) on delete cascade,
  author_id    uuid references public.employees (id),
  body         text not null check (length(trim(body)) > 0),
  is_internal  boolean not null default false,
  created_at   timestamptz not null default now()
);
create index ticket_comments_ticket_idx on public.ticket_comments (ticket_id, created_at);

-- Agents: HR + System Admin + the ticket's assignee.
create function private.is_ticket_agent(p_ticket uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_hr() or exists (
    select 1 from public.tickets t where t.id = p_ticket and t.assignee_id = private.current_employee_id()
  );
$$;

create function private.ticket_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cat  public.ticket_categories;
  mult numeric;
begin
  if auth.uid() is not null and not private.is_hr() and new.requester_id is distinct from private.current_employee_id() then
    raise exception 'You can only raise tickets for yourself.' using errcode = '42501';
  end if;
  select * into cat from public.ticket_categories where id = new.category_id;
  mult := case new.priority when 'critical' then 0.25 when 'high' then 0.5 when 'medium' then 1 else 2 end;
  new.status := 'open';
  new.assignee_id := coalesce(new.assignee_id, cat.default_assignee_id);
  new.response_due_at := now() + make_interval(mins => (cat.sla_response_hours * 60 * mult)::int);
  new.resolution_due_at := now() + make_interval(mins => (cat.sla_resolution_hours * 60 * mult)::int);
  new.first_response_at := null;
  new.resolved_at := null;
  new.closed_at := null;
  new.escalated := false;
  new.satisfaction := null;
  if new.assignee_id is not null then
    perform private.notify_employee(new.assignee_id, 'New ticket assigned: ' || new.subject, new.priority::text || ' priority', '/helpdesk');
  else
    perform private.notify_roles(array['hr_admin']::public.app_role[], 'New helpdesk ticket: ' || new.subject, cat.name || ' · ' || new.priority::text, '/helpdesk');
  end if;
  return new;
end $$;
create trigger tickets_before_insert before insert on public.tickets
  for each row execute function private.ticket_before_insert();

-- Requester may only close/reopen own resolved ticket and rate it; agents work the ticket.
create function private.ticket_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare agent boolean := auth.uid() is null or private.is_ticket_agent(old.id);
begin
  if (new.requester_id, new.category_id, new.subject, new.description, new.ticket_no, new.response_due_at, new.resolution_due_at, new.first_response_at, new.escalated)
     is distinct from (old.requester_id, old.category_id, old.subject, old.description, old.ticket_no, old.response_due_at, old.resolution_due_at, old.first_response_at, old.escalated)
     and auth.uid() is not null then
    raise exception 'These ticket fields can''t be changed.';
  end if;
  if not agent then
    if old.requester_id is distinct from private.current_employee_id() then
      raise exception 'Not your ticket.' using errcode = '42501';
    end if;
    if (new.priority, new.assignee_id) is distinct from (old.priority, old.assignee_id)
       or not (new.status = old.status or (old.status = 'resolved' and new.status in ('closed', 'open')))
       or (new.satisfaction is distinct from old.satisfaction and old.status not in ('resolved', 'closed')) then
      raise exception 'You can close, reopen or rate a resolved ticket.' using errcode = '42501';
    end if;
  end if;
  if new.status = 'resolved' and old.status <> 'resolved' then new.resolved_at := now(); end if;
  if new.status = 'closed' and old.status <> 'closed' then new.closed_at := now(); end if;
  if new.status = 'open' and old.status = 'resolved' then new.resolved_at := null; end if;
  new.updated_at := now();
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform private.notify_employee(new.assignee_id, 'Ticket assigned to you: ' || new.subject, old.ticket_no, '/helpdesk/' || old.id);
  end if;
  if new.status is distinct from old.status then
    perform private.notify_employee(old.requester_id, 'Ticket ' || old.ticket_no || ' is ' || replace(new.status::text, '_', ' '), old.subject, '/helpdesk/' || old.id);
  end if;
  return new;
end $$;
create trigger tickets_before_update before update on public.tickets
  for each row execute function private.ticket_before_update();

create function private.ticket_comment_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t     public.tickets;
  me    uuid := private.current_employee_id();
  agent boolean;
begin
  select * into t from public.tickets where id = new.ticket_id;
  agent := private.is_ticket_agent(t.id);
  if not agent and t.requester_id is distinct from me then raise exception 'Not your ticket.' using errcode = '42501'; end if;
  if not agent then new.is_internal := false; end if;
  new.author_id := me;
  if agent and t.first_response_at is null and t.requester_id is distinct from me and not new.is_internal then
    update public.tickets set first_response_at = now(), status = case when status = 'open' then 'in_progress' else status end where id = t.id;
  end if;
  if not new.is_internal then
    if agent then
      perform private.notify_employee(t.requester_id, 'Reply on ' || t.ticket_no, left(new.body, 120), '/helpdesk/' || t.id);
    elsif t.assignee_id is not null then
      perform private.notify_employee(t.assignee_id, 'Requester replied on ' || t.ticket_no, left(new.body, 120), '/helpdesk/' || t.id);
    end if;
  end if;
  return new;
end $$;
create trigger ticket_comments_before_insert before insert on public.ticket_comments
  for each row execute function private.ticket_comment_before_insert();

-- Hourly SLA escalation (HD-04).
create function private.escalate_tickets() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  n integer := 0;
begin
  for t in
    select * from public.tickets
     where not escalated and status not in ('resolved', 'closed')
       and ((first_response_at is null and response_due_at < now()) or resolution_due_at < now())
  loop
    update public.tickets set escalated = true where id = t.id;
    perform private.notify_roles(array['hr_admin']::public.app_role[], 'SLA breached: ' || t.ticket_no, t.subject, '/helpdesk/' || t.id);
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('helpdesk-sla-escalation', '15 * * * *', $$select private.escalate_tickets()$$);

-- ---------------------------------------------------------------------
-- Storage: receipts bucket {employee_id}/{claim_id}/{file}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 4194304, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "expense-receipts: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-receipts' and (storage.foldername(name))[1] = (select private.current_employee_id())::text);
create policy "expense-receipts: read own, team, finance, hr" on storage.objects for select to authenticated
  using (
    bucket_id = 'expense-receipts' and (
      (storage.foldername(name))[1] = (select private.current_employee_id())::text
      or (select private.has_any_role(array['finance', 'hr_admin', 'system_admin', 'auditor']::public.app_role[]))
      or exists (select 1 from public.employees e where e.id::text = (storage.foldername(name))[1] and private.can_see_team(e.id))
    )
  );

-- ---------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['expense_categories', 'travel_requests', 'expense_claims', 'expense_items', 'loan_applications', 'ticket_categories', 'tickets', 'ticket_comments'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.expense_categories enable row level security;
alter table public.travel_requests enable row level security;
alter table public.expense_claims enable row level security;
alter table public.expense_items enable row level security;
alter table public.loan_applications enable row level security;
alter table public.ticket_categories enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;

create policy "notifications: own" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: mark read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: delete own" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

create policy "expense_categories: read" on public.expense_categories for select to authenticated using (true);
create policy "expense_categories: finance write" on public.expense_categories for insert to authenticated with check ((select private.is_finance()));
create policy "expense_categories: finance update" on public.expense_categories for update to authenticated
  using ((select private.is_finance())) with check ((select private.is_finance()));

-- Own / team / Finance+HR+Exec+Auditor read (matrix: Expenses).
do $$
declare t text;
begin
  foreach t in array array['travel_requests', 'expense_claims', 'loan_applications'] loop
    execute format($f$create policy "%s: read" on public.%I for select to authenticated using (
      employee_id = (select private.current_employee_id())
      or (select private.has_any_role(array['hr_admin','system_admin','finance','executive','auditor']::public.app_role[]))
      or private.can_see_team(employee_id))$f$, t, t);
  end loop;
end $$;
create policy "travel: request" on public.travel_requests for insert to authenticated
  with check (employee_id = (select private.current_employee_id()));
create policy "travel: cancel own" on public.travel_requests for update to authenticated
  using (employee_id = (select private.current_employee_id())) with check (employee_id = (select private.current_employee_id()));
create policy "loan_apps: apply" on public.loan_applications for insert to authenticated
  with check (employee_id = (select private.current_employee_id()));
create policy "loan_apps: cancel own" on public.loan_applications for update to authenticated
  using (employee_id = (select private.current_employee_id())) with check (employee_id = (select private.current_employee_id()));
create policy "claims: create own" on public.expense_claims for insert to authenticated
  with check (employee_id = (select private.current_employee_id()) and status = 'draft');
create policy "claims: edit own draft" on public.expense_claims for update to authenticated
  using (employee_id = (select private.current_employee_id()) and status = 'draft')
  with check (employee_id = (select private.current_employee_id()));
create policy "claims: delete own draft" on public.expense_claims for delete to authenticated
  using (employee_id = (select private.current_employee_id()) and status = 'draft');

create policy "expense_items: read" on public.expense_items for select to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id));
create policy "expense_items: own draft insert" on public.expense_items for insert to authenticated
  with check (exists (select 1 from public.expense_claims c where c.id = claim_id and c.employee_id = (select private.current_employee_id()) and c.status = 'draft'));
create policy "expense_items: own draft delete" on public.expense_items for delete to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id and c.employee_id = (select private.current_employee_id()) and c.status = 'draft'));

create policy "ticket_categories: read" on public.ticket_categories for select to authenticated using (true);
create policy "ticket_categories: hr insert" on public.ticket_categories for insert to authenticated with check ((select private.is_hr()));
create policy "ticket_categories: hr update" on public.ticket_categories for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));

-- Matrix Helpdesk: Employee CRUD own, HR CRUD, Exec/Finance/HOD read.
create policy "tickets: read" on public.tickets for select to authenticated
  using (
    requester_id = (select private.current_employee_id())
    or assignee_id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'finance', 'auditor']::public.app_role[]))
  );
create policy "tickets: raise" on public.tickets for insert to authenticated
  with check (requester_id = (select private.current_employee_id()) or (select private.is_hr()));
create policy "tickets: update" on public.tickets for update to authenticated
  using (requester_id = (select private.current_employee_id()) or private.is_ticket_agent(id))
  with check (requester_id = (select private.current_employee_id()) or private.is_ticket_agent(id));

create policy "ticket_comments: read" on public.ticket_comments for select to authenticated
  using (
    exists (select 1 from public.tickets t where t.id = ticket_id)
    and (not is_internal or private.is_ticket_agent(ticket_id) or (select private.has_any_role(array['executive', 'auditor']::public.app_role[])))
  );
create policy "ticket_comments: add" on public.ticket_comments for insert to authenticated
  with check (exists (select 1 from public.tickets t where t.id = ticket_id));

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on public.notifications, public.expense_categories, public.travel_requests, public.expense_claims,
  public.expense_items, public.loan_applications, public.ticket_categories, public.tickets, public.ticket_comments
  from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update on public.expense_categories, public.travel_requests, public.loan_applications,
  public.ticket_categories, public.tickets to authenticated;
grant select, insert, update, delete on public.expense_claims to authenticated;
grant select, insert, delete on public.expense_items, public.ticket_comments to authenticated;
grant usage on sequence public.expense_claim_no_seq, public.ticket_no_seq to authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_any_role(public.app_role[]), private.is_hr(), private.current_employee_id(), private.can_see_team(uuid),
  private.is_payroll(), private.is_finance(), private.can_read_payroll(), private.payroll_released(uuid),
  private.tax_year_of(date), private.is_ticket_agent(uuid)
to authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.link_auth_user() to supabase_auth_admin;

do $$
declare f text;
begin
  foreach f in array array[
    'public.exp_submit(uuid)', 'public.exp_decide(uuid, boolean, text)', 'public.exp_pay(uuid, uuid)',
    'public.travel_decide(uuid, boolean, text, uuid)', 'public.loan_app_decide(uuid, boolean, text, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

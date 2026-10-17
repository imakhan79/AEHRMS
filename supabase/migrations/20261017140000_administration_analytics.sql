-- =====================================================================
-- Administration (6.17: ADM-01, ADM-03, ADM-04, ADM-06) and scheduled
-- report delivery (6.16: ANL-05).
-- =====================================================================

-- =================== SYSTEM SETTINGS (ADM-06) ===================
-- One row. Fiscal year follows the Pakistan tax year (July–June, private.tax_year_of).
create table public.system_settings (
  id                boolean primary key default true check (id),
  company_name      text not null default 'AE Global Group of Companies',
  legal_name        text,
  ntn               text,
  strn              text,
  address           text,
  phone             text,
  email             text,
  website           text,
  currency          text not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  timezone          text not null default 'Asia/Karachi',
  week_start        text not null default 'monday' check (week_start in ('monday', 'sunday', 'saturday')),
  updated_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now()
);
insert into public.system_settings (id) values (true);

create function private.touch_settings() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger system_settings_touch before update on public.system_settings
  for each row execute function private.touch_settings();

-- =================== WORKFLOW RULES (ADM-03) ===================
-- Configures the manager step of each approval chain, and when leave also needs HR.
-- Finance verification of money (expenses, travel, loans) can't be skipped: it posts to the GL.
create table public.workflow_rules (
  workflow           text primary key check (workflow in ('leave', 'expense', 'travel', 'loan')),
  manager_approval   text not null default 'always' check (manager_approval in ('always', 'above', 'never')),
  manager_threshold  numeric(14, 2) check (manager_threshold >= 0),
  hr_above_days      numeric(5, 1) check (hr_above_days >= 0),  -- leave only: HR also approves above this many days
  updated_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  check (manager_approval <> 'above' or manager_threshold is not null),
  check (workflow = 'leave' or hr_above_days is null)
);
insert into public.workflow_rules (workflow) values ('leave'), ('expense'), ('travel'), ('loan');
create trigger workflow_rules_touch before update on public.workflow_rules
  for each row execute function private.touch_settings();

-- Does a request of this size go to the line manager first? (Employees without a manager skip it anyway.)
create function private.wf_needs_manager(p_workflow text, p_value numeric) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case r.manager_approval
             when 'never' then false
             when 'above' then coalesce(p_value, 0) > r.manager_threshold
             else true
           end
      from public.workflow_rules r where r.workflow = p_workflow
  ), true);
$$;

create function private.wf_leave_needs_hr(p_days numeric) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p_days > r.hr_above_days from public.workflow_rules r where r.workflow = 'leave'), false);
$$;

-- =================== NOTIFICATION RULES (ADM-04) ===================
-- Turn whole categories of in-app notifications on or off, matched on the link they open.
create table public.notification_rules (
  module       text primary key,
  label        text not null,
  link_prefix  text not null unique check (link_prefix like '/%'),
  enabled      boolean not null default true,
  sort_order   integer not null default 0,
  updated_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now()
);
insert into public.notification_rules (module, label, link_prefix, sort_order) values
  ('leave', 'Leave requests and decisions', '/leave', 10),
  ('attendance', 'Attendance corrections and field punches', '/attendance', 20),
  ('payroll', 'Payroll approvals and payslips', '/payroll', 30),
  ('expenses', 'Expense claims and travel requests', '/expenses', 40),
  ('loans', 'Loan applications', '/loans', 50),
  ('helpdesk', 'Helpdesk tickets and SLA escalations', '/helpdesk', 60),
  ('recruitment', 'Recruitment and interviews', '/recruitment', 70),
  ('performance', 'Appraisals, goals and probation reminders', '/performance', 80),
  ('training', 'Training and certification reminders', '/training', 90),
  ('assets', 'Asset issue and returns', '/assets', 100),
  ('benefits', 'Benefit enrolments', '/benefits', 110),
  ('exit', 'Resignations and clearance', '/exit', 120),
  ('reports', 'Scheduled report digests', '/analytics', 130);
create trigger notification_rules_touch before update on public.notification_rules
  for each row execute function private.touch_settings();

create function private.notification_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.notification_rules r
     where not r.enabled
       and (new.link = r.link_prefix or new.link like r.link_prefix || '/%' or new.link like r.link_prefix || '?%' or new.link like r.link_prefix || '#%')
  ) then
    return null;  -- category switched off by an admin
  end if;
  return new;
end $$;
create trigger notifications_gate before insert on public.notifications
  for each row execute function private.notification_gate();

-- =================== USER MANAGEMENT (ADM-01) ===================
-- auth.users isn't exposed to the API, so admins read and disable accounts through these.
create function public.admin_list_users()
returns table (
  user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, confirmed boolean,
  disabled boolean, employee_id uuid, employee_name text, employee_code text, roles text[]
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_any_role(array['system_admin']::public.app_role[]) then
    raise exception 'Only a System Admin can manage users.' using errcode = '42501';
  end if;
  return query
  select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null,
         coalesce(u.banned_until > now(), false), e.id, e.full_name, e.employee_code,
         coalesce((select array_agg(distinct r.role::text order by r.role::text) from public.user_roles r where r.user_id = u.id), '{}')
    from auth.users u
    left join public.employees e on e.user_id = u.id and e.deleted_at is null
   order by coalesce(e.full_name, u.email::text);
end $$;

create function public.admin_set_user_disabled(p_user uuid, p_disabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_any_role(array['system_admin']::public.app_role[]) then
    raise exception 'Only a System Admin can manage users.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'You can''t disable your own account.'; end if;
  update auth.users set banned_until = case when p_disabled then 'infinity'::timestamptz end, updated_at = now()
   where id = p_user;
  if not found then raise exception 'User not found.'; end if;
  if p_disabled then
    delete from auth.sessions where user_id = p_user;  -- refresh tokens cascade
  end if;
  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
  values ('auth.users', p_user::text, 'UPDATE', jsonb_build_object('disabled', not p_disabled), jsonb_build_object('disabled', p_disabled), auth.uid());
end $$;

-- =================== SCHEDULED REPORTS (ANL-05) ===================
create table public.report_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  report        text not null check (report in ('workforce', 'attendance', 'leave', 'payroll', 'finance', 'recruitment')),
  frequency     text not null default 'weekly' check (frequency in ('daily', 'weekly', 'monthly')),
  last_sent_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, report)
);

-- Which roles may receive each digest (mirrors who can open the matching analytics view).
create function private.report_allowed(p_user uuid, p_report text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles r
     where r.user_id = p_user
       and r.role = any (case p_report
         when 'workforce'   then array['hr_admin', 'system_admin', 'executive', 'auditor']
         when 'attendance'  then array['hr_admin', 'system_admin', 'executive', 'auditor']
         when 'leave'       then array['hr_admin', 'system_admin', 'executive', 'auditor']
         when 'recruitment' then array['hr_admin', 'system_admin', 'executive', 'recruiter']
         when 'payroll'     then array['hr_admin', 'system_admin', 'executive', 'auditor', 'finance']
         when 'finance'     then array['system_admin', 'executive', 'auditor', 'finance']
       end::public.app_role[])
  );
$$;

-- Plain-text summary of one digest, org-wide (only sent to roles allowed above).
create function private.report_digest(p_report text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  t     date := (now() at time zone 'Asia/Karachi')::date;
  m0    date := date_trunc('month', t)::date;
  a     numeric; b numeric; c numeric; d numeric;
  pm    date;
begin
  if p_report = 'workforce' then
    select count(*) filter (where status not in ('exited', 'draft')),
           count(*) filter (where joining_date >= m0),
           count(*) filter (where status = 'exited' and exit_date >= m0),
           count(*) filter (where status = 'probation')
      into a, b, c, d from public.employees where deleted_at is null;
    return format('Active headcount %s · %s joined and %s left this month · %s on probation.', a, b, c, d);
  elsif p_report = 'attendance' then
    select count(distinct employee_id) into a from public.attendance_punches where work_date = t and punch_type = 'in' and verification <> 'rejected';
    select count(*) into b from public.employees where deleted_at is null and status not in ('exited', 'draft');
    select count(*) filter (where status = 'late'), count(*) filter (where status = 'absent')
      into c, d from public.attendance where work_date >= m0;
    return format('%s of %s checked in today · month to date: %s late arrivals, %s absences.', a, b, c, d);
  elsif p_report = 'leave' then
    select count(distinct employee_id) into a from public.leave_requests where status = 'approved' and t between start_date and end_date;
    select count(*) into b from public.leave_requests where status = 'pending';
    select coalesce(sum(days), 0) into c from public.leave_requests where status = 'approved' and start_date >= m0;
    return format('%s on leave today · %s requests pending · %s days approved this month.', a, b, c);
  elsif p_report = 'recruitment' then
    select count(*) into a from public.requisitions where status = 'approved';
    select count(*) filter (where stage not in ('hired', 'rejected')), count(*) filter (where stage = 'hired' and updated_at >= m0)
      into b, c from public.candidates;
    return format('%s open requisitions · %s candidates in the pipeline · %s hired this month.', a, b, c);
  elsif p_report = 'payroll' then
    select r.period_month, coalesce(sum(p.gross_pay), 0), coalesce(sum(p.net_pay), 0), count(p.id)
      into pm, a, b, c
      from public.payroll_runs r left join public.payslips p on p.payroll_run_id = r.id
     where r.status in ('approved', 'posted', 'paid')
     group by r.id, r.period_month order by r.period_month desc limit 1;
    if c is null then return 'No approved payroll yet.'; end if;
    return format('%s payroll: %s staff · gross PKR %s · net PKR %s.', to_char(pm, 'FMMonth YYYY'), c, to_char(a, 'FM999,999,999,990'), to_char(b, 'FM999,999,999,990'));
  elsif p_report = 'finance' then
    select coalesce(sum(total - amount_paid), 0) into a from public.bills where status = 'posted';
    select coalesce(sum(total - amount_received), 0) into b from public.invoices where status = 'posted';
    select coalesce(sum(l.debit - l.credit), 0) into c
      from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id
      join public.bank_accounts ba on ba.gl_account_id = l.account_id
     where j.status = 'posted';
    return format('Cash at bank PKR %s · payables outstanding PKR %s · receivables outstanding PKR %s.',
      to_char(c, 'FM999,999,999,990'), to_char(a, 'FM999,999,999,990'), to_char(b, 'FM999,999,999,990'));
  end if;
  return null;
end $$;

-- Runs daily (cron below). Daily digests every day; weekly on Mondays; monthly on the 1st.
create function private.deliver_report_digests() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s     record;
  t     date := (now() at time zone 'Asia/Karachi')::date;
  body  text;
  n     integer := 0;
  names constant jsonb := '{"workforce":"Workforce","attendance":"Attendance","leave":"Leave","payroll":"Payroll","finance":"Finance","recruitment":"Recruitment"}';
begin
  for s in
    select * from public.report_subscriptions
     where (frequency = 'daily'
         or (frequency = 'weekly' and extract(isodow from t) = 1)
         or (frequency = 'monthly' and extract(day from t) = 1))
       and (last_sent_at is null or (last_sent_at at time zone 'Asia/Karachi')::date < t)
  loop
    if private.report_allowed(s.user_id, s.report) then
      body := private.report_digest(s.report);
      insert into public.notifications (user_id, title, body, link)
      values (s.user_id, initcap(s.frequency) || ' ' || (names ->> s.report) || ' report', body, '/analytics?view=' || s.report);
      n := n + 1;
    end if;
    update public.report_subscriptions set last_sent_at = now() where id = s.id;
  end loop;
  return n;
end $$;

-- 03:00 UTC = 08:00 Pakistan time.
select cron.schedule('report-digests', '0 3 * * *', $$select private.deliver_report_digests()$$);

-- =================== Audit, RLS, grants ===================
do $$
declare t text;
begin
  foreach t in array array['system_settings', 'workflow_rules', 'notification_rules', 'report_subscriptions'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit()', t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "system_settings: read" on public.system_settings for select to authenticated using (true);
create policy "system_settings: admin update" on public.system_settings for update to authenticated
  using ((select private.has_any_role(array['system_admin']::public.app_role[])))
  with check ((select private.has_any_role(array['system_admin']::public.app_role[])));

create policy "workflow_rules: read" on public.workflow_rules for select to authenticated using (true);
create policy "workflow_rules: admin update" on public.workflow_rules for update to authenticated
  using ((select private.has_any_role(array['system_admin']::public.app_role[])))
  with check ((select private.has_any_role(array['system_admin']::public.app_role[])));

create policy "notification_rules: read" on public.notification_rules for select to authenticated using (true);
create policy "notification_rules: admin update" on public.notification_rules for update to authenticated
  using ((select private.has_any_role(array['system_admin']::public.app_role[])))
  with check ((select private.has_any_role(array['system_admin']::public.app_role[])));

create policy "report_subscriptions: own read" on public.report_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "report_subscriptions: own insert" on public.report_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and private.report_allowed((select auth.uid()), report));
create policy "report_subscriptions: own update" on public.report_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.report_allowed((select auth.uid()), report));
create policy "report_subscriptions: own delete" on public.report_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.system_settings, public.workflow_rules, public.notification_rules, public.report_subscriptions from anon, authenticated;
grant select on public.system_settings, public.workflow_rules, public.notification_rules to authenticated;
grant update (company_name, legal_name, ntn, strn, address, phone, email, website, currency, timezone, week_start) on public.system_settings to authenticated;
grant update (manager_approval, manager_threshold, hr_above_days) on public.workflow_rules to authenticated;
grant update (enabled) on public.notification_rules to authenticated;
grant select, insert, delete on public.report_subscriptions to authenticated;
grant update (frequency) on public.report_subscriptions to authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_any_role(public.app_role[]), private.is_hr(), private.current_employee_id(), private.can_see_team(uuid),
  private.is_payroll(), private.is_finance(), private.can_read_payroll(), private.payroll_released(uuid),
  private.tax_year_of(date), private.is_ticket_agent(uuid), private.is_recruiter(), private.appraisal_role(uuid),
  private.report_allowed(uuid, text)
to authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.link_auth_user() to supabase_auth_admin;

revoke execute on function public.admin_list_users(), public.admin_set_user_disabled(uuid, boolean) from public, anon;
grant execute on function public.admin_list_users(), public.admin_set_user_disabled(uuid, boolean) to authenticated;

-- =================== Approval routing honours workflow_rules ===================
CREATE OR REPLACE FUNCTION private.leave_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  emp       public.employees;
  lt        public.leave_types;
  entitled  numeric;
  taken     numeric;
begin
  if not private.is_hr() and new.employee_id is distinct from private.current_employee_id() then
    raise exception 'You can only apply for leave for yourself.' using errcode = '42501';
  end if;

  select * into emp from public.employees where id = new.employee_id;
  select * into lt from public.leave_types where id = new.leave_type_id;
  if lt.id is null or not lt.is_active then
    raise exception 'This leave type is not available.';
  end if;
  if lt.gender is not null and emp.gender is distinct from lt.gender then
    raise exception '% is not available for this employee.', lt.name;
  end if;
  if new.half_day and not lt.allow_half_day then
    raise exception '% cannot be taken as a half day.', lt.name;
  end if;

  new.status := 'pending';
  new.manager_decided_by := null; new.manager_decided_at := null;
  new.hr_decided_by := null; new.hr_decided_at := null;
  new.days := case when new.half_day then 0.5
                   else private.leave_days(new.start_date, new.end_date, emp.location_id) end;
  if new.half_day and private.leave_days(new.start_date, new.end_date, emp.location_id) = 0 then
    raise exception 'The selected date is not a working day.';
  end if;
  if new.days <= 0 then
    raise exception 'The selected dates contain no working days.';
  end if;

  if exists (
    select 1 from public.leave_requests r
    where r.employee_id = new.employee_id
      and r.status in ('pending', 'approved')
      and daterange(r.start_date, r.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'You already have leave on some of these dates.';
  end if;

  select b.allocated + b.carried_forward into entitled
    from public.leave_balances b
   where b.employee_id = new.employee_id and b.leave_type_id = new.leave_type_id
     and b.year = extract(year from new.start_date);
  if entitled is null then
    raise exception 'No % balance has been allocated for %.', lt.name, extract(year from new.start_date);
  end if;

  select coalesce(sum(r.days), 0) into taken
    from public.leave_requests r
   where r.employee_id = new.employee_id and r.leave_type_id = new.leave_type_id
     and r.status in ('pending', 'approved')
     and extract(year from r.start_date) = extract(year from new.start_date);
  if taken + new.days > entitled then
    raise exception 'Insufficient % balance: % day(s) available, % requested.',
      lt.name, entitled - taken, new.days;
  end if;

  new.stage := case when emp.manager_id is null or not private.wf_needs_manager('leave', new.days) then 'hr' else 'manager' end;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.leave_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me        uuid := private.current_employee_id();
  hr        boolean := private.is_hr();
  needs_hr  boolean;
  mgr       uuid;
begin
  if (new.employee_id, new.leave_type_id, new.start_date, new.end_date, new.half_day, new.days, new.reason)
     is distinct from
     (old.employee_id, old.leave_type_id, old.start_date, old.end_date, old.half_day, old.days, old.reason) then
    raise exception 'A submitted leave request cannot be edited. Cancel it and apply again.';
  end if;
  -- Decision fields are only ever set below, never by the caller.
  new.manager_decided_by := old.manager_decided_by;
  new.manager_decided_at := old.manager_decided_at;
  new.hr_decided_by := old.hr_decided_by;
  new.hr_decided_at := old.hr_decided_at;
  if new.status = old.status and new.stage = old.stage then
    new.decision_comment := old.decision_comment;
    return new;
  end if;

  select requires_hr_approval into needs_hr from public.leave_types where id = new.leave_type_id;
  select manager_id into mgr from public.employees where id = new.employee_id;

  if new.status = 'cancelled' then
    if old.status not in ('pending', 'approved') then
      raise exception 'Only pending or approved leave can be cancelled.';
    end if;
    if not hr and (old.employee_id is distinct from me or (old.status = 'approved' and old.start_date <= current_date)) then
      raise exception 'Approved leave that has started can only be cancelled by HR.' using errcode = '42501';
    end if;
    new.stage := 'done';
    return new;
  end if;

  if old.status <> 'pending' or new.status not in ('approved', 'rejected') then
    raise exception 'Invalid status change.';
  end if;
  if old.employee_id = me then
    raise exception 'You cannot approve your own leave.' using errcode = '42501';
  end if;

  if old.stage = 'manager' then
    if not (hr or mgr = me or private.can_see_team(old.employee_id)) then
      raise exception 'Only the line manager, HOD or HR can decide this request.' using errcode = '42501';
    end if;
    new.manager_decided_by := me;
    new.manager_decided_at := now();
    if new.status = 'approved' and (needs_hr or private.wf_leave_needs_hr(old.days)) then
      new.status := 'pending';
      new.stage := 'hr';
    else
      new.stage := 'done';
    end if;
  elsif old.stage = 'hr' then
    if not hr then
      raise exception 'This request is awaiting HR approval.' using errcode = '42501';
    end if;
    new.hr_decided_by := me;
    new.hr_decided_at := now();
    new.stage := 'done';
  else
    raise exception 'This request has already been decided.';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.exp_submit(p_claim uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c    public.expense_claims;
  miss integer;
  emp  public.employees;
  tr   public.travel_requests;
  to_mgr boolean;
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
  to_mgr := emp.manager_id is not null and private.wf_needs_manager('expense', c.total);
  update public.expense_claims set
    status = 'submitted', submitted_at = now(),
    stage = case when to_mgr then 'manager' else 'finance' end,
    advance_adjusted = least(c.total, greatest(coalesce(tr.advance_paid - tr.advance_settled, 0), 0))
   where id = p_claim;
  if not to_mgr then
    perform private.notify_roles(array['finance']::public.app_role[], 'Expense claim ' || c.claim_no, emp.full_name || ' — PKR ' || c.total, '/expenses/approvals');
  else
    perform private.notify_employee(emp.manager_id, 'Expense claim from ' || emp.full_name, c.claim_no || ' — PKR ' || c.total, '/expenses/approvals');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION private.travel_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare emp public.employees;
begin
  if auth.uid() is not null and new.employee_id is distinct from private.current_employee_id() then
    raise exception 'You can only request travel for yourself.' using errcode = '42501';
  end if;
  select * into emp from public.employees where id = new.employee_id;
  new.status := 'pending';
  new.stage := case when emp.manager_id is not null and private.wf_needs_manager('travel', new.estimated_cost) then 'manager' else 'finance' end;
  new.advance_paid := 0;
  new.advance_settled := 0;
  new.advance_entry_id := null;
  if new.stage = 'manager' then
    perform private.notify_employee(emp.manager_id, 'Travel request from ' || emp.full_name, new.destination || ', ' || to_char(new.start_date, 'DD Mon'), '/expenses/approvals');
  else
    perform private.notify_roles(array['finance']::public.app_role[], 'Travel request from ' || emp.full_name, new.destination, '/expenses/approvals');
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.loan_app_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  new.stage := case when emp.manager_id is not null and private.wf_needs_manager('loan', new.amount) then 'manager' else 'finance' end;
  new.loan_id := null;
  if new.stage = 'manager' then
    perform private.notify_employee(emp.manager_id, initcap(new.loan_type) || ' application from ' || emp.full_name, 'PKR ' || new.amount, '/loans/approvals');
  else
    perform private.notify_roles(array['finance']::public.app_role[], initcap(new.loan_type) || ' application from ' || emp.full_name, 'PKR ' || new.amount, '/loans/approvals');
  end if;
  return new;
end $function$;


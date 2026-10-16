-- =====================================================================
-- Recruitment (6.4, 7.1), Performance (6.8), Training (6.9)
-- =====================================================================

create function private.is_recruiter() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_any_role(array['hr_admin', 'system_admin', 'recruiter']::public.app_role[]);
$$;

-- =====================================================================
-- RECRUITMENT
-- =====================================================================
create type public.candidate_stage as enum ('applied', 'screening', 'interview', 'selected', 'offered', 'hired', 'rejected');

create sequence public.requisition_no_seq;
create table public.requisitions (
  id               uuid primary key default gen_random_uuid(),
  req_no           text not null unique default ('REQ-' || lpad(nextval('public.requisition_no_seq')::text, 5, '0')),
  title            text not null,
  department_id    uuid not null references public.departments (id),
  position_id      uuid references public.positions (id),
  location_id      uuid references public.locations (id),
  headcount        integer not null default 1 check (headcount between 1 and 100),
  employment_type  public.employment_type not null default 'permanent',
  salary_min       numeric(14, 2) check (salary_min >= 0),
  salary_max       numeric(14, 2),
  justification    text not null,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'closed')),
  requested_by     uuid references public.employees (id),
  decided_by       uuid references public.employees (id),
  decided_at       timestamptz,
  decision_comment text,
  created_at       timestamptz not null default now(),
  check (salary_max is null or salary_min is null or salary_max >= salary_min)
);
create index requisitions_dept_idx on public.requisitions (department_id, status);

create table public.candidates (
  id                uuid primary key default gen_random_uuid(),
  requisition_id    uuid not null references public.requisitions (id) on delete cascade,
  full_name         text not null,
  email             text,
  phone             text,
  cnic              text check (cnic is null or cnic ~ '^\d{5}-\d{7}-\d$'),
  current_company   text,
  experience_years  numeric(4, 1) check (experience_years >= 0),
  expected_salary   numeric(14, 2) check (expected_salary >= 0),
  source            text not null default 'direct' check (source in ('direct', 'referral', 'job_board', 'linkedin', 'agency', 'walk_in', 'other')),
  cv_path           text,
  stage             public.candidate_stage not null default 'applied',
  rating            integer check (rating between 1 and 5),
  notes             text,
  employee_id       uuid references public.employees (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index candidates_req_idx on public.candidates (requisition_id, stage);
create unique index candidates_email_per_req on public.candidates (requisition_id, lower(email)) where email is not null;

create table public.interviews (
  id              uuid primary key default gen_random_uuid(),
  candidate_id    uuid not null references public.candidates (id) on delete cascade,
  round           text not null default 'Technical',
  scheduled_at    timestamptz not null,
  mode            text not null default 'onsite' check (mode in ('onsite', 'video', 'phone')),
  location        text,
  interviewer_id  uuid not null references public.employees (id),
  status          text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  score           integer check (score between 1 and 5),
  recommendation  text check (recommendation in ('hire', 'hold', 'reject')),
  feedback        text,
  created_at      timestamptz not null default now()
);
create index interviews_candidate_idx on public.interviews (candidate_id);
create index interviews_interviewer_idx on public.interviews (interviewer_id, scheduled_at);

create table public.offers (
  id              uuid primary key default gen_random_uuid(),
  candidate_id    uuid not null unique references public.candidates (id) on delete cascade,
  offered_salary  numeric(14, 2) not null check (offered_salary > 0),
  joining_date    date not null,
  offer_date      date not null default current_date,
  expiry_date     date not null,
  probation_months integer not null default 3 check (probation_months between 0 and 12),
  status          text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'withdrawn')),
  notes           text,
  created_at      timestamptz not null default now(),
  check (expiry_date >= offer_date)
);

create table public.onboarding_tasks (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  title        text not null,
  owner        text not null default 'HR',
  due_date     date,
  done_at      timestamptz,
  done_by      uuid references public.employees (id),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index onboarding_employee_idx on public.onboarding_tasks (employee_id);

-- Requisition: managers/HODs/HR raise; HR (or System Admin) approves (7.1).
create function private.requisition_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not (private.is_recruiter() or private.has_any_role(array['hod']::public.app_role[])
      or exists (select 1 from public.employees where manager_id = private.current_employee_id())) then
    raise exception 'Only managers, HODs or HR can raise a requisition.' using errcode = '42501';
  end if;
  new.requested_by := coalesce(new.requested_by, private.current_employee_id());
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  perform private.notify_roles(array['hr_admin']::public.app_role[], 'Manpower requisition ' || new.title,
    new.headcount || ' × ' || new.employment_type::text, '/recruitment');
  return new;
end $$;
create trigger requisitions_before_insert before insert on public.requisitions
  for each row execute function private.requisition_before_insert();

create function private.requisition_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status in ('approved', 'rejected') then
      if not private.is_hr() then raise exception 'Only HR can approve requisitions.' using errcode = '42501'; end if;
      if old.requested_by = private.current_employee_id() then
        raise exception 'You can''t approve your own requisition.' using errcode = '42501';
      end if;
      new.decided_by := private.current_employee_id();
      new.decided_at := now();
      perform private.notify_employee(old.requested_by, 'Requisition ' || old.req_no || ' ' || new.status, old.title, '/recruitment');
    elsif new.status = 'cancelled' and old.status in ('pending', 'approved') then
      if not (private.is_recruiter() or old.requested_by = private.current_employee_id()) then
        raise exception 'Not allowed.' using errcode = '42501';
      end if;
    elsif new.status = 'closed' and old.status = 'approved' then
      if not private.is_recruiter() then raise exception 'Not allowed.' using errcode = '42501'; end if;
    else
      raise exception 'Invalid requisition status change.';
    end if;
  elsif old.status <> 'pending' and (new.title, new.headcount, new.department_id, new.salary_min, new.salary_max)
        is distinct from (old.title, old.headcount, old.department_id, old.salary_min, old.salary_max) then
    raise exception 'Approved requisitions can''t be edited.';
  end if;
  return new;
end $$;
create trigger requisitions_guard before update on public.requisitions
  for each row execute function private.requisition_guard();

-- Candidates only on approved requisitions; hired via rec_hire only.
create function private.candidate_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rs text;
begin
  select status into rs from public.requisitions where id = new.requisition_id;
  if tg_op = 'INSERT' and rs <> 'approved' then
    raise exception 'Candidates can only be added to approved requisitions.';
  end if;
  if new.stage = 'hired' and (tg_op = 'INSERT' or old.stage <> 'hired')
     and coalesce(current_setting('app.rec_hiring', true), '') <> 'on' then
    raise exception 'Use the Hire action to convert a candidate.';
  end if;
  if tg_op = 'UPDATE' and old.stage = 'hired' and new.stage <> 'hired' then
    raise exception 'A hired candidate can''t be moved back.';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger candidates_guard before insert or update on public.candidates
  for each row execute function private.candidate_guard();

create function private.interview_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cname text;
begin
  -- Interviewers may only record feedback on their own interview.
  if tg_op = 'UPDATE' and auth.uid() is not null and not private.is_recruiter() then
    if old.interviewer_id is distinct from private.current_employee_id() then
      raise exception 'Not your interview.' using errcode = '42501';
    end if;
    if (new.candidate_id, new.scheduled_at, new.interviewer_id, new.round, new.mode, new.location)
       is distinct from (old.candidate_id, old.scheduled_at, old.interviewer_id, old.round, old.mode, old.location) then
      raise exception 'Interviewers can only record feedback.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' then
    select full_name into cname from public.candidates where id = new.candidate_id;
    update public.candidates set stage = 'interview' where id = new.candidate_id and stage in ('applied', 'screening');
    perform private.notify_employee(new.interviewer_id, 'Interview scheduled: ' || cname,
      new.round || ' · ' || to_char(new.scheduled_at at time zone 'Asia/Karachi', 'DD Mon HH24:MI'), '/recruitment/interviews');
  end if;
  return new;
end $$;
create trigger interviews_before before insert or update on public.interviews
  for each row execute function private.interview_before();

-- Hire: candidate → employee (REC-07) with onboarding checklist (REC-06) and probation (REC-08).
create function public.rec_hire(p_candidate uuid, p_employee_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c    public.candidates;
  r    public.requisitions;
  o    public.offers;
  e    uuid;
  org  uuid;
  first_name text;
  last_name  text;
  hired integer;
begin
  if not private.is_recruiter() then raise exception 'Only HR or recruiters can hire.' using errcode = '42501'; end if;
  select * into c from public.candidates where id = p_candidate for update;
  if c.id is null then raise exception 'Candidate not found.'; end if;
  if c.stage = 'hired' then raise exception 'Already hired.'; end if;
  select * into o from public.offers where candidate_id = p_candidate;
  if o.id is null or o.status <> 'accepted' then raise exception 'The offer must be accepted before hiring.'; end if;
  select * into r from public.requisitions where id = c.requisition_id;
  select id into org from public.organizations where org_type = 'company' limit 1;
  first_name := split_part(trim(c.full_name), ' ', 1);
  last_name := nullif(trim(substr(trim(c.full_name), length(first_name) + 1)), '');

  insert into public.employees (employee_code, first_name, last_name, work_email, phone, organization_id, department_id,
    position_id, location_id, employment_type, status, joining_date, probation_end_date)
  values (upper(trim(p_employee_code)), first_name, coalesce(last_name, '-'), c.email, c.phone, org, r.department_id,
    r.position_id, r.location_id, r.employment_type, case when o.probation_months > 0 then 'probation' else 'active' end::public.employee_status,
    o.joining_date, case when o.probation_months > 0 then (o.joining_date + make_interval(months => o.probation_months))::date end)
  returning id into e;
  if c.cnic is not null then
    insert into public.employee_private (employee_id, cnic) values (e, c.cnic);
  end if;
  insert into public.employee_salaries (employee_id, effective_from, structure_id, basic_salary)
  select e, date_trunc('month', o.joining_date)::date, s.id, round(o.offered_salary / 1.65)
    from public.salary_structures s where s.code = 'STD'; -- STD structure: gross = 1.65 × basic
  insert into public.employment_history (employee_id, change_type, effective_date, to_department_id, to_position_id, notes)
  values (e, 'joining', o.joining_date, r.department_id, r.position_id, 'Hired via ' || r.req_no);
  insert into public.onboarding_tasks (employee_id, title, owner, due_date, sort_order)
  select e, t.title, t.owner, o.joining_date + t.offs, t.ord
    from (values
      ('Collect CNIC, degrees and experience letters', 'HR', -3, 1),
      ('Issue appointment letter / contract', 'HR', -1, 2),
      ('Create email and system access', 'IT', -1, 3),
      ('Issue laptop / equipment', 'Admin', 0, 4),
      ('Enrol on biometric device', 'Admin', 0, 5),
      ('Register with EOBI / PESSI', 'HR', 7, 6),
      ('Collect bank account (IBAN) details', 'Finance', 3, 7),
      ('Induction and policy briefing', 'HR', 1, 8),
      ('Probation objectives agreed with manager', 'Manager', 14, 9)
    ) as t (title, owner, offs, ord);

  perform set_config('app.rec_hiring', 'on', true);
  update public.candidates set stage = 'hired', employee_id = e where id = p_candidate;
  perform set_config('app.rec_hiring', '', true);

  select count(*) into hired from public.candidates where requisition_id = r.id and stage = 'hired';
  if hired >= r.headcount then
    update public.requisitions set status = 'closed' where id = r.id;
  end if;
  return e;
end $$;

-- REC-08: probation ending within 14 days → remind HR + manager (daily).
create function private.probation_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  n integer := 0;
begin
  for e in
    select * from public.employees
     where status = 'probation' and deleted_at is null
       and probation_end_date between current_date and current_date + 14
  loop
    perform private.notify_roles(array['hr_admin']::public.app_role[], 'Probation ending: ' || e.full_name,
      'Confirm by ' || to_char(e.probation_end_date, 'DD Mon YYYY'), '/employees/' || e.id);
    if e.manager_id is not null then
      perform private.notify_employee(e.manager_id, 'Probation ending: ' || e.full_name,
        'Review by ' || to_char(e.probation_end_date, 'DD Mon YYYY'), '/employees/' || e.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
-- Weekly (Mondays 09:00 PKT) to avoid daily repeats.
select cron.schedule('probation-reminders', '0 4 * * 1', $$select private.probation_reminders()$$);

-- =====================================================================
-- PERFORMANCE
-- =====================================================================
create table public.appraisal_cycles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  cycle_type    text not null default 'annual' check (cycle_type in ('annual', 'semi_annual', 'quarterly')),
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'draft' check (status in ('draft', 'goal_setting', 'review', 'closed')),
  created_at    timestamptz not null default now(),
  check (period_end > period_start)
);

create table public.appraisals (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references public.appraisal_cycles (id) on delete cascade,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  manager_id        uuid references public.employees (id),
  status            text not null default 'goal_setting' check (status in ('goal_setting', 'self_review', 'manager_review', 'completed', 'acknowledged')),
  self_comment      text,
  manager_comment   text,
  overall_score     numeric(4, 2),
  rating            text,
  recommendation    text check (recommendation in ('none', 'increment', 'promotion', 'pip')),
  increment_pct     numeric(5, 2) check (increment_pct between 0 and 100),
  submitted_self_at timestamptz,
  completed_at      timestamptz,
  acknowledged_at   timestamptz,
  created_at        timestamptz not null default now(),
  unique (cycle_id, employee_id)
);
create index appraisals_employee_idx on public.appraisals (employee_id);
create index appraisals_manager_idx on public.appraisals (manager_id);

create table public.goals (
  id               uuid primary key default gen_random_uuid(),
  appraisal_id     uuid not null references public.appraisals (id) on delete cascade,
  kind             text not null default 'kpi' check (kind in ('kpi', 'okr', 'goal')),
  title            text not null,
  description      text,
  target           text,
  weight           numeric(5, 2) not null check (weight > 0 and weight <= 100),
  self_score       integer check (self_score between 1 and 5),
  self_comment     text,
  manager_score    integer check (manager_score between 1 and 5),
  manager_comment  text,
  created_at       timestamptz not null default now()
);
create index goals_appraisal_idx on public.goals (appraisal_id);

create table public.feedback_requests (
  id            uuid primary key default gen_random_uuid(),
  appraisal_id  uuid not null references public.appraisals (id) on delete cascade,
  reviewer_id   uuid not null references public.employees (id),
  relationship  text not null default 'peer' check (relationship in ('peer', 'direct_report', 'cross_functional', 'client')),
  score         integer check (score between 1 and 5),
  strengths     text,
  improvements  text,
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (appraisal_id, reviewer_id)
);
create index feedback_reviewer_idx on public.feedback_requests (reviewer_id);

-- Who may act on an appraisal
create function private.appraisal_role(p_appraisal uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when a.employee_id = private.current_employee_id() then 'self'
    when a.manager_id = private.current_employee_id() or private.can_see_team(a.employee_id) then 'manager'
    when private.is_hr() then 'hr'
    else null end
  from public.appraisals a where a.id = p_appraisal;
$$;

-- Goals: the employee (or manager/HR) edits during goal setting; scores only in the matching review step.
create function private.goal_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  a    public.appraisals;
  who  text;
begin
  select * into a from public.appraisals where id = coalesce(new.appraisal_id, old.appraisal_id);
  if auth.uid() is null then return coalesce(new, old); end if;
  who := private.appraisal_role(a.id);
  if who is null then raise exception 'Not your appraisal.' using errcode = '42501'; end if;
  if tg_op in ('INSERT', 'DELETE') or (new.title, new.weight, new.kind, new.target, new.description)
     is distinct from (old.title, old.weight, old.kind, old.target, old.description) then
    if a.status <> 'goal_setting' then raise exception 'Goals are locked once the review starts.'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if (new.self_score, new.self_comment) is distinct from (case when tg_op = 'UPDATE' then old.self_score end, case when tg_op = 'UPDATE' then old.self_comment end) then
    if who <> 'self' or a.status <> 'self_review' then raise exception 'Self-scores are entered by the employee during self review.'; end if;
  end if;
  if (new.manager_score, new.manager_comment) is distinct from (case when tg_op = 'UPDATE' then old.manager_score end, case when tg_op = 'UPDATE' then old.manager_comment end) then
    if who not in ('manager', 'hr') or a.status <> 'manager_review' then raise exception 'Manager scores are entered during manager review.'; end if;
  end if;
  return new;
end $$;
create trigger goals_guard before insert or update or delete on public.goals
  for each row execute function private.goal_guard();

create function public.perf_start_cycle(p_cycle uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  cy  public.appraisal_cycles;
  n   integer;
begin
  if not private.is_hr() then raise exception 'Only HR can start a cycle.' using errcode = '42501'; end if;
  select * into cy from public.appraisal_cycles where id = p_cycle for update;
  if cy.status <> 'draft' then raise exception 'This cycle has already started.'; end if;
  insert into public.appraisals (cycle_id, employee_id, manager_id)
  select p_cycle, e.id, e.manager_id from public.employees e
   where e.deleted_at is null and e.status not in ('draft', 'exited', 'notice')
     and (e.joining_date is null or e.joining_date <= cy.period_end)
  on conflict do nothing;
  get diagnostics n = row_count;
  update public.appraisal_cycles set status = 'goal_setting' where id = p_cycle;
  insert into public.notifications (user_id, title, body, link)
  select e.user_id, 'Set your goals: ' || cy.name, 'Add weighted goals totalling 100%', '/performance'
    from public.appraisals a join public.employees e on e.id = a.employee_id
   where a.cycle_id = p_cycle and e.user_id is not null;
  return n;
end $$;

create function public.perf_open_review(p_cycle uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_hr() then raise exception 'Only HR can open reviews.' using errcode = '42501'; end if;
  update public.appraisal_cycles set status = 'review' where id = p_cycle and status = 'goal_setting';
  if not found then raise exception 'The cycle must be in goal setting.'; end if;
  update public.appraisals set status = 'self_review' where cycle_id = p_cycle and status = 'goal_setting';
end $$;

create function public.perf_submit_self(p_appraisal uuid, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a     public.appraisals;
  total numeric;
  miss  integer;
begin
  select * into a from public.appraisals where id = p_appraisal for update;
  if a.employee_id is distinct from private.current_employee_id() then raise exception 'Not your appraisal.' using errcode = '42501'; end if;
  if a.status <> 'self_review' then raise exception 'Self review isn''t open.'; end if;
  select coalesce(sum(weight), 0), count(*) filter (where self_score is null) into total, miss from public.goals where appraisal_id = p_appraisal;
  if total <> 100 then raise exception 'Goal weights must total 100%% (now %).', total; end if;
  if miss > 0 then raise exception 'Score all % goal(s) before submitting.', miss; end if;
  update public.appraisals set status = 'manager_review', self_comment = p_comment, submitted_self_at = now() where id = p_appraisal;
  if a.manager_id is not null then
    perform private.notify_employee(a.manager_id, 'Self review submitted', (select full_name from public.employees where id = a.employee_id), '/performance/' || a.id);
  else
    perform private.notify_roles(array['hr_admin']::public.app_role[], 'Self review submitted', (select full_name from public.employees where id = a.employee_id), '/performance/' || a.id);
  end if;
end $$;

create function public.perf_submit_manager(p_appraisal uuid, p_comment text, p_recommendation text, p_increment numeric) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  a      public.appraisals;
  who    text := private.appraisal_role(p_appraisal);
  score  numeric;
  miss   integer;
begin
  select * into a from public.appraisals where id = p_appraisal for update;
  if who not in ('manager', 'hr') then raise exception 'Only the manager or HR can complete this review.' using errcode = '42501'; end if;
  if a.status <> 'manager_review' then raise exception 'Waiting for the employee''s self review.'; end if;
  select count(*) filter (where manager_score is null), round(sum(weight * manager_score) / nullif(sum(weight), 0), 2)
    into miss, score from public.goals where appraisal_id = p_appraisal;
  if miss > 0 then raise exception 'Score all goals before completing the review.'; end if;
  update public.appraisals set status = 'completed', manager_comment = p_comment, overall_score = score,
    rating = case when score >= 4.5 then 'Outstanding' when score >= 3.5 then 'Exceeds expectations'
                  when score >= 2.5 then 'Meets expectations' when score >= 1.5 then 'Needs improvement' else 'Unsatisfactory' end,
    recommendation = coalesce(p_recommendation, 'none'), increment_pct = p_increment, completed_at = now()
   where id = p_appraisal;
  perform private.notify_employee(a.employee_id, 'Your appraisal is complete', 'Score ' || score || ' / 5', '/performance/' || a.id);
  return score;
end $$;

create function public.perf_acknowledge(p_appraisal uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.appraisals set status = 'acknowledged', acknowledged_at = now()
   where id = p_appraisal and employee_id = private.current_employee_id() and status = 'completed';
  if not found then raise exception 'Nothing to acknowledge.'; end if;
end $$;

create function private.feedback_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if private.appraisal_role(new.appraisal_id) not in ('manager', 'hr') then
      raise exception 'Only the manager or HR can request 360° feedback.' using errcode = '42501';
    end if;
    if new.reviewer_id = (select employee_id from public.appraisals where id = new.appraisal_id) then
      raise exception 'Reviewer must be someone other than the employee.';
    end if;
    new.score := null; new.strengths := null; new.improvements := null; new.submitted_at := null;
    perform private.notify_employee(new.reviewer_id, '360° feedback requested',
      (select e.full_name from public.appraisals a join public.employees e on e.id = a.employee_id where a.id = new.appraisal_id), '/performance');
    return new;
  end if;
  if old.reviewer_id is distinct from private.current_employee_id() then raise exception 'Not your feedback request.' using errcode = '42501'; end if;
  if old.submitted_at is not null then raise exception 'Feedback already submitted.'; end if;
  if (new.appraisal_id, new.reviewer_id, new.relationship) is distinct from (old.appraisal_id, old.reviewer_id, old.relationship) then
    raise exception 'Not allowed.';
  end if;
  new.submitted_at := now();
  return new;
end $$;
create trigger feedback_guard before insert or update on public.feedback_requests
  for each row execute function private.feedback_guard();

-- =====================================================================
-- TRAINING
-- =====================================================================
create table public.training_needs (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  skill        text not null,
  reason       text,
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status       text not null default 'open' check (status in ('open', 'planned', 'closed')),
  raised_by    uuid references public.employees (id) default null,
  created_at   timestamptz not null default now()
);
create index training_needs_employee_idx on public.training_needs (employee_id);

create table public.training_events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  provider     text,
  trainer      text,
  description  text,
  start_date   date not null,
  end_date     date not null,
  mode         text not null default 'classroom' check (mode in ('classroom', 'online', 'on_job', 'external')),
  location     text,
  capacity     integer check (capacity > 0),
  cost         numeric(14, 2) not null default 0 check (cost >= 0),
  status       text not null default 'planned' check (status in ('planned', 'completed', 'cancelled')),
  created_at   timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.training_participants (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.training_events (id) on delete cascade,
  employee_id      uuid not null references public.employees (id) on delete cascade,
  nominated_by     uuid references public.employees (id),
  status           text not null default 'nominated' check (status in ('nominated', 'attended', 'absent', 'cancelled')),
  feedback_rating  integer check (feedback_rating between 1 and 5),
  feedback_comment text,
  created_at       timestamptz not null default now(),
  unique (event_id, employee_id)
);
create index training_participants_employee_idx on public.training_participants (employee_id);

create table public.certifications (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees (id) on delete cascade,
  name           text not null,
  issuer         text,
  credential_id  text,
  issued_on      date,
  expires_on     date,
  verified       boolean not null default false,
  created_at     timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index certifications_employee_idx on public.certifications (employee_id, expires_on);

create function private.training_participant_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cap integer; cnt integer; ev public.training_events;
begin
  if auth.uid() is null then return new; end if;
  select * into ev from public.training_events where id = coalesce(new.event_id, old.event_id);
  if tg_op = 'INSERT' then
    if not (private.is_hr() or private.can_see_team(new.employee_id)) then
      raise exception 'Only HR or the employee''s manager can nominate.' using errcode = '42501';
    end if;
    if ev.status <> 'planned' then raise exception 'Nominations are closed for this training.'; end if;
    select count(*) into cnt from public.training_participants where event_id = new.event_id and status <> 'cancelled';
    if ev.capacity is not null and cnt >= ev.capacity then raise exception 'This training is full (% seats).', ev.capacity; end if;
    new.nominated_by := private.current_employee_id();
    new.status := 'nominated';
    new.feedback_rating := null; new.feedback_comment := null;
    perform private.notify_employee(new.employee_id, 'Nominated for training: ' || ev.title, to_char(ev.start_date, 'DD Mon YYYY'), '/training');
    return new;
  end if;
  if private.is_hr() then return new; end if;
  -- Employees may only leave feedback on their own attended training.
  if old.employee_id is distinct from private.current_employee_id() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if (new.event_id, new.employee_id, new.status, new.nominated_by) is distinct from (old.event_id, old.employee_id, old.status, old.nominated_by) then
    raise exception 'Only HR marks attendance.' using errcode = '42501';
  end if;
  if old.status <> 'attended' then raise exception 'You can give feedback after attending.'; end if;
  return new;
end $$;
create trigger training_participants_guard before insert or update on public.training_participants
  for each row execute function private.training_participant_guard();

create function private.certification_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_hr() then return coalesce(new, old); end if;
  if coalesce(new.employee_id, old.employee_id) is distinct from private.current_employee_id() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then new.verified := false; return new; end if;
  if tg_op = 'UPDATE' then raise exception 'Ask HR to update a certification.' using errcode = '42501'; end if;
  if old.verified then raise exception 'Verified certifications can only be removed by HR.' using errcode = '42501'; end if;
  return old;
end $$;
create trigger certifications_guard before insert or update or delete on public.certifications
  for each row execute function private.certification_guard();

-- TRN-04: certification expiry alerts (within 30 days), weekly.
create function private.certification_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare c record; n integer := 0;
begin
  for c in
    select x.*, e.full_name from public.certifications x join public.employees e on e.id = x.employee_id
     where x.expires_on between current_date and current_date + 30 and e.deleted_at is null and e.status <> 'exited'
  loop
    perform private.notify_employee(c.employee_id, 'Certification expiring: ' || c.name, 'Expires ' || to_char(c.expires_on, 'DD Mon YYYY'), '/training');
    perform private.notify_roles(array['hr_admin']::public.app_role[], 'Certification expiring: ' || c.full_name, c.name || ' · ' || to_char(c.expires_on, 'DD Mon'), '/training');
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('certification-reminders', '0 4 * * 1', $$select private.certification_reminders()$$);

-- =====================================================================
-- Audit, RLS, grants
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['requisitions', 'candidates', 'interviews', 'offers', 'onboarding_tasks', 'appraisal_cycles',
    'appraisals', 'goals', 'feedback_requests', 'training_needs', 'training_events', 'training_participants', 'certifications'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit()', t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Recruitment (matrix: Exec R, HR CRUD, HOD R, Recruiter CRUD, Admin CRUD)
create policy "requisitions: read" on public.requisitions for select to authenticated
  using ((select private.is_recruiter()) or (select private.has_any_role(array['executive', 'auditor']::public.app_role[]))
         or requested_by = (select private.current_employee_id())
         or department_id in (select department_id from public.user_roles where user_id = (select auth.uid()) and role = 'hod'));
create policy "requisitions: raise" on public.requisitions for insert to authenticated with check (true);
create policy "requisitions: update" on public.requisitions for update to authenticated
  using ((select private.is_recruiter()) or requested_by = (select private.current_employee_id()))
  with check ((select private.is_recruiter()) or requested_by = (select private.current_employee_id()));

create policy "candidates: read" on public.candidates for select to authenticated
  using ((select private.is_recruiter()) or (select private.has_any_role(array['executive', 'auditor']::public.app_role[]))
         or exists (select 1 from public.interviews i where i.candidate_id = id and i.interviewer_id = (select private.current_employee_id())));
create policy "candidates: insert" on public.candidates for insert to authenticated with check ((select private.is_recruiter()));
create policy "candidates: update" on public.candidates for update to authenticated
  using ((select private.is_recruiter())) with check ((select private.is_recruiter()));
create policy "candidates: delete" on public.candidates for delete to authenticated using ((select private.is_recruiter()));

create policy "interviews: read" on public.interviews for select to authenticated
  using ((select private.is_recruiter()) or interviewer_id = (select private.current_employee_id())
         or (select private.has_any_role(array['executive', 'auditor']::public.app_role[])));
create policy "interviews: insert" on public.interviews for insert to authenticated with check ((select private.is_recruiter()));
create policy "interviews: update" on public.interviews for update to authenticated
  using ((select private.is_recruiter()) or interviewer_id = (select private.current_employee_id()))
  with check ((select private.is_recruiter()) or interviewer_id = (select private.current_employee_id()));

create policy "offers: read" on public.offers for select to authenticated
  using ((select private.is_recruiter()) or (select private.has_any_role(array['executive', 'auditor', 'finance']::public.app_role[])));
create policy "offers: insert" on public.offers for insert to authenticated with check ((select private.is_recruiter()));
create policy "offers: update" on public.offers for update to authenticated
  using ((select private.is_recruiter())) with check ((select private.is_recruiter()));

create policy "onboarding: read" on public.onboarding_tasks for select to authenticated
  using ((select private.is_recruiter()) or employee_id = (select private.current_employee_id()) or private.can_see_team(employee_id));
create policy "onboarding: hr update" on public.onboarding_tasks for update to authenticated
  using ((select private.is_recruiter()) or private.can_see_team(employee_id))
  with check ((select private.is_recruiter()) or private.can_see_team(employee_id));
create policy "onboarding: hr insert" on public.onboarding_tasks for insert to authenticated with check ((select private.is_recruiter()));

-- Performance (matrix: Exec R, HR CRUD, HOD CRUD (team), Employee R-own)
create policy "cycles: read" on public.appraisal_cycles for select to authenticated using (true);
create policy "cycles: hr insert" on public.appraisal_cycles for insert to authenticated with check ((select private.is_hr()));
create policy "cycles: hr update" on public.appraisal_cycles for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));
create policy "appraisals: read" on public.appraisals for select to authenticated
  using (employee_id = (select private.current_employee_id()) or manager_id = (select private.current_employee_id())
         or private.can_see_team(employee_id)
         or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'auditor']::public.app_role[])));
create policy "goals: read" on public.goals for select to authenticated
  using (exists (select 1 from public.appraisals a where a.id = appraisal_id));
create policy "goals: insert" on public.goals for insert to authenticated with check (exists (select 1 from public.appraisals a where a.id = appraisal_id));
create policy "goals: update" on public.goals for update to authenticated
  using (exists (select 1 from public.appraisals a where a.id = appraisal_id)) with check (exists (select 1 from public.appraisals a where a.id = appraisal_id));
create policy "goals: delete" on public.goals for delete to authenticated using (exists (select 1 from public.appraisals a where a.id = appraisal_id));
-- 360 feedback: reviewers see their own requests; manager/HR see all for the appraisal; the employee does not.
create policy "feedback: read" on public.feedback_requests for select to authenticated
  using (reviewer_id = (select private.current_employee_id()) or private.appraisal_role(appraisal_id) in ('manager', 'hr')
         or (select private.has_any_role(array['executive', 'auditor']::public.app_role[])));
create policy "feedback: request" on public.feedback_requests for insert to authenticated with check (true);
create policy "feedback: respond" on public.feedback_requests for update to authenticated
  using (reviewer_id = (select private.current_employee_id())) with check (reviewer_id = (select private.current_employee_id()));

-- Training (matrix: Exec R, HR CRUD, HOD R, Employee R)
create policy "training_events: read" on public.training_events for select to authenticated using (true);
create policy "training_events: hr insert" on public.training_events for insert to authenticated with check ((select private.is_hr()));
create policy "training_events: hr update" on public.training_events for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));
create policy "participants: read" on public.training_participants for select to authenticated
  using (employee_id = (select private.current_employee_id()) or private.can_see_team(employee_id)
         or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'auditor']::public.app_role[])));
create policy "participants: nominate" on public.training_participants for insert to authenticated with check (true);
create policy "participants: update" on public.training_participants for update to authenticated
  using ((select private.is_hr()) or employee_id = (select private.current_employee_id()))
  with check ((select private.is_hr()) or employee_id = (select private.current_employee_id()));
create policy "training_needs: read" on public.training_needs for select to authenticated
  using (employee_id = (select private.current_employee_id()) or private.can_see_team(employee_id)
         or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'auditor']::public.app_role[])));
create policy "training_needs: raise" on public.training_needs for insert to authenticated
  with check (employee_id = (select private.current_employee_id()) or private.can_see_team(employee_id) or (select private.is_hr()));
create policy "training_needs: hr update" on public.training_needs for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));
create policy "certifications: read" on public.certifications for select to authenticated
  using (employee_id = (select private.current_employee_id()) or private.can_see_team(employee_id)
         or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'auditor']::public.app_role[])));
create policy "certifications: add" on public.certifications for insert to authenticated
  with check (employee_id = (select private.current_employee_id()) or (select private.is_hr()));
create policy "certifications: hr update" on public.certifications for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));
create policy "certifications: delete" on public.certifications for delete to authenticated
  using (employee_id = (select private.current_employee_id()) or (select private.is_hr()));

revoke all on public.requisitions, public.candidates, public.interviews, public.offers, public.onboarding_tasks,
  public.appraisal_cycles, public.appraisals, public.goals, public.feedback_requests, public.training_needs,
  public.training_events, public.training_participants, public.certifications from anon, authenticated;
grant select, insert, update on public.requisitions, public.interviews, public.offers, public.onboarding_tasks,
  public.appraisal_cycles, public.feedback_requests, public.training_needs, public.training_events, public.training_participants to authenticated;
grant select, insert, update, delete on public.candidates, public.goals, public.certifications to authenticated;
grant select on public.appraisals to authenticated;
grant usage on sequence public.requisition_no_seq to authenticated;
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
    'public.rec_hire(uuid, text)', 'public.perf_start_cycle(uuid)', 'public.perf_open_review(uuid)',
    'public.perf_submit_self(uuid, text)', 'public.perf_submit_manager(uuid, text, text, numeric)', 'public.perf_acknowledge(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- CVs: private bucket, recruiters/HR only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('candidate-cvs', 'candidate-cvs', false, 5242880, array['application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
create policy "candidate-cvs: recruiters" on storage.objects for select to authenticated
  using (bucket_id = 'candidate-cvs' and (select private.is_recruiter()));
create policy "candidate-cvs: recruiters upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'candidate-cvs' and (select private.is_recruiter()));

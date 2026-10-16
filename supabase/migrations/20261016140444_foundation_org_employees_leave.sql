-- =====================================================================
-- AE HRMS — Phase 1 foundation
-- Roles & RBAC, audit trail, organization, employees, ESS, leave.
-- BRD refs: 5.2/5.3 (roles), 6.1 ORG, 6.2 EMP, 6.3 ESS, 6.6 LV,
--           10.2 (RBAC+RLS), 13.5 review notes (security fixes).
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- Private schema: helpers used by RLS policies. Not exposed via the Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role as enum (
  'executive', 'hr_admin', 'finance', 'hod', 'employee', 'recruiter', 'system_admin', 'auditor'
);
create type public.employee_status as enum ('draft', 'active', 'probation', 'confirmed', 'notice', 'exited');
create type public.employment_type as enum ('permanent', 'contractual', 'probationary', 'intern', 'consultant');
create type public.org_type as enum ('company', 'division');
create type public.unit_type as enum ('department', 'section', 'team');
create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.approval_stage as enum ('manager', 'hr', 'done');
create type public.history_type as enum (
  'joining', 'promotion', 'transfer', 'increment', 'confirmation', 'status_change', 'contract_renewal', 'exit'
);

-- ---------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------
create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Immutable audit trail (NFR-12, FIN-12). Nobody can update or delete rows.
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index audit_logs_table_record_idx on public.audit_logs (table_name, record_id);
create index audit_logs_changed_by_idx on public.audit_logs (changed_by);
create index audit_logs_changed_at_idx on public.audit_logs (changed_at desc);

create function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    coalesce(row_data ->> 'id', row_data ->> 'employee_id'),
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    auth.uid()
  );
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Organization (6.1)
-- ---------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  org_type    public.org_type not null default 'company',
  parent_id   uuid references public.organizations (id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.locations (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name               text not null,
  address            text,
  city               text,
  latitude           numeric(9, 6) check (latitude between -90 and 90),
  longitude          numeric(9, 6) check (longitude between -180 and 180),
  geofence_radius_m  integer not null default 200 check (geofence_radius_m > 0),
  timezone           text not null default 'Asia/Karachi',
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.cost_centers (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.departments (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  unit_type        public.unit_type not null default 'department',
  organization_id  uuid not null references public.organizations (id),
  parent_id        uuid references public.departments (id),
  cost_center_id   uuid references public.cost_centers (id),
  head_employee_id uuid, -- FK added after employees
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (parent_id is distinct from id)
);
create index departments_parent_idx on public.departments (parent_id);

create table public.positions (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique,
  title                   text not null,
  grade                   text,
  department_id           uuid references public.departments (id),
  reports_to_position_id  uuid references public.positions (id),
  cost_center_id          uuid references public.cost_centers (id),
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Salary bands are pay information: kept apart from positions so they can be restricted.
create table public.position_salary_bands (
  position_id  uuid primary key references public.positions (id) on delete cascade,
  min_salary   numeric(14, 2) not null check (min_salary >= 0),
  max_salary   numeric(14, 2) not null,
  currency     text not null default 'PKR',
  updated_at   timestamptz not null default now(),
  check (max_salary >= min_salary)
);

-- ---------------------------------------------------------------------
-- Employees (6.2)
-- ---------------------------------------------------------------------
create table public.employees (
  id                  uuid primary key default gen_random_uuid(),
  employee_code       text not null unique,
  user_id             uuid unique references auth.users (id) on delete set null,
  first_name          text not null,
  last_name           text not null,
  full_name           text generated always as (first_name || ' ' || last_name) stored,
  father_name         text,
  work_email          text,
  personal_email      text,
  phone               text,
  date_of_birth       date,
  gender              text check (gender in ('male', 'female', 'other')),
  marital_status      text check (marital_status in ('single', 'married', 'divorced', 'widowed')),
  nationality         text default 'Pakistani',
  address             text,
  city                text,
  organization_id     uuid references public.organizations (id),
  department_id       uuid references public.departments (id),
  position_id         uuid references public.positions (id),
  location_id         uuid references public.locations (id),
  manager_id          uuid references public.employees (id),
  employment_type     public.employment_type not null default 'permanent',
  status              public.employee_status not null default 'draft',
  joining_date        date,
  probation_end_date  date,
  confirmation_date   date,
  contract_end_date   date,
  exit_date           date,
  deleted_at          timestamptz, -- soft delete (10.2)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (manager_id is distinct from id),
  check (work_email is null or work_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
create unique index employees_work_email_key on public.employees (lower(work_email));
create index employees_status_idx on public.employees (status);
create index employees_department_idx on public.employees (department_id);
create index employees_manager_idx on public.employees (manager_id);
create index employees_name_trgm_idx on public.employees using gin (full_name extensions.gin_trgm_ops);

alter table public.departments
  add constraint departments_head_employee_fk foreign key (head_employee_id) references public.employees (id);

-- Restricted data (10.3): CNIC, bank, statutory numbers. HR/Finance only + the employee (read).
create table public.employee_private (
  employee_id     uuid primary key references public.employees (id) on delete cascade,
  cnic            text unique check (cnic ~ '^\d{5}-\d{7}-\d$'),
  ntn             text,
  eobi_number     text,
  pessi_number    text,
  pf_number       text,
  bank_name       text,
  bank_branch     text,
  account_title   text,
  account_number  text,
  iban            text check (iban is null or iban ~ '^PK\d{2}[A-Z]{4}\d{16}$'),
  updated_at      timestamptz not null default now()
);

create table public.employee_emergency_contacts (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees (id) on delete cascade,
  name          text not null,
  relationship  text not null,
  phone         text not null,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index emergency_contacts_employee_idx on public.employee_emergency_contacts (employee_id);

create table public.employee_dependents (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees (id) on delete cascade,
  name           text not null,
  relationship   text not null check (relationship in ('spouse', 'son', 'daughter', 'father', 'mother', 'other')),
  date_of_birth  date,
  cnic_or_bform  text,
  is_nominee     boolean not null default false,
  nominee_share  numeric(5, 2) check (nominee_share between 0 and 100),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index dependents_employee_idx on public.employee_dependents (employee_id);

create table public.employee_documents (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  doc_type     text not null check (doc_type in ('cnic', 'degree', 'experience_letter', 'contract', 'offer_letter', 'photo', 'other')),
  title        text not null,
  file_path    text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  expiry_date  date,
  uploaded_by  uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index documents_employee_idx on public.employee_documents (employee_id);

create table public.employment_history (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete cascade,
  change_type         public.history_type not null,
  effective_date      date not null,
  from_department_id  uuid references public.departments (id),
  to_department_id    uuid references public.departments (id),
  from_position_id    uuid references public.positions (id),
  to_position_id      uuid references public.positions (id),
  notes               text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now()
);
create index history_employee_idx on public.employment_history (employee_id, effective_date desc);

-- ---------------------------------------------------------------------
-- Roles (5.2, 10.2). Scope: optional department / location.
-- ---------------------------------------------------------------------
create table public.user_roles (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  role           public.app_role not null,
  department_id  uuid references public.departments (id) on delete cascade,
  location_id    uuid references public.locations (id) on delete cascade,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  unique nulls not distinct (user_id, role, department_id, location_id)
);
create index user_roles_user_idx on public.user_roles (user_id);

-- ---------------------------------------------------------------------
-- RLS helper functions (13.5 note 3): SECURITY DEFINER in a non-exposed schema,
-- keyed on auth.uid(), so policies don't recurse through RLS.
-- ---------------------------------------------------------------------
create function private.has_any_role(roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = any (roles)
  );
$$;

create function private.is_hr() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_any_role(array['hr_admin', 'system_admin']::public.app_role[]);
$$;

create function private.current_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e
  where e.user_id = auth.uid() and e.deleted_at is null
  limit 1;
$$;

-- Team = direct reports, or anyone in a department where the user holds a scoped HOD role.
create function private.can_see_team(emp uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees e
    where e.id = emp
      and (
        e.manager_id = private.current_employee_id()
        or exists (
          select 1 from public.user_roles ur
          where ur.user_id = auth.uid() and ur.role = 'hod' and ur.department_id = e.department_id
        )
      )
  );
$$;

-- ---------------------------------------------------------------------
-- Auth ↔ employee linking. Only confirmed emails link, so nobody can claim
-- a record by signing up with someone else's work email.
-- ---------------------------------------------------------------------
create function private.link_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null then
    update public.employees
       set user_id = new.id
     where user_id is null
       and lower(work_email) = lower(new.email)
       and deleted_at is null;
  end if;
  return new;
end $$;

create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function private.link_auth_user();

create function private.link_employee_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null and new.work_email is not null then
    select u.id into new.user_id
      from auth.users u
     where lower(u.email) = lower(new.work_email)
       and u.email_confirmed_at is not null
       and not exists (select 1 from public.employees e where e.user_id = u.id and e.id <> new.id)
     limit 1;
  end if;
  return new;
end $$;

create trigger employees_link_user
  before insert or update of work_email on public.employees
  for each row execute function private.link_employee_user();

-- ESS guard (13.5 note 1): non-HR users may only change their own contact fields.
create function private.guard_employee_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  -- full_name is generated (not yet computed in BEFORE triggers), so it's ignored too.
  ess_fields text[] := array['personal_email', 'phone', 'address', 'city', 'marital_status', 'updated_at', 'full_name'];
begin
  -- No JWT = server-side job (migrations, service role); RLS already keeps anon out.
  if auth.uid() is null or private.is_hr() then
    return new;
  end if;
  if (to_jsonb(new) - ess_fields) is distinct from (to_jsonb(old) - ess_fields) then
    raise exception 'You can only update your contact details. Contact HR for other changes.'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger employees_guard_update
  before update on public.employees
  for each row execute function private.guard_employee_update();

-- ---------------------------------------------------------------------
-- Leave (6.6, 7.2)
-- ---------------------------------------------------------------------
create table public.leave_types (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  name                  text not null,
  days_per_year         numeric(5, 1) not null default 0 check (days_per_year >= 0),
  is_paid               boolean not null default true,
  requires_hr_approval  boolean not null default false,
  gender                text check (gender in ('male', 'female')),
  allow_half_day        boolean not null default true,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.holidays (
  id            uuid primary key default gen_random_uuid(),
  holiday_date  date not null,
  name          text not null,
  location_id   uuid references public.locations (id) on delete cascade, -- null = all locations
  created_at    timestamptz not null default now(),
  unique nulls not distinct (holiday_date, location_id)
);

create table public.leave_balances (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees (id) on delete cascade,
  leave_type_id     uuid not null references public.leave_types (id),
  year              integer not null check (year between 2000 and 2100),
  allocated         numeric(5, 1) not null default 0 check (allocated >= 0),
  carried_forward   numeric(5, 1) not null default 0 check (carried_forward >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (employee_id, leave_type_id, year)
);

create table public.leave_requests (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete cascade,
  leave_type_id       uuid not null references public.leave_types (id),
  start_date          date not null,
  end_date            date not null,
  half_day            boolean not null default false,
  days                numeric(5, 1) not null default 0,
  reason              text,
  status              public.leave_status not null default 'pending',
  stage               public.approval_stage not null default 'manager',
  manager_decided_by  uuid references public.employees (id),
  manager_decided_at  timestamptz,
  hr_decided_by       uuid references public.employees (id),
  hr_decided_at       timestamptz,
  decision_comment    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (end_date >= start_date),
  check (extract(year from start_date) = extract(year from end_date)),
  check (not half_day or start_date = end_date)
);
create index leave_requests_employee_idx on public.leave_requests (employee_id, start_date);
create index leave_requests_status_idx on public.leave_requests (status, stage);

-- Working days between two dates, excluding Sat/Sun and holidays for the location.
create function private.leave_days(p_start date, p_end date, p_location uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select count(*)::numeric
  from generate_series(p_start, p_end, interval '1 day') as d
  where extract(isodow from d) < 6
    and not exists (
      select 1 from public.holidays h
      where h.holiday_date = d::date and (h.location_id is null or h.location_id = p_location)
    );
$$;

-- Validates and prices a new request (LV-06): ownership, overlap, balance.
create function private.leave_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
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

  new.stage := case when emp.manager_id is null then 'hr' else 'manager' end;
  return new;
end $$;

create trigger leave_requests_before_insert
  before insert on public.leave_requests
  for each row execute function private.leave_before_insert();

-- Enforces the approval workflow (7.2) on every status change.
create function private.leave_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
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
    if new.status = 'approved' and needs_hr then
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
end $$;

create trigger leave_requests_before_update
  before update on public.leave_requests
  for each row execute function private.leave_before_update();

-- Balance summary (LV-03). security_invoker so RLS on the base tables applies (13.5 note 4).
create view public.leave_balance_summary with (security_invoker = true) as
select
  b.id,
  b.employee_id,
  b.leave_type_id,
  lt.name as leave_type,
  b.year,
  b.allocated + b.carried_forward as entitled,
  coalesce(sum(r.days) filter (where r.status = 'approved'), 0) as used,
  coalesce(sum(r.days) filter (where r.status = 'pending'), 0) as pending,
  b.allocated + b.carried_forward
    - coalesce(sum(r.days) filter (where r.status in ('approved', 'pending')), 0) as available
from public.leave_balances b
join public.leave_types lt on lt.id = b.leave_type_id
left join public.leave_requests r
  on r.employee_id = b.employee_id
 and r.leave_type_id = b.leave_type_id
 and extract(year from r.start_date) = b.year
group by b.id, lt.name;

-- ---------------------------------------------------------------------
-- updated_at + audit triggers on every business table (13.5 note 2)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'locations', 'cost_centers', 'departments', 'positions', 'position_salary_bands',
    'employees', 'employee_private', 'employee_emergency_contacts', 'employee_dependents',
    'leave_types', 'leave_balances', 'leave_requests'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
                   t || '_updated_at', t);
  end loop;

  foreach t in array array[
    'organizations', 'locations', 'cost_centers', 'departments', 'positions', 'position_salary_bands',
    'employees', 'employee_private', 'employee_emergency_contacts', 'employee_dependents',
    'employee_documents', 'employment_history', 'user_roles',
    'leave_types', 'holidays', 'leave_balances', 'leave_requests'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit()',
                   t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.audit_logs                  enable row level security;
alter table public.organizations               enable row level security;
alter table public.locations                   enable row level security;
alter table public.cost_centers                enable row level security;
alter table public.departments                 enable row level security;
alter table public.positions                   enable row level security;
alter table public.position_salary_bands       enable row level security;
alter table public.employees                   enable row level security;
alter table public.employee_private            enable row level security;
alter table public.employee_emergency_contacts enable row level security;
alter table public.employee_dependents         enable row level security;
alter table public.employee_documents          enable row level security;
alter table public.employment_history          enable row level security;
alter table public.user_roles                  enable row level security;
alter table public.leave_types                 enable row level security;
alter table public.holidays                    enable row level security;
alter table public.leave_balances              enable row level security;
alter table public.leave_requests              enable row level security;

-- Audit logs: System Admin + Auditor read; nobody writes directly.
create policy "audit: admin and auditor read" on public.audit_logs for select to authenticated
  using ((select private.has_any_role(array['system_admin', 'auditor']::public.app_role[])));

-- Organization master data: every signed-in user reads (matrix: Organization R); HR writes.
do $$
declare t text;
begin
  foreach t in array array['organizations', 'locations', 'departments', 'positions', 'leave_types', 'holidays'] loop
    execute format('create policy "%s: signed-in read" on public.%I for select to authenticated using (true)', t, t);
    execute format('create policy "%s: hr insert" on public.%I for insert to authenticated with check ((select private.is_hr()))', t, t);
    execute format('create policy "%s: hr update" on public.%I for update to authenticated using ((select private.is_hr())) with check ((select private.is_hr()))', t, t);
    execute format('create policy "%s: hr delete" on public.%I for delete to authenticated using ((select private.is_hr()))', t, t);
  end loop;
end $$;

-- Cost centers: everyone reads; HR and Finance maintain.
create policy "cost_centers: signed-in read" on public.cost_centers for select to authenticated using (true);
create policy "cost_centers: hr/finance insert" on public.cost_centers for insert to authenticated
  with check ((select private.has_any_role(array['hr_admin', 'finance', 'system_admin']::public.app_role[])));
create policy "cost_centers: hr/finance update" on public.cost_centers for update to authenticated
  using ((select private.has_any_role(array['hr_admin', 'finance', 'system_admin']::public.app_role[])))
  with check ((select private.has_any_role(array['hr_admin', 'finance', 'system_admin']::public.app_role[])));

-- Salary bands: pay information — HR, Finance, Executive.
create policy "salary_bands: restricted read" on public.position_salary_bands for select to authenticated
  using ((select private.has_any_role(array['hr_admin', 'system_admin', 'finance', 'executive']::public.app_role[])));
create policy "salary_bands: hr write" on public.position_salary_bands for all to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));

-- Employees: own record; team (manager/HOD); HR, Executive, Finance, Recruiter, Auditor read all (matrix).
create policy "employees: read" on public.employees for select to authenticated
  using (
    id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'finance', 'recruiter', 'auditor']::public.app_role[]))
    or private.can_see_team(id)
  );
create policy "employees: hr insert" on public.employees for insert to authenticated
  with check ((select private.is_hr()));
-- Own-row update is allowed here; employees_guard_update limits it to contact fields.
create policy "employees: update" on public.employees for update to authenticated
  using ((select private.is_hr()) or id = (select private.current_employee_id()))
  with check ((select private.is_hr()) or id = (select private.current_employee_id()));

-- Restricted PII: employee reads own; HR full; Finance + Auditor read.
create policy "employee_private: read" on public.employee_private for select to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'finance', 'auditor']::public.app_role[]))
  );
create policy "employee_private: hr write" on public.employee_private for all to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));

-- Emergency contacts: ESS-02 — employee manages own; HR manages all; team can read.
create policy "emergency: read" on public.employee_emergency_contacts for select to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.is_hr())
    or private.can_see_team(employee_id)
  );
create policy "emergency: write own or hr" on public.employee_emergency_contacts for all to authenticated
  using ((select private.is_hr()) or employee_id = (select private.current_employee_id()))
  with check ((select private.is_hr()) or employee_id = (select private.current_employee_id()));

-- Dependents: employee reads own; HR manages.
create policy "dependents: read" on public.employee_dependents for select to authenticated
  using (employee_id = (select private.current_employee_id()) or (select private.is_hr()));
create policy "dependents: hr write" on public.employee_dependents for all to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));

-- Documents: employee reads + uploads own; HR manages all; Auditor reads.
create policy "documents: read" on public.employee_documents for select to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'auditor']::public.app_role[]))
  );
create policy "documents: upload own or hr" on public.employee_documents for insert to authenticated
  with check ((select private.is_hr()) or employee_id = (select private.current_employee_id()));
create policy "documents: hr delete" on public.employee_documents for delete to authenticated
  using ((select private.is_hr()));

-- Employment history: employee + team read; HR writes.
create policy "history: read" on public.employment_history for select to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'auditor']::public.app_role[]))
    or private.can_see_team(employee_id)
  );
create policy "history: hr write" on public.employment_history for insert to authenticated
  with check ((select private.is_hr()));

-- Roles: user reads own; HR + Admin + Auditor read all; only System Admin assigns (ADM-02).
create policy "user_roles: read" on public.user_roles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'auditor']::public.app_role[]))
  );
create policy "user_roles: admin insert" on public.user_roles for insert to authenticated
  with check ((select private.has_any_role(array['system_admin']::public.app_role[])));
create policy "user_roles: admin delete" on public.user_roles for delete to authenticated
  using ((select private.has_any_role(array['system_admin']::public.app_role[])));

-- Leave balances: own; team; HR, Executive, Finance read; HR writes.
create policy "leave_balances: read" on public.leave_balances for select to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'finance', 'auditor']::public.app_role[]))
    or private.can_see_team(employee_id)
  );
create policy "leave_balances: hr write" on public.leave_balances for all to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));

-- Leave requests: own; team; HR, Executive, Finance read. Workflow rules live in triggers.
create policy "leave_requests: read" on public.leave_requests for select to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'finance', 'auditor']::public.app_role[]))
    or private.can_see_team(employee_id)
  );
create policy "leave_requests: apply" on public.leave_requests for insert to authenticated
  with check ((select private.is_hr()) or employee_id = (select private.current_employee_id()));
create policy "leave_requests: decide or cancel" on public.leave_requests for update to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.is_hr())
    or private.can_see_team(employee_id)
  )
  with check (true);

-- ---------------------------------------------------------------------
-- Data API grants (anon gets nothing; authenticated is filtered by RLS)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;
revoke update on public.user_roles, public.employee_documents, public.employment_history from authenticated;
revoke delete on public.employees, public.leave_requests from authenticated; -- soft delete / cancel instead
grant usage, select on all sequences in schema public to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
-- Supabase Auth fires on_auth_user_confirmed.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.link_auth_user() to supabase_auth_admin;
grant execute on function
  private.has_any_role(public.app_role[]),
  private.is_hr(),
  private.current_employee_id(),
  private.can_see_team(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- Storage: private bucket for personnel files, path = {employee_id}/{file}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-documents', 'employee-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "employee-documents: read own or hr" on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-documents'
    and (
      (storage.foldername(name))[1] = (select private.current_employee_id())::text
      or (select private.has_any_role(array['hr_admin', 'system_admin', 'auditor']::public.app_role[]))
    )
  );
create policy "employee-documents: upload own or hr" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'employee-documents'
    and (
      (storage.foldername(name))[1] = (select private.current_employee_id())::text
      or (select private.is_hr())
    )
  );
create policy "employee-documents: hr delete" on storage.objects for delete to authenticated
  using (bucket_id = 'employee-documents' and (select private.is_hr()));

-- ---------------------------------------------------------------------
-- Starter data (editable by HR). Leave entitlements and holidays are
-- defaults pending client policy (BRD 6.18 Q5).
-- ---------------------------------------------------------------------
insert into public.organizations (code, name, org_type) values ('AEG', 'AE Global Group of Companies', 'company');

insert into public.locations (code, name, city) values
  ('LHR-HO', 'Lahore Head Office', 'Lahore'),
  ('GRW', 'Gujranwala Office', 'Gujranwala'),
  ('ISB', 'Islamabad Office', 'Islamabad');

insert into public.departments (code, name, organization_id)
select d.code, d.name, o.id
from (values
  ('HR', 'Human Resources'),
  ('FIN', 'Finance & Accounts'),
  ('IT', 'Information Technology'),
  ('ADM', 'Administration'),
  ('OPS', 'Operations')
) as d (code, name)
cross join public.organizations o where o.code = 'AEG';

insert into public.leave_types (code, name, days_per_year, requires_hr_approval, gender, allow_half_day) values
  ('AL', 'Annual Leave', 14, false, null, true),
  ('CL', 'Casual Leave', 10, false, null, true),
  ('SL', 'Sick Leave', 8, false, null, true),
  ('ML', 'Maternity Leave', 90, true, 'female', false),
  ('UL', 'Unpaid Leave', 30, true, null, false);
update public.leave_types set is_paid = false where code = 'UL';

-- Fixed-date national holidays. Islamic holidays depend on moon sighting; HR adds them each year.
insert into public.holidays (holiday_date, name) values
  ('2026-11-09', 'Iqbal Day'),
  ('2026-12-25', 'Quaid-e-Azam Day'),
  ('2027-02-05', 'Kashmir Solidarity Day'),
  ('2027-03-23', 'Pakistan Day'),
  ('2027-05-01', 'Labour Day'),
  ('2027-05-28', 'Youm-e-Takbeer'),
  ('2027-08-14', 'Independence Day'),
  ('2027-11-09', 'Iqbal Day'),
  ('2027-12-25', 'Quaid-e-Azam Day');

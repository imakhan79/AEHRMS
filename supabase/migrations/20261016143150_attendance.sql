-- =====================================================================
-- Attendance (BRD 6.5 ATT-01..10, 7.3 regularization, 7.4 field attendance)
-- Raw punches (web / mobile / biometric / manual) → computed daily attendance.
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;

create type public.attendance_source as enum ('biometric', 'mobile', 'manual', 'web');
create type public.punch_type as enum ('in', 'out');
create type public.verification_status as enum ('auto', 'pending', 'verified', 'rejected');
create type public.attendance_status as enum (
  'present', 'late', 'half_day', 'absent', 'leave', 'holiday', 'weekly_off', 'missing_punch'
);

alter table public.employees add column biometric_user_id text unique;

-- ---------------------------------------------------------------------
-- Shifts (ATT-02, ATT-03)
-- ---------------------------------------------------------------------
create table public.shifts (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique,
  name                    text not null,
  shift_type              text not null default 'fixed' check (shift_type in ('fixed', 'flexible')),
  start_time              time not null default '09:00',
  end_time                time not null default '17:00', -- earlier than start_time = overnight shift
  grace_minutes           integer not null default 15 check (grace_minutes between 0 and 240),
  full_day_minutes        integer not null default 480 check (full_day_minutes > 0),
  half_day_minutes        integer not null default 240 check (half_day_minutes > 0),
  overtime_enabled        boolean not null default true,
  overtime_after_minutes  integer not null default 30 check (overtime_after_minutes >= 0),
  weekly_off_days         integer[] not null default '{6,7}', -- ISO weekday: 1 = Mon … 7 = Sun
  is_default              boolean not null default false,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (half_day_minutes <= full_day_minutes),
  check (weekly_off_days <@ array[1, 2, 3, 4, 5, 6, 7])
);
create unique index shifts_single_default on public.shifts (is_default) where is_default;

-- Rotating rosters are expressed as consecutive dated assignments.
create table public.employee_shifts (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees (id) on delete cascade,
  shift_id        uuid not null references public.shifts (id),
  effective_from  date not null,
  effective_to    date,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index employee_shifts_lookup on public.employee_shifts (employee_id, effective_from desc);

-- ---------------------------------------------------------------------
-- Biometric devices (ATT-01). API key stored as SHA-256 hash only.
-- ---------------------------------------------------------------------
create table public.biometric_devices (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  location_id    uuid references public.locations (id),
  serial_number  text,
  api_key_hash   text not null,
  is_active      boolean not null default true,
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Raw punches — every source lands here (BRD "biometric_events" + mobile/web).
-- ---------------------------------------------------------------------
create table public.attendance_punches (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees (id) on delete cascade,
  punch_time         timestamptz not null default now(),
  work_date          date not null,
  punch_type         public.punch_type not null,
  source             public.attendance_source not null,
  latitude           numeric(9, 6) check (latitude between -90 and 90),
  longitude          numeric(9, 6) check (longitude between -180 and 180),
  accuracy_m         numeric(8, 1) check (accuracy_m >= 0),
  distance_m         numeric(10, 1),
  within_geofence    boolean,
  selfie_path        text,
  device_id          uuid references public.biometric_devices (id),
  client_event_id    uuid unique, -- idempotency key for offline sync (ATT-08)
  captured_offline   boolean not null default false,
  verification       public.verification_status not null default 'auto',
  verified_by        uuid references public.employees (id),
  verified_at        timestamptz,
  verification_note  text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now()
);
create index punches_employee_date on public.attendance_punches (employee_id, work_date);
create index punches_pending on public.attendance_punches (verification) where verification = 'pending';
create unique index punches_device_dedupe on public.attendance_punches (device_id, employee_id, punch_time)
  where device_id is not null;

-- ---------------------------------------------------------------------
-- Daily attendance — computed only, never written by users (feeds payroll, ATT-10).
-- ---------------------------------------------------------------------
create table public.attendance (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.employees (id) on delete cascade,
  work_date            date not null,
  shift_id             uuid references public.shifts (id),
  first_in             timestamptz,
  last_out             timestamptz,
  worked_minutes       integer not null default 0,
  late_minutes         integer not null default 0,
  early_leave_minutes  integer not null default 0,
  overtime_minutes     integer not null default 0,
  status               public.attendance_status not null,
  is_regularized       boolean not null default false,
  pending_punches      integer not null default 0,
  computed_at          timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index attendance_date_idx on public.attendance (work_date);
create index attendance_status_idx on public.attendance (status);

-- ---------------------------------------------------------------------
-- Regularization (ATT-04, 7.3)
-- ---------------------------------------------------------------------
create table public.attendance_regularizations (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees (id) on delete cascade,
  work_date         date not null,
  requested_in      timestamptz not null,
  requested_out     timestamptz not null,
  reason            text not null check (length(trim(reason)) > 0),
  status            public.leave_status not null default 'pending',
  stage             public.approval_stage not null default 'manager',
  decided_by        uuid references public.employees (id),
  decided_at        timestamptz,
  decision_comment  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (requested_out > requested_in),
  check (requested_out - requested_in <= interval '20 hours')
);
create index regularizations_employee on public.attendance_regularizations (employee_id, work_date);
create index regularizations_pending on public.attendance_regularizations (status) where status = 'pending';

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create function private.employee_tz(emp uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select l.timezone from public.employees e join public.locations l on l.id = e.location_id where e.id = emp),
    'Asia/Karachi'
  );
$$;

create function private.shift_for(emp uuid, d date) returns public.shifts
language sql stable security definer set search_path = '' as $$
  select s.* from public.shifts s
  where s.id = coalesce(
    (select es.shift_id from public.employee_shifts es
      where es.employee_id = emp and es.effective_from <= d and (es.effective_to is null or es.effective_to >= d)
      order by es.effective_from desc limit 1),
    (select d2.id from public.shifts d2 where d2.is_default and d2.is_active limit 1)
  );
$$;

-- Great-circle distance in metres (no PostGIS needed at this scale).
create function private.distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) returns numeric
language sql immutable set search_path = '' as $$
  select round((2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::numeric, 1);
$$;

-- ---------------------------------------------------------------------
-- Daily computation
-- ---------------------------------------------------------------------
create function private.recompute_attendance(p_emp uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  emp          public.employees;
  s            public.shifts;
  tz           text;
  local_today  date;
  is_holiday   boolean;
  is_off       boolean;
  on_leave     boolean;
  reg          public.attendance_regularizations;
  fin          timestamptz;
  lout         timestamptz;
  pending_n    integer;
  worked       integer := 0;
  late         integer := 0;
  early        integer := 0;
  ot           integer := 0;
  st           public.attendance_status;
  s_start      timestamptz;
  s_end        timestamptz;
begin
  select * into emp from public.employees where id = p_emp;
  if emp.id is null or emp.deleted_at is not null or emp.status = 'draft'
     or (emp.joining_date is not null and p_date < emp.joining_date)
     or (emp.exit_date is not null and p_date > emp.exit_date) then
    delete from public.attendance where employee_id = p_emp and work_date = p_date;
    return;
  end if;

  tz := private.employee_tz(p_emp);
  local_today := (now() at time zone tz)::date;
  if p_date > local_today then
    return;
  end if;

  s := private.shift_for(p_emp, p_date);
  is_holiday := exists (
    select 1 from public.holidays h
    where h.holiday_date = p_date and (h.location_id is null or h.location_id = emp.location_id)
  );
  is_off := extract(isodow from p_date)::int = any (coalesce(s.weekly_off_days, '{6,7}'));
  on_leave := exists (
    select 1 from public.leave_requests r
    where r.employee_id = p_emp and r.status = 'approved' and not r.half_day
      and p_date between r.start_date and r.end_date
  );

  select * into reg from public.attendance_regularizations r
   where r.employee_id = p_emp and r.work_date = p_date and r.status = 'approved'
   order by r.decided_at desc limit 1;

  if reg.id is not null then
    fin := reg.requested_in;
    lout := reg.requested_out;
  else
    select min(p.punch_time) filter (where p.punch_type = 'in'),
           max(p.punch_time) filter (where p.punch_type = 'out')
      into fin, lout
      from public.attendance_punches p
     where p.employee_id = p_emp and p.work_date = p_date and p.verification in ('auto', 'verified');
  end if;
  if fin is not null and lout is not null and lout <= fin then
    lout := null;
  end if;
  select count(*) into pending_n from public.attendance_punches p
   where p.employee_id = p_emp and p.work_date = p_date and p.verification = 'pending';

  if fin is not null and lout is not null then
    worked := floor(extract(epoch from lout - fin) / 60)::int;
  end if;
  if s.id is not null then
    s_start := (p_date + s.start_time) at time zone tz;
    s_end := (p_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end) at time zone tz;
  end if;

  if is_holiday then
    st := 'holiday';
  elsif is_off then
    st := 'weekly_off';
  elsif on_leave then
    st := 'leave';
  elsif fin is null and lout is null then
    -- Today isn't over yet: don't mark absent until the day has passed (or shift ended).
    if p_date = local_today and (s_end is null or now() < s_end) then
      delete from public.attendance where employee_id = p_emp and work_date = p_date;
      return;
    end if;
    st := 'absent';
  elsif fin is null or lout is null then
    st := 'missing_punch';
  else
    if s.id is not null and s.shift_type = 'fixed' then
      late := greatest(0, floor(extract(epoch from fin - s_start) / 60))::int;
      if late <= s.grace_minutes then late := 0; end if;
      early := greatest(0, floor(extract(epoch from s_end - lout) / 60))::int;
    end if;
    if worked >= coalesce(s.full_day_minutes, 480) then
      st := case when late > 0 then 'late' else 'present' end;
    elsif worked >= coalesce(s.half_day_minutes, 240) then
      st := 'half_day';
    else
      st := 'absent';
    end if;
  end if;

  if coalesce(s.overtime_enabled, false) and worked > 0 then
    if st in ('holiday', 'weekly_off') then
      ot := worked;
    elsif worked - s.full_day_minutes >= s.overtime_after_minutes then
      ot := worked - s.full_day_minutes;
    end if;
  end if;

  insert into public.attendance as a (
    employee_id, work_date, shift_id, first_in, last_out, worked_minutes, late_minutes,
    early_leave_minutes, overtime_minutes, status, is_regularized, pending_punches, computed_at
  ) values (
    p_emp, p_date, s.id, fin, lout, worked, late, early, ot, st, reg.id is not null, pending_n, now()
  )
  on conflict (employee_id, work_date) do update set
    shift_id = excluded.shift_id, first_in = excluded.first_in, last_out = excluded.last_out,
    worked_minutes = excluded.worked_minutes, late_minutes = excluded.late_minutes,
    early_leave_minutes = excluded.early_leave_minutes, overtime_minutes = excluded.overtime_minutes,
    status = excluded.status, is_regularized = excluded.is_regularized,
    pending_punches = excluded.pending_punches, computed_at = excluded.computed_at;
end $$;

-- Nightly: closes out yesterday for every active employee (creates absent rows).
create function private.mark_daily_attendance(p_date date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  n integer := 0;
begin
  for e in
    select id from public.employees
    where deleted_at is null and status not in ('draft', 'exited')
  loop
    perform private.recompute_attendance(e.id, p_date);
    n := n + 1;
  end loop;
  return n;
end $$;

-- HR tool: recompute a date range after shift/holiday changes.
create function public.recompute_attendance(p_from date, p_to date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d date;
  n integer := 0;
begin
  if not private.is_hr() then
    raise exception 'Only HR can recompute attendance.' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a range of up to 62 days.';
  end if;
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    n := n + private.mark_daily_attendance(d);
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Punch triggers
-- ---------------------------------------------------------------------
create function private.punch_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  trusted  boolean := coalesce(current_setting('app.trusted_ingest', true), '') = 'on' or auth.uid() is null;
  emp      public.employees;
  loc      public.locations;
  s        public.shifts;
  tz       text;
  local_ts timestamp;
begin
  if not trusted then
    if private.is_hr() and new.source = 'manual' then
      null; -- HR manual entry for any employee
    else
      if new.employee_id is distinct from private.current_employee_id() then
        raise exception 'You can only mark your own attendance.' using errcode = '42501';
      end if;
      if new.source not in ('web', 'mobile') then
        raise exception 'Invalid attendance source.' using errcode = '42501';
      end if;
      -- Server time is authoritative; offline captures may carry their device time (≤ 72 h old).
      if new.captured_offline and new.punch_time between now() - interval '72 hours' and now() + interval '5 minutes' then
        null;
      else
        new.captured_offline := false;
        new.punch_time := now();
      end if;
      new.device_id := null;
      -- A selfie must live in the employee's own folder.
      if new.selfie_path is not null and new.selfie_path not like new.employee_id::text || '/%' then
        new.selfie_path := null;
      end if;
    end if;
    new.verified_by := null;
    new.verified_at := null;
    new.verification_note := null;
  end if;

  select * into emp from public.employees where id = new.employee_id;
  if emp.status in ('draft', 'exited') or emp.deleted_at is not null then
    raise exception 'Attendance cannot be recorded for an inactive employee.';
  end if;

  tz := private.employee_tz(new.employee_id);
  local_ts := new.punch_time at time zone tz;
  new.work_date := local_ts::date;
  s := private.shift_for(new.employee_id, new.work_date - 1);
  -- Overnight shift: early-morning punches belong to the previous day's shift.
  if s.end_time is not null and s.end_time <= s.start_time and local_ts::time < s.end_time + interval '4 hours' then
    new.work_date := new.work_date - 1;
  end if;

  if exists (
    select 1 from public.attendance_punches p
    where p.employee_id = new.employee_id and p.punch_type = new.punch_type
      and p.verification <> 'rejected'
      and abs(extract(epoch from p.punch_time - new.punch_time)) < 120
  ) then
    raise exception 'This % punch was already recorded.', new.punch_type;
  end if;

  if new.source in ('web', 'mobile') then
    select * into loc from public.locations where id = emp.location_id;
    if new.latitude is not null and new.longitude is not null and loc.latitude is not null then
      new.distance_m := private.distance_m(new.latitude, new.longitude, loc.latitude, loc.longitude);
      new.within_geofence := new.distance_m <= loc.geofence_radius_m;
    else
      new.distance_m := null;
      new.within_geofence := null;
    end if;
    -- Outside the geofence, no GPS, or captured offline → manager verifies (7.4).
    new.verification := case when new.within_geofence and not new.captured_offline then 'auto' else 'pending' end;
  elsif not trusted or new.source = 'biometric' then
    new.verification := 'auto';
  end if;
  return new;
end $$;

create trigger punches_before_insert
  before insert on public.attendance_punches
  for each row execute function private.punch_before_insert();

-- Only verification may change, only by the employee's manager/HOD or HR, never on own punches.
create function private.punch_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.employee_id, new.punch_time, new.work_date, new.punch_type, new.source, new.latitude, new.longitude,
      new.distance_m, new.within_geofence, new.selfie_path, new.device_id, new.captured_offline)
     is distinct from
     (old.employee_id, old.punch_time, old.work_date, old.punch_type, old.source, old.latitude, old.longitude,
      old.distance_m, old.within_geofence, old.selfie_path, old.device_id, old.captured_offline) then
    raise exception 'Punches cannot be edited. Request a regularization instead.';
  end if;
  if new.verification is not distinct from old.verification then
    return new;
  end if;
  if auth.uid() is not null then
    if old.employee_id = private.current_employee_id() then
      raise exception 'You cannot verify your own attendance.' using errcode = '42501';
    end if;
    if not (private.is_hr() or private.can_see_team(old.employee_id)) then
      raise exception 'Only the line manager, HOD or HR can verify this punch.' using errcode = '42501';
    end if;
  end if;
  if old.verification <> 'pending' or new.verification not in ('verified', 'rejected') then
    raise exception 'Only pending punches can be verified or rejected.';
  end if;
  new.verified_by := private.current_employee_id();
  new.verified_at := now();
  return new;
end $$;

create trigger punches_before_update
  before update on public.attendance_punches
  for each row execute function private.punch_before_update();

create function private.punch_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.recompute_attendance(new.employee_id, new.work_date);
  return null;
end $$;

create trigger punches_after_change
  after insert or update on public.attendance_punches
  for each row execute function private.punch_after_change();

-- ---------------------------------------------------------------------
-- Regularization workflow (7.3): manager → done (HR if no manager).
-- ---------------------------------------------------------------------
create function private.regularization_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  emp  public.employees;
  tz   text;
begin
  if auth.uid() is not null and not private.is_hr()
     and new.employee_id is distinct from private.current_employee_id() then
    raise exception 'You can only request corrections for yourself.' using errcode = '42501';
  end if;
  select * into emp from public.employees where id = new.employee_id;
  tz := private.employee_tz(new.employee_id);
  if new.work_date > (now() at time zone tz)::date then
    raise exception 'You can''t regularize a future date.';
  end if;
  if new.work_date < (now() at time zone tz)::date - 45 then
    raise exception 'Corrections must be requested within 45 days.';
  end if;
  if (new.requested_in at time zone tz)::date not in (new.work_date, new.work_date + 1) then
    raise exception 'The check-in time must be on the selected date.';
  end if;
  if exists (
    select 1 from public.attendance_regularizations r
    where r.employee_id = new.employee_id and r.work_date = new.work_date and r.status = 'pending'
  ) then
    raise exception 'A correction for this date is already pending.';
  end if;
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  new.stage := case when emp.manager_id is null then 'hr' else 'manager' end;
  return new;
end $$;

create trigger regularizations_before_insert
  before insert on public.attendance_regularizations
  for each row execute function private.regularization_before_insert();

create function private.regularization_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me  uuid := private.current_employee_id();
  hr  boolean := private.is_hr();
begin
  if (new.employee_id, new.work_date, new.requested_in, new.requested_out, new.reason)
     is distinct from (old.employee_id, old.work_date, old.requested_in, old.requested_out, old.reason) then
    raise exception 'A submitted correction cannot be edited. Cancel it and submit again.';
  end if;
  new.decided_by := old.decided_by;
  new.decided_at := old.decided_at;
  if new.status = old.status and new.stage = old.stage then
    new.decision_comment := old.decision_comment;
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'This correction has already been decided.';
  end if;
  if new.status = 'cancelled' then
    if not hr and old.employee_id is distinct from me then
      raise exception 'Only the employee or HR can cancel this request.' using errcode = '42501';
    end if;
    new.stage := 'done';
    return new;
  end if;
  if new.status not in ('approved', 'rejected') then
    raise exception 'Invalid status change.';
  end if;
  if old.employee_id = me then
    raise exception 'You cannot approve your own correction.' using errcode = '42501';
  end if;
  if old.stage = 'manager' and not (hr or private.can_see_team(old.employee_id)) then
    raise exception 'Only the line manager, HOD or HR can decide this request.' using errcode = '42501';
  end if;
  if old.stage = 'hr' and not hr then
    raise exception 'This request is awaiting HR.' using errcode = '42501';
  end if;
  new.decided_by := me;
  new.decided_at := now();
  new.stage := 'done';
  return new;
end $$;

create trigger regularizations_before_update
  before update on public.attendance_regularizations
  for each row execute function private.regularization_before_update();

create function private.regularization_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform private.recompute_attendance(new.employee_id, new.work_date);
  end if;
  return null;
end $$;

create trigger regularizations_after_update
  after update on public.attendance_regularizations
  for each row execute function private.regularization_after_update();

-- Leave decisions change attendance status for past/current days.
create function private.leave_after_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d date;
begin
  if new.status is distinct from old.status and (new.status = 'approved' or old.status = 'approved') then
    for d in select generate_series(new.start_date, least(new.end_date, current_date), interval '1 day')::date loop
      perform private.recompute_attendance(new.employee_id, d);
    end loop;
  end if;
  return null;
end $$;

create trigger leave_requests_attendance_sync
  after update of status on public.leave_requests
  for each row execute function private.leave_after_status();

-- ---------------------------------------------------------------------
-- Biometric ingestion (ATT-01). Public by design: devices authenticate with
-- their own API key (hash-compared), and can only add punches.
-- ---------------------------------------------------------------------
create function public.ingest_biometric_events(p_device_code text, p_api_key text, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  dev        public.biometric_devices;
  ev         jsonb;
  emp_id     uuid;
  ts         timestamptz;
  ptype      public.punch_type;
  accepted   integer := 0;
  duplicate  integer := 0;
  unknown    text[] := '{}';
begin
  select * into dev from public.biometric_devices
   where code = p_device_code and is_active
     and api_key_hash = encode(extensions.digest(coalesce(p_api_key, ''), 'sha256'), 'hex');
  if dev.id is null then
    raise exception 'Unknown device or invalid key.' using errcode = '28000';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 1000 then
    raise exception 'events must be an array of at most 1000 items.';
  end if;

  perform set_config('app.trusted_ingest', 'on', true);
  for ev in select * from jsonb_array_elements(p_events) loop
    select id into emp_id from public.employees where biometric_user_id = ev ->> 'user_id';
    if emp_id is null then
      unknown := array_append(unknown, ev ->> 'user_id');
      continue;
    end if;
    ts := (ev ->> 'timestamp')::timestamptz;
    ptype := coalesce(
      nullif(ev ->> 'type', '')::public.punch_type,
      case when exists (
        select 1 from public.attendance_punches p
        where p.employee_id = emp_id and p.punch_type = 'in'
          and p.work_date = (ts at time zone private.employee_tz(emp_id))::date
      ) then 'out' else 'in' end::public.punch_type
    );
    begin
      insert into public.attendance_punches (employee_id, punch_time, work_date, punch_type, source, device_id)
      values (emp_id, ts, (ts at time zone 'UTC')::date, ptype, 'biometric', dev.id);
      accepted := accepted + 1;
    exception when unique_violation or raise_exception then
      duplicate := duplicate + 1;
    end;
  end loop;
  perform set_config('app.trusted_ingest', '', true);

  update public.biometric_devices set last_seen_at = now() where id = dev.id;
  return jsonb_build_object('accepted', accepted, 'duplicates', duplicate, 'unknown_user_ids', to_jsonb(unknown));
end $$;

-- ---------------------------------------------------------------------
-- updated_at + audit
-- ---------------------------------------------------------------------
create trigger shifts_updated_at before update on public.shifts
  for each row execute function private.set_updated_at();
create trigger attendance_regularizations_updated_at before update on public.attendance_regularizations
  for each row execute function private.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['shifts', 'employee_shifts', 'biometric_devices', 'attendance_punches', 'attendance_regularizations'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit()',
                   t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.shifts                     enable row level security;
alter table public.employee_shifts            enable row level security;
alter table public.biometric_devices          enable row level security;
alter table public.attendance_punches         enable row level security;
alter table public.attendance                 enable row level security;
alter table public.attendance_regularizations enable row level security;

create policy "shifts: signed-in read" on public.shifts for select to authenticated using (true);
create policy "shifts: hr insert" on public.shifts for insert to authenticated with check ((select private.is_hr()));
create policy "shifts: hr update" on public.shifts for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));

create policy "employee_shifts: read" on public.employee_shifts for select to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'finance', 'auditor']::public.app_role[]))
    or private.can_see_team(employee_id)
  );
create policy "employee_shifts: hr insert" on public.employee_shifts for insert to authenticated with check ((select private.is_hr()));
create policy "employee_shifts: hr update" on public.employee_shifts for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));
create policy "employee_shifts: hr delete" on public.employee_shifts for delete to authenticated using ((select private.is_hr()));

create policy "devices: hr read" on public.biometric_devices for select to authenticated using ((select private.is_hr()));
create policy "devices: hr insert" on public.biometric_devices for insert to authenticated with check ((select private.is_hr()));
create policy "devices: hr update" on public.biometric_devices for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));

-- Attendance data (matrix: Executive/Finance R, HOD team, Employee own, HR CRUD).
create policy "punches: read" on public.attendance_punches for select to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'finance', 'auditor']::public.app_role[]))
    or private.can_see_team(employee_id)
  );
create policy "punches: own or hr insert" on public.attendance_punches for insert to authenticated
  with check ((select private.is_hr()) or employee_id = (select private.current_employee_id()));
create policy "punches: verify" on public.attendance_punches for update to authenticated
  using ((select private.is_hr()) or private.can_see_team(employee_id))
  with check ((select private.is_hr()) or private.can_see_team(employee_id));

create policy "attendance: read" on public.attendance for select to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'finance', 'auditor']::public.app_role[]))
    or private.can_see_team(employee_id)
  );

create policy "regularizations: read" on public.attendance_regularizations for select to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.has_any_role(array['hr_admin', 'system_admin', 'executive', 'finance', 'auditor']::public.app_role[]))
    or private.can_see_team(employee_id)
  );
create policy "regularizations: request" on public.attendance_regularizations for insert to authenticated
  with check ((select private.is_hr()) or employee_id = (select private.current_employee_id()));
create policy "regularizations: decide or cancel" on public.attendance_regularizations for update to authenticated
  using (
    employee_id = (select private.current_employee_id())
    or (select private.is_hr())
    or private.can_see_team(employee_id)
  )
  with check (
    employee_id = (select private.current_employee_id())
    or (select private.is_hr())
    or private.can_see_team(employee_id)
  );

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
-- Supabase's default privileges grant ALL on new tables; start from nothing.
revoke all on public.shifts, public.employee_shifts, public.biometric_devices, public.attendance_punches,
  public.attendance, public.attendance_regularizations from anon, authenticated;
grant select, insert, update on public.shifts, public.attendance_punches, public.attendance_regularizations to authenticated;
grant select, insert, update, delete on public.employee_shifts to authenticated;
grant select on public.attendance to authenticated; -- computed only
-- Hygiene: TRUNCATE bypasses RLS; nothing client-facing needs it (or REFERENCES/TRIGGER).
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
-- Device key hashes are never readable through the API.
grant insert, update on public.biometric_devices to authenticated;
grant select (id, code, name, location_id, serial_number, is_active, last_seen_at, created_at)
  on public.biometric_devices to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_any_role(public.app_role[]),
  private.is_hr(),
  private.current_employee_id(),
  private.can_see_team(uuid)
to authenticated;

revoke execute on function public.recompute_attendance(date, date) from public, anon;
grant execute on function public.recompute_attendance(date, date) to authenticated;
revoke execute on function public.ingest_biometric_events(text, text, jsonb) from public;
grant execute on function public.ingest_biometric_events(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Selfie storage (ATT-07): private bucket, path = {employee_id}/{work_date}/{file}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-selfies', 'attendance-selfies', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "attendance-selfies: upload own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attendance-selfies'
    and (storage.foldername(name))[1] = (select private.current_employee_id())::text
  );
create policy "attendance-selfies: read own, team or hr" on storage.objects for select to authenticated
  using (
    bucket_id = 'attendance-selfies'
    and (
      (storage.foldername(name))[1] = (select private.current_employee_id())::text
      or (select private.has_any_role(array['hr_admin', 'system_admin', 'auditor']::public.app_role[]))
      or exists (
        select 1 from public.employees e
        where e.id::text = (storage.foldername(name))[1] and private.can_see_team(e.id)
      )
    )
  );

-- ---------------------------------------------------------------------
-- Starter data + nightly job (00:30 PKT = 19:30 UTC)
-- ---------------------------------------------------------------------
insert into public.shifts (code, name, start_time, end_time, is_default)
values ('GEN', 'General (09:00–17:00)', '09:00', '17:00', true);

select cron.schedule(
  'attendance-close-yesterday',
  '30 19 * * *',
  $$select private.mark_daily_attendance(((now() at time zone 'Asia/Karachi')::date - 1))$$
);

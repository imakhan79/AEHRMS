-- Monthly attendance summary (ATT-09). SECURITY INVOKER: RLS on employees and
-- attendance decides whose rows each caller gets (HR all, HOD team, employee self).
create function public.attendance_monthly_summary(p_month date)
returns table (
  employee_id        uuid,
  employee_code      text,
  full_name          text,
  department         text,
  present            integer,
  late               integer,
  half_day           integer,
  absent             integer,
  on_leave           integer,
  holiday            integer,
  weekly_off         integer,
  missing_punch      integer,
  worked_minutes     integer,
  late_minutes       integer,
  overtime_minutes   integer
)
language sql stable security invoker set search_path = '' as $$
  select
    e.id,
    e.employee_code,
    e.full_name,
    d.name,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'late')::int,
    count(*) filter (where a.status = 'half_day')::int,
    count(*) filter (where a.status = 'absent')::int,
    count(*) filter (where a.status = 'leave')::int,
    count(*) filter (where a.status = 'holiday')::int,
    count(*) filter (where a.status = 'weekly_off')::int,
    count(*) filter (where a.status = 'missing_punch')::int,
    coalesce(sum(a.worked_minutes), 0)::int,
    coalesce(sum(a.late_minutes), 0)::int,
    coalesce(sum(a.overtime_minutes), 0)::int
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.attendance a
    on a.employee_id = e.id
   and a.work_date >= date_trunc('month', p_month)::date
   and a.work_date < (date_trunc('month', p_month) + interval '1 month')::date
  where e.deleted_at is null and e.status <> 'draft'
  group by e.id, d.name
  order by e.employee_code;
$$;

revoke execute on function public.attendance_monthly_summary(date) from public, anon;
grant execute on function public.attendance_monthly_summary(date) to authenticated;

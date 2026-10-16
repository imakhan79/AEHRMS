-- Income tax is projected from posted year-to-date payslips. A run calculated while an
-- earlier month of the same tax year was still unposted would use incomplete YTD figures,
-- so it can't be submitted until that month is posted and this run is recalculated.
create function private.payroll_ytd_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pending  text;
  last_post timestamptz;
begin
  if new.status = 'review' and old.status = 'draft' and not new.is_parallel then
    select string_agg(to_char(r.period_month, 'Mon YYYY'), ', ' order by r.period_month) into pending
      from public.payroll_runs r
     where not r.is_parallel and r.tax_year = new.tax_year and r.period_month < new.period_month
       and r.status not in ('posted', 'paid');
    if pending is not null then
      raise exception 'Post % first — this month''s income tax depends on it.', pending;
    end if;
    select max(r.posted_at) into last_post
      from public.payroll_runs r
     where not r.is_parallel and r.tax_year = new.tax_year and r.period_month < new.period_month;
    if last_post is not null and new.processed_at < last_post then
      raise exception 'An earlier month was posted after this run was calculated. Recalculate before submitting.';
    end if;
  end if;
  return new;
end $$;

create trigger payroll_runs_ytd_guard
  before update of status on public.payroll_runs
  for each row execute function private.payroll_ytd_guard();

revoke execute on function private.payroll_ytd_guard() from public, anon, authenticated;

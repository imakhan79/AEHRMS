-- Employees can't read payroll_runs, so each payslip carries its own period.
alter table public.payslips add column period_month date;

create function private.payslip_set_period() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select period_month into new.period_month from public.payroll_runs where id = new.payroll_run_id;
  return new;
end $$;

create trigger payslips_set_period before insert on public.payslips
  for each row execute function private.payslip_set_period();

update public.payslips p set period_month = r.period_month from public.payroll_runs r where r.id = p.payroll_run_id;
alter table public.payslips alter column period_month set not null;
create index payslips_employee_period_idx on public.payslips (employee_id, period_month desc);

revoke execute on function private.payslip_set_period() from public, anon, authenticated;

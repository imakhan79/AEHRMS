-- Employees can't read payroll_runs, so the payslip policy's run-status check needs a
-- narrow definer helper that only answers "is this run released to employees?".
create function private.payroll_released(p_run uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.payroll_runs r
    where r.id = p_run and r.status in ('approved', 'posted', 'paid') and not r.is_parallel
  );
$$;

revoke execute on function private.payroll_released(uuid) from public, anon;
grant execute on function private.payroll_released(uuid) to authenticated;

drop policy "payslips: read" on public.payslips;
create policy "payslips: read" on public.payslips for select to authenticated
  using (
    (select private.can_read_payroll())
    or (employee_id = (select private.current_employee_id()) and private.payroll_released(payroll_run_id))
  );

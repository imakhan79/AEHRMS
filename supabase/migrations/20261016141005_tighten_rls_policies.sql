-- Advisor fixes: split FOR ALL write policies so they don't add a second SELECT
-- policy, and give the leave UPDATE policy a real WITH CHECK.

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('employee_private', 'employee_private: hr write', '(select private.is_hr())'),
      ('employee_dependents', 'dependents: hr write', '(select private.is_hr())'),
      ('leave_balances', 'leave_balances: hr write', '(select private.is_hr())'),
      ('position_salary_bands', 'salary_bands: hr write', '(select private.is_hr())'),
      ('employee_emergency_contacts', 'emergency: write own or hr',
       '(select private.is_hr()) or employee_id = (select private.current_employee_id())')
    ) as v (tbl, old_policy, expr)
  loop
    execute format('drop policy %I on public.%I', spec.old_policy, spec.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
                   spec.tbl || ': insert', spec.tbl, spec.expr);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                   spec.tbl || ': update', spec.tbl, spec.expr, spec.expr);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)',
                   spec.tbl || ': delete', spec.tbl, spec.expr);
  end loop;
end $$;

drop policy "leave_requests: decide or cancel" on public.leave_requests;
create policy "leave_requests: decide or cancel" on public.leave_requests for update to authenticated
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

-- The ESS guard must not block trusted system functions (SECURITY DEFINER, e.g. exit_decide
-- putting an employee on notice when a manager approves). Direct API edits run as "authenticated".
create or replace function private.guard_employee_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  -- full_name is generated (not yet computed in BEFORE triggers), so it's ignored too.
  ess_fields text[] := array['personal_email', 'phone', 'address', 'city', 'marital_status', 'updated_at', 'full_name'];
begin
  if auth.uid() is null or current_user <> 'authenticated' or private.is_hr() then
    return new;
  end if;
  if (to_jsonb(new) - ess_fields) is distinct from (to_jsonb(old) - ess_fields) then
    raise exception 'You can only update your contact details. Contact HR for other changes.'
      using errcode = '42501';
  end if;
  return new;
end $$;

revoke execute on function private.guard_employee_update() from public, anon, authenticated;

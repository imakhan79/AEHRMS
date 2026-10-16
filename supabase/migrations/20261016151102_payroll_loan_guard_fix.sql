-- Loan edit guard: block direct API edits (role "authenticated") of disbursed amounts,
-- while letting SECURITY DEFINER system functions (payroll posting, F&F, disbursement JE link)
-- update balances. Those run as the function owner, not as "authenticated".
create or replace function private.loan_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated'
     and (new.principal, new.employee_id, new.balance, new.status, new.disbursed_on, new.journal_entry_id)
         is distinct from (old.principal, old.employee_id, old.balance, old.status, old.disbursed_on, old.journal_entry_id) then
    raise exception 'Disbursed loans can''t be edited; only the installment and start month can change.';
  end if;
  return new;
end $$;

-- Same principle for settlements: only fnf_approve (definer) may set status = approved.
create or replace function private.fnf_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'approved' then
    raise exception 'An approved settlement cannot be changed.';
  end if;
  if new.status = 'approved' and current_user = 'authenticated' then
    raise exception 'Use the approval action to approve a settlement.';
  end if;
  if current_user = 'authenticated' and (new.approved_by, new.approved_at, new.journal_entry_id)
     is distinct from (old.approved_by, old.approved_at, old.journal_entry_id) then
    raise exception 'Approval fields are set by the approval action.';
  end if;
  return new;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_any_role(public.app_role[]), private.is_hr(), private.current_employee_id(), private.can_see_team(uuid),
  private.is_payroll(), private.is_finance(), private.can_read_payroll()
to authenticated;
grant execute on function private.link_auth_user() to supabase_auth_admin;

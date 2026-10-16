-- leave_status columns need an explicit cast from the CASE text result.
create or replace function public.travel_decide(p_req uuid, p_approve boolean, p_comment text, p_bank uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  t    public.travel_requests;
  me   uuid := private.current_employee_id();
  je   uuid;
  bank uuid;
  who  text;
begin
  select * into t from public.travel_requests where id = p_req for update;
  if t.id is null or t.status <> 'pending' then raise exception 'This request isn''t awaiting a decision.'; end if;
  if t.employee_id = me then raise exception 'You can''t approve your own request.' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Give a reason when rejecting.'; end if;
  select full_name into who from public.employees where id = t.employee_id;
  if t.stage = 'manager' then
    if not (private.is_hr() or private.can_see_team(t.employee_id)) then
      raise exception 'Only the line manager, HOD or HR can decide this request.' using errcode = '42501';
    end if;
    if p_approve and t.advance_requested > 0 then
      update public.travel_requests set stage = 'finance', decision_comment = p_comment where id = p_req;
      perform private.notify_roles(array['finance']::public.app_role[], 'Travel advance to approve', who || ' — PKR ' || t.advance_requested, '/expenses/approvals');
    else
      update public.travel_requests set status = (case when p_approve then 'approved' else 'rejected' end)::public.leave_status, stage = 'done',
        decided_by = me, decided_at = now(), decision_comment = p_comment where id = p_req;
    end if;
  else
    if not private.is_finance() then raise exception 'Finance approves travel advances.' using errcode = '42501'; end if;
    if p_approve and t.advance_requested > 0 then
      select gl_account_id into bank from public.bank_accounts where id = p_bank;
      if bank is null then raise exception 'Choose the bank account the advance is paid from.'; end if;
      insert into public.journal_entries (entry_date, description, source, source_id)
      values (current_date, 'Travel advance — ' || who || ' (' || t.destination || ')', 'manual', t.id) returning id into je;
      insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
        (je, private.account_id('1320'), t.advance_requested, 0, 'Travel advance'),
        (je, bank, 0, t.advance_requested, 'Paid to ' || who);
      perform private.post_journal(je);
    end if;
    update public.travel_requests set status = (case when p_approve then 'approved' else 'rejected' end)::public.leave_status, stage = 'done',
      decided_by = me, decided_at = now(), decision_comment = coalesce(p_comment, decision_comment),
      advance_paid = case when p_approve then t.advance_requested else 0 end, advance_entry_id = je
     where id = p_req;
  end if;
  if (select status from public.travel_requests where id = p_req) <> 'pending' then
    perform private.notify_employee(t.employee_id, 'Travel request ' || (select status from public.travel_requests where id = p_req)::text,
      t.destination || coalesce(' — ' || p_comment, ''), '/expenses');
  end if;
  return (select status::text from public.travel_requests where id = p_req);
end $$;


create or replace function public.loan_app_decide(p_app uuid, p_approve boolean, p_comment text, p_start_month date default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  a    public.loan_applications;
  me   uuid := private.current_employee_id();
  ln   uuid;
  who  text;
  start date;
begin
  select * into a from public.loan_applications where id = p_app for update;
  if a.id is null or a.status <> 'pending' then raise exception 'This application isn''t awaiting a decision.'; end if;
  if a.employee_id = me then raise exception 'You can''t approve your own application.' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Give a reason when rejecting.'; end if;
  select full_name into who from public.employees where id = a.employee_id;
  if a.stage = 'manager' then
    if not (private.is_hr() or private.can_see_team(a.employee_id)) then
      raise exception 'Only the line manager, HOD or HR can decide this application.' using errcode = '42501';
    end if;
    if p_approve then
      update public.loan_applications set stage = 'finance', decision_comment = p_comment where id = p_app;
      perform private.notify_roles(array['finance']::public.app_role[], initcap(a.loan_type) || ' to approve', who || ' — PKR ' || a.amount, '/loans/approvals');
      return 'pending';
    end if;
  else
    if not private.is_finance() then raise exception 'Finance approves loans.' using errcode = '42501'; end if;
    if p_approve then
      start := coalesce(date_trunc('month', p_start_month)::date, (date_trunc('month', current_date) + interval '1 month')::date);
      insert into public.loans (employee_id, loan_type, principal, installment_amount, start_month, purpose)
      values (a.employee_id, a.loan_type, a.amount, round(a.amount / a.installments, 2), start, a.purpose)
      returning id into ln;
    end if;
  end if;
  update public.loan_applications set status = (case when p_approve then 'approved' else 'rejected' end)::public.leave_status, stage = 'done',
    decided_by = me, decided_at = now(), decision_comment = coalesce(p_comment, decision_comment), loan_id = ln
   where id = p_app;
  perform private.notify_employee(a.employee_id, initcap(a.loan_type) || case when p_approve then ' approved' else ' rejected' end,
    'PKR ' || a.amount || coalesce(' — ' || p_comment, ''), '/payslips');
  return case when p_approve then 'approved' else 'rejected' end;
end $$;



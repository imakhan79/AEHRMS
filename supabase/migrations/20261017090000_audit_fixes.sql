-- Audit fixes (2026-10-17)
-- 1. Payroll paid "exited" employees who had no exit date. Exclude them.
-- 2. Expense, reimbursement and travel-advance journals were tagged 'manual', so the
--    Journals screen let Finance reverse them and desync the claim. Give them system sources.
-- 3. Index every foreign key (advisor: unindexed_foreign_keys) for joins and cascades.

alter table public.journal_entries drop constraint journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check check (source in (
  'manual', 'payroll', 'payroll_payment', 'loan', 'fnf', 'ap_bill', 'ap_payment', 'ar_invoice', 'ar_receipt',
  'reversal', 'expense', 'expense_payment', 'travel_advance'));

-- Re-tag existing system entries (only the source column; amounts untouched).
alter table public.journal_entries disable trigger journal_entries_guard;
update public.journal_entries j set source = 'expense'
  from public.expense_claims c where j.id = c.journal_entry_id and j.source = 'manual';
update public.journal_entries j set source = 'expense_payment'
  from public.expense_claims c where j.id = c.paid_entry_id and j.source = 'manual';
update public.journal_entries j set source = 'travel_advance'
  from public.travel_requests t where j.id = t.advance_entry_id and j.source = 'manual';
alter table public.journal_entries enable trigger journal_entries_guard;

create or replace function public.payroll_process_run(p_run uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  run  public.payroll_runs;
  e    record;
  m_end date;
begin
  if not private.is_payroll() then
    raise exception 'Only HR or Finance can process payroll.' using errcode = '42501';
  end if;
  select * into run from public.payroll_runs where id = p_run for update;
  if run.id is null then raise exception 'Payroll run not found.'; end if;
  if run.status <> 'draft' then
    raise exception 'Only draft runs can be (re)processed. Return it to draft first.';
  end if;
  m_end := (run.period_month + interval '1 month' - interval '1 day')::date;

  delete from public.payslips where payroll_run_id = p_run;
  for e in
    select id from public.employees
     where deleted_at is null and status <> 'draft'
       and (joining_date is null or joining_date <= m_end)
       and (exit_date is null or exit_date >= run.period_month)
       and (status <> 'exited' or exit_date >= run.period_month)
     order by employee_code
  loop
    perform private.payroll_calc_employee(run, e.id);
  end loop;

  update public.payroll_runs r set
    employee_count = s.n, total_gross = s.gross, total_deductions = s.ded, total_net = s.net,
    total_tax = s.tax, total_employer = s.er, processed_at = now(), processed_by = auth.uid()
  from (
    select count(*)::int n, coalesce(sum(gross_pay), 0) gross, coalesce(sum(total_deductions), 0) ded,
           coalesce(sum(net_pay), 0) net, coalesce(sum(income_tax), 0) tax,
           coalesce(sum(eobi_employer + pessi_employer + pf_employer + vps_employer), 0) er
      from public.payslips where payroll_run_id = p_run
  ) s
  where r.id = p_run;
  return (select employee_count from public.payroll_runs where id = p_run);
end $$;

create or replace function public.exp_decide(p_claim uuid, p_approve boolean, p_comment text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c   public.expense_claims;
  me  uuid := private.current_employee_id();
  je  uuid;
  emp public.employees;
  dept_cc uuid;
begin
  select * into c from public.expense_claims where id = p_claim for update;
  if c.id is null or c.status <> 'submitted' then raise exception 'This claim isn''t awaiting a decision.'; end if;
  if c.employee_id = me then raise exception 'You can''t approve your own claim.' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Give a reason when rejecting.'; end if;
  select * into emp from public.employees where id = c.employee_id;

  if c.stage = 'manager' then
    if not (private.is_hr() or private.can_see_team(c.employee_id)) then
      raise exception 'Only the line manager, HOD or HR can decide this claim.' using errcode = '42501';
    end if;
    update public.expense_claims set manager_decided_by = me, manager_decided_at = now(), decision_comment = p_comment,
      status = case when p_approve then 'submitted' else 'rejected' end,
      stage = case when p_approve then 'finance' else 'done' end
     where id = p_claim;
    if p_approve then
      perform private.notify_roles(array['finance']::public.app_role[], 'Expense claim to verify', c.claim_no || ' — ' || emp.full_name, '/expenses/approvals');
    end if;
  elsif c.stage = 'finance' then
    if not private.is_finance() then raise exception 'Finance verifies claims at this stage.' using errcode = '42501'; end if;
    if p_approve then
      select cost_center_id into dept_cc from public.departments where id = emp.department_id;
      insert into public.journal_entries (entry_date, description, source, source_id)
      values (current_date, 'Expense claim ' || c.claim_no || ' — ' || emp.full_name, 'expense', c.id)
      returning id into je;
      insert into public.journal_entry_lines (journal_entry_id, account_id, cost_center_id, debit, description)
      select je, k.account_id, dept_cc, sum(i.amount), k.name
        from public.expense_items i join public.expense_categories k on k.id = i.category_id
       where i.claim_id = p_claim group by k.account_id, k.name;
      if c.advance_adjusted > 0 then
        insert into public.journal_entry_lines (journal_entry_id, account_id, credit, description)
        values (je, private.account_id('1320'), c.advance_adjusted, 'Travel advance adjusted');
        update public.travel_requests set advance_settled = advance_settled + c.advance_adjusted where id = c.travel_request_id;
      end if;
      if c.net_payable > 0 then
        insert into public.journal_entry_lines (journal_entry_id, account_id, credit, description)
        values (je, private.account_id('2310'), c.net_payable, 'Reimbursable to ' || emp.full_name);
      end if;
      perform private.post_journal(je);
    end if;
    update public.expense_claims set finance_decided_by = me, finance_decided_at = now(),
      decision_comment = coalesce(p_comment, decision_comment),
      status = case when p_approve then (case when c.net_payable <= 0 then 'paid' else 'approved' end) else 'rejected' end,
      stage = 'done', journal_entry_id = je
     where id = p_claim;
  else
    raise exception 'This claim has already been decided.';
  end if;
  perform private.notify_employee(c.employee_id,
    'Expense claim ' || case when not p_approve then 'rejected' when c.stage = 'manager' then 'approved by manager' else 'approved' end,
    c.claim_no || coalesce(' — ' || p_comment, ''), '/expenses');
  return (select status from public.expense_claims where id = p_claim);
end $$;

create or replace function public.exp_pay(p_claim uuid, p_bank uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c    public.expense_claims;
  je   uuid;
  bank uuid;
begin
  perform private.require_finance();
  select * into c from public.expense_claims where id = p_claim for update;
  if c.id is null or c.status <> 'approved' then raise exception 'Only approved, unpaid claims can be paid.'; end if;
  select gl_account_id into bank from public.bank_accounts where id = p_bank;
  if bank is null then raise exception 'Choose a bank account.'; end if;
  insert into public.journal_entries (entry_date, description, source, source_id)
  values (current_date, 'Reimbursement ' || c.claim_no, 'expense_payment', c.id) returning id into je;
  insert into public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) values
    (je, private.account_id('2310'), c.net_payable, 0, 'Reimbursement payable cleared'),
    (je, bank, 0, c.net_payable, 'Paid to employee');
  perform private.post_journal(je);
  update public.expense_claims set status = 'paid', paid_entry_id = je, paid_at = now() where id = p_claim;
  perform private.notify_employee(c.employee_id, 'Expense reimbursed', c.claim_no || ' — PKR ' || c.net_payable, '/expenses');
end $$;

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
      values (current_date, 'Travel advance — ' || who || ' (' || t.destination || ')', 'travel_advance', t.id) returning id into je;
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

do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col, c.conrelid::regclass::text as tname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
       and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
  loop
    execute format('create index if not exists %I on %s (%I)', left(replace(r.tname, 'public.', '') || '_' || r.col || '_fk_idx', 63), r.tbl, r.col);
  end loop;
end $$;

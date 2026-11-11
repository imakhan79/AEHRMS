-- =====================================================================
-- Expenses: receipts are optional for every category, and employees can
-- edit the line items of their own draft claims (title edits were
-- already allowed by "claims: edit own draft").
-- =====================================================================

-- exp_submit only blocks items whose category requires a receipt.
update public.expense_categories set requires_receipt = false where requires_receipt;
alter table public.expense_categories alter column requires_receipt set default false;

-- expense_item_guard (before update) already limits changes to draft claims,
-- checks per-item limits and future dates, and keeps receipts in the owner's folder.
create policy "expense_items: own draft update" on public.expense_items for update to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id and c.employee_id = (select private.current_employee_id()) and c.status = 'draft'))
  with check (exists (select 1 from public.expense_claims c where c.id = claim_id and c.employee_id = (select private.current_employee_id()) and c.status = 'draft'));
grant update (category_id, expense_date, description, amount, receipt_path) on public.expense_items to authenticated;

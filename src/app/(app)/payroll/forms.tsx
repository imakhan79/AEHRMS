"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import {
  addComponent,
  addLoan,
  addStatutoryRates,
  addStructure,
  addTaxSlab,
  approveSettlement,
  createRun,
  processRun,
  saveSalary,
  saveSettlement,
  setStructureLine,
  transitionRun,
} from "./actions";

type Option = { id: string; label: string };

export function CreateRunForm({ defaultMonth }: { defaultMonth: string }) {
  return (
    <ActionForm action={createRun} className="space-y-3">
      <Field label="Payroll month" name="month">
        <Input id="month" name="month" type="month" required defaultValue={defaultMonth} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="parallel" className="rounded border-gray-300" />
        Parallel run (validation against legacy payroll — never posted)
      </label>
      <SubmitButton>Create & calculate</SubmitButton>
    </ActionForm>
  );
}

export function ProcessButton({ runId }: { runId: string }) {
  return (
    <ActionForm action={processRun.bind(null, runId)}>
      <SubmitButton variant="secondary">Recalculate</SubmitButton>
    </ActionForm>
  );
}

/** One form per allowed transition; the database enforces who may do what. */
export function TransitionForm({
  runId,
  to,
  label,
  variant = "primary",
  withNote = false,
}: {
  runId: string;
  to: string;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "success";
  withNote?: boolean;
}) {
  return (
    <ActionForm action={transitionRun.bind(null, runId)} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="to" value={to} />
      {withNote && <Input name="note" placeholder="Note (optional)" className="w-56 py-1.5 text-xs" maxLength={500} />}
      <SubmitButton variant={variant}>{label}</SubmitButton>
    </ActionForm>
  );
}

export interface SalaryDefaults {
  structure_id: string | null;
  basic_salary: number;
  overtime_eligible: boolean;
  eobi_covered: boolean;
  pessi_covered: boolean;
  pf_member: boolean;
  pf_pct: number;
  vps_employee_pct: number;
  vps_employer_pct: number;
  payment_mode: string;
  extras: Record<string, number>;
}

export function SalaryForm({
  employeeId,
  structures,
  components,
  current,
}: {
  employeeId: string;
  structures: Option[];
  components: Option[];
  current: SalaryDefaults | null;
}) {
  const cur = current;
  const check = (name: keyof SalaryDefaults, label: string, def: boolean) => (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" name={name} defaultChecked={cur ? Boolean(cur[name]) : def} className="rounded border-gray-300" />
      {label}
    </label>
  );
  return (
    <ActionForm action={saveSalary.bind(null, employeeId)} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Effective from" name="sal_from">
          <Input id="sal_from" name="effective_from" type="date" required defaultValue={new Date().toISOString().slice(0, 8) + "01"} />
        </Field>
        <Field label="Basic salary (PKR / month)" name="sal_basic">
          <Input id="sal_basic" name="basic_salary" type="number" min={0} step="1" required defaultValue={cur?.basic_salary ?? ""} />
        </Field>
        <Field label="Structure" name="sal_struct" hint="Allowances as % of basic.">
          <Select id="sal_struct" name="structure_id" defaultValue={cur?.structure_id ?? structures[0]?.id ?? ""}>
            <option value="">— Basic only —</option>
            {structures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Payment" name="sal_pay">
          <Select id="sal_pay" name="payment_mode" defaultValue={cur?.payment_mode ?? "bank"}>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
          </Select>
        </Field>
        <Field label="PF % of basic" name="sal_pf">
          <Input id="sal_pf" name="pf_pct" type="number" min={0} max={20} step="0.01" defaultValue={cur?.pf_pct ?? 8.33} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="VPS employee %" name="sal_vpse">
            <Input id="sal_vpse" name="vps_employee_pct" type="number" min={0} max={50} step="0.01" defaultValue={cur?.vps_employee_pct ?? 0} />
          </Field>
          <Field label="VPS employer %" name="sal_vpsr">
            <Input id="sal_vpsr" name="vps_employer_pct" type="number" min={0} max={50} step="0.01" defaultValue={cur?.vps_employer_pct ?? 0} />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {check("eobi_covered", "EOBI", true)}
        {check("pessi_covered", "PESSI", false)}
        {check("pf_member", "Provident fund member", false)}
        {check("overtime_eligible", "Overtime eligible", true)}
      </div>
      <details className="rounded-lg border border-gray-200 p-3">
        <summary className="cursor-pointer text-xs font-medium text-gray-700">Fixed allowances / deductions for this employee</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {components.map((c) => (
            <Field key={c.id} label={`${c.label} (PKR)`} name={`extra_${c.id}`}>
              <Input id={`extra_${c.id}`} name={`extra_${c.id}`} type="number" min={0} step="1" defaultValue={cur?.extras[c.id] ?? ""} />
            </Field>
          ))}
        </div>
      </details>
      <Field label="Notes" name="sal_notes">
        <Input id="sal_notes" name="notes" maxLength={300} placeholder="e.g. Annual increment 2026" />
      </Field>
      <SubmitButton size="sm">Save salary</SubmitButton>
    </ActionForm>
  );
}

export function LoanForm({ employeeId }: { employeeId: string }) {
  const next = new Date();
  next.setMonth(next.getMonth() + 1);
  return (
    <ActionForm action={addLoan.bind(null, employeeId)} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" name="ln_type">
          <Select id="ln_type" name="loan_type" defaultValue="loan">
            <option value="loan">Loan</option>
            <option value="advance">Salary advance</option>
          </Select>
        </Field>
        <Field label="Amount (PKR)" name="ln_amt">
          <Input id="ln_amt" name="principal" type="number" min={1} step="1" required />
        </Field>
        <Field label="Monthly installment" name="ln_inst">
          <Input id="ln_inst" name="installment_amount" type="number" min={1} step="1" required />
        </Field>
        <Field label="First deduction month" name="ln_start">
          <Input id="ln_start" name="start_month" type="month" required defaultValue={next.toISOString().slice(0, 7)} />
        </Field>
        <Field label="Purpose" name="ln_purpose" className="sm:col-span-2">
          <Input id="ln_purpose" name="purpose" maxLength={200} />
        </Field>
      </div>
      <SubmitButton size="sm">Record & disburse</SubmitButton>
    </ActionForm>
  );
}

export function ComponentForm() {
  return (
    <ActionForm action={addComponent} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" name="cp_code">
          <Input id="cp_code" name="code" required placeholder="e.g. SHIFT" />
        </Field>
        <Field label="Name" name="cp_name">
          <Input id="cp_name" name="name" required placeholder="e.g. Shift Allowance" />
        </Field>
        <Field label="Type" name="cp_kind">
          <Select id="cp_kind" name="kind" defaultValue="earning">
            <option value="earning">Earning</option>
            <option value="deduction">Deduction</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 pt-5 text-sm text-gray-700">
          <input type="checkbox" name="is_taxable" defaultChecked className="rounded border-gray-300" /> Taxable
        </label>
      </div>
      <SubmitButton size="sm">Add component</SubmitButton>
    </ActionForm>
  );
}

export function StructureForm() {
  return (
    <ActionForm action={addStructure} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <Field label="Code" name="st_code">
        <Input id="st_code" name="code" required className="w-28" />
      </Field>
      <Field label="Name" name="st_name">
        <Input id="st_name" name="name" required className="w-64" />
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Add structure
      </SubmitButton>
    </ActionForm>
  );
}

export function StructureLineForm({ structures, components }: { structures: Option[]; components: Option[] }) {
  return (
    <ActionForm action={setStructureLine} className="grid gap-3 sm:grid-cols-5 sm:items-end">
      <Field label="Structure" name="sl_struct">
        <Select id="sl_struct" name="structure_id" required defaultValue={structures[0]?.id}>
          {structures.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Component" name="sl_comp">
        <Select id="sl_comp" name="component_id" required defaultValue="">
          <option value="" disabled>
            Select…
          </option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Calculation" name="sl_calc">
        <Select id="sl_calc" name="calc_type" defaultValue="percent_of_basic">
          <option value="percent_of_basic">% of basic</option>
          <option value="fixed">Fixed PKR</option>
        </Select>
      </Field>
      <Field label="Value (0 removes)" name="sl_val">
        <Input id="sl_val" name="value" type="number" min={0} step="0.01" required />
      </Field>
      <SubmitButton size="sm">Save line</SubmitButton>
    </ActionForm>
  );
}

export function StatutoryForm() {
  return (
    <ActionForm action={addStatutoryRates} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Effective from" name="sr_from">
          <Input id="sr_from" name="effective_from" type="date" required />
        </Field>
        <Field label="EOBI wage base" name="sr_eobi">
          <Input id="sr_eobi" name="eobi_wage_base" type="number" min={0} required defaultValue={40000} />
        </Field>
        <Field label="EOBI employee %" name="sr_eobie">
          <Input id="sr_eobie" name="eobi_employee_pct" type="number" min={0} step="0.01" defaultValue={1} />
        </Field>
        <Field label="EOBI employer %" name="sr_eobir">
          <Input id="sr_eobir" name="eobi_employer_pct" type="number" min={0} step="0.01" defaultValue={5} />
        </Field>
        <Field label="PESSI wage base" name="sr_pessi">
          <Input id="sr_pessi" name="pessi_wage_base" type="number" min={0} required defaultValue={40000} />
        </Field>
        <Field label="PESSI employer %" name="sr_pessir">
          <Input id="sr_pessir" name="pessi_employer_pct" type="number" min={0} step="0.01" defaultValue={6} />
        </Field>
        <Field label="Overtime multiplier" name="sr_otm">
          <Input id="sr_otm" name="ot_multiplier" type="number" min={0} step="0.1" defaultValue={2} />
        </Field>
        <Field label="Monthly hours (OT rate)" name="sr_oth">
          <Input id="sr_oth" name="ot_basis_hours" type="number" min={1} defaultValue={208} />
        </Field>
      </div>
      <Field label="Source / notes" name="sr_notes">
        <Input id="sr_notes" name="notes" maxLength={300} placeholder="e.g. Punjab minimum wage notification dated …" />
      </Field>
      <SubmitButton size="sm">Save rates</SubmitButton>
    </ActionForm>
  );
}

export function TaxSlabForm({ defaultYear }: { defaultYear: number }) {
  return (
    <ActionForm action={addTaxSlab} resetOnSuccess className="grid gap-3 sm:grid-cols-6 sm:items-end">
      <Field label="Tax year" name="ts_year">
        <Input id="ts_year" name="tax_year" type="number" required defaultValue={defaultYear} />
      </Field>
      <Field label="Above (PKR)" name="ts_low">
        <Input id="ts_low" name="lower_limit" type="number" min={0} required />
      </Field>
      <Field label="Up to (blank = no limit)" name="ts_up">
        <Input id="ts_up" name="upper_limit" type="number" min={0} />
      </Field>
      <Field label="Fixed tax" name="ts_fix">
        <Input id="ts_fix" name="fixed_tax" type="number" min={0} defaultValue={0} />
      </Field>
      <Field label="Rate % on excess" name="ts_rate">
        <Input id="ts_rate" name="rate_pct" type="number" min={0} max={100} step="0.01" required />
      </Field>
      <SubmitButton size="sm">Save slab</SubmitButton>
    </ActionForm>
  );
}

export interface SettlementValues {
  exit_date: string;
  basic_salary: number;
  leave_days_encashed: number;
  leave_encashment: number;
  gratuity: number;
  other_additions: number;
  loan_recovery: number;
  other_deductions: number;
  notes: string | null;
}

export function SettlementForm({ employeeId, values, locked }: { employeeId: string; values: SettlementValues; locked: boolean }) {
  const num = (name: keyof SettlementValues, label: string, hint?: string) => (
    <Field label={label} name={`fnf_${name}`} hint={hint}>
      <Input id={`fnf_${name}`} name={name} type="number" min={0} step="1" defaultValue={Number(values[name] ?? 0)} disabled={locked} />
    </Field>
  );
  return (
    <ActionForm action={saveSettlement.bind(null, employeeId)} className="space-y-4">
      <input type="hidden" name="exit_date" value={values.exit_date} />
      <div className="grid gap-3 sm:grid-cols-3">
        {num("basic_salary", "Last basic salary")}
        {num("leave_days_encashed", "Annual leave days encashed")}
        {num("leave_encashment", "Leave encashment", "Suggested: days × basic / 30")}
        {num("gratuity", "Gratuity", "If the company scheme applies")}
        {num("other_additions", "Other dues payable")}
        {num("loan_recovery", "Loan / advance recovery")}
        {num("other_deductions", "Other recoveries", "e.g. unreturned assets, notice shortfall")}
      </div>
      <Field label="Notes" name="fnf_notes">
        <Textarea id="fnf_notes" name="notes" defaultValue={values.notes ?? ""} disabled={locked} maxLength={500} />
      </Field>
      {!locked && <SubmitButton size="sm">Save draft</SubmitButton>}
    </ActionForm>
  );
}

export function ApproveSettlementButton({ id }: { id: string }) {
  return (
    <ActionForm action={approveSettlement.bind(null, id)}>
      <SubmitButton variant="success">Approve & post to ledger</SubmitButton>
    </ActionForm>
  );
}

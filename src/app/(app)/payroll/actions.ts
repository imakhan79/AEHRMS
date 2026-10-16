"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull, friendlyError } from "@/lib/format";
import type { ActionState } from "@/lib/types";

function refresh() {
  revalidatePath("/payroll", "layout");
  revalidatePath("/payslips");
  revalidatePath("/employees/[id]", "page");
}

// ---------- Runs (PAY-05) ----------

export async function createRun(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isPayroll) return { error: "Only HR or Finance can create payroll runs." };
  const parsed = z
    .object({ month: z.string().regex(/^\d{4}-\d{2}$/, "Choose a month."), parallel: z.literal("on").optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_create_run", {
    p_month: `${parsed.data.month}-01`,
    p_parallel: parsed.data.parallel === "on",
  });
  if (error) return { error: friendlyError(error) };
  const { error: pErr } = await supabase.rpc("payroll_process_run", { p_run: data });
  if (pErr) return { error: friendlyError(pErr) };
  refresh();
  redirect(`/payroll/runs/${data}`);
}

export async function processRun(runId: string, _: ActionState): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_process_run", { p_run: runId });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: `Recalculated ${data} payslip(s) from current salaries, attendance, leave and loans.` };
}

const TRANSITION_MESSAGES: Record<string, string> = {
  review: "Submitted for Finance review.",
  draft: "Returned to draft for corrections.",
  approved: "Approved. Employees can now see their payslips.",
  posted: "Posted to the general ledger.",
  paid: "Marked as paid — disbursement journal posted.",
};

export async function transitionRun(runId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const to = String(formData.get("to") ?? "");
  if (!["review", "draft", "approved", "posted", "paid"].includes(to)) return { error: "Invalid action." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("payroll_transition", { p_run: runId, p_to: to, p_note: note });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: TRANSITION_MESSAGES[to] };
}

// ---------- Employee salary (PAY-01) ----------

const pct = z.coerce.number().min(0).max(50);

export async function saveSalary(employeeId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isPayroll) return { error: "Only HR or Finance can set salaries." };
  const parsed = z
    .object({
      effective_from: z.iso.date("Choose the effective date."),
      structure_id: z.union([z.uuid(), z.literal("")]).optional(),
      basic_salary: z.coerce.number().min(0, "Basic salary can't be negative.").max(100000000),
      payment_mode: z.enum(["bank", "cash", "cheque"]),
      pf_pct: z.coerce.number().min(0).max(20),
      vps_employee_pct: pct,
      vps_employer_pct: pct,
      notes: z.string().trim().max(300).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const flag = (k: string) => formData.get(k) === "on";

  const supabase = await createClient();
  const { data: sal, error } = await supabase
    .from("employee_salaries")
    .upsert(
      emptyToNull({
        employee_id: employeeId,
        ...parsed.data,
        overtime_eligible: flag("overtime_eligible"),
        eobi_covered: flag("eobi_covered"),
        pessi_covered: flag("pessi_covered"),
        pf_member: flag("pf_member"),
      }),
      { onConflict: "employee_id,effective_from" },
    )
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };

  // Fixed per-employee allowances (component id → amount); 0 / empty removes it.
  const overrides = [...formData.entries()]
    .filter(([k]) => k.startsWith("extra_"))
    .map(([k, v]) => ({ component_id: k.slice(6), value: Number(v) || 0 }));
  if (overrides.length) {
    await supabase.from("employee_salary_components").delete().eq("employee_salary_id", sal.id);
    const rows = overrides.filter((o) => o.value > 0).map((o) => ({ employee_salary_id: sal.id, calc_type: "fixed", ...o }));
    if (rows.length) {
      const { error: oErr } = await supabase.from("employee_salary_components").insert(rows);
      if (oErr) return { error: friendlyError(oErr) };
    }
  }
  refresh();
  return { ok: true, message: "Salary saved. It applies to payroll runs from the effective month." };
}

export async function addLoan(employeeId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isPayroll) return { error: "Only HR or Finance can record loans." };
  const parsed = z
    .object({
      loan_type: z.enum(["loan", "advance"]),
      principal: z.coerce.number().positive("Enter the amount."),
      installment_amount: z.coerce.number().positive("Enter the monthly installment."),
      start_month: z.string().regex(/^\d{4}-\d{2}$/, "Choose the first deduction month."),
      purpose: z.string().trim().max(200).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.installment_amount > parsed.data.principal) return { error: "Installment can't exceed the amount." };
  const supabase = await createClient();
  const { error } = await supabase.from("loans").insert(
    emptyToNull({ employee_id: employeeId, ...parsed.data, start_month: `${parsed.data.start_month}-01` }),
  );
  if (error) return { error: friendlyError(error) };
  refresh();
  revalidatePath("/finance/ledger");
  return { ok: true, message: "Recorded and disbursement posted to the ledger. Installments deduct automatically." };
}

// ---------- Setup ----------

export async function addComponent(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isPayroll) return { error: "Only HR or Finance can change payroll setup." };
  const parsed = z
    .object({
      code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_]+$/, "Code: letters, numbers and _ only.").transform((s) => s.toUpperCase()),
      name: z.string().trim().min(2).max(80),
      kind: z.enum(["earning", "deduction"]),
      is_taxable: z.literal("on").optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("salary_components")
    .insert({ ...parsed.data, is_taxable: parsed.data.kind === "earning" && parsed.data.is_taxable === "on" });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: "Component added." };
}

export async function setStructureLine(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isPayroll) return { error: "Only HR or Finance can change payroll setup." };
  const parsed = z
    .object({
      structure_id: z.uuid("Choose a structure."),
      component_id: z.uuid("Choose a component."),
      calc_type: z.enum(["fixed", "percent_of_basic"]),
      value: z.coerce.number().min(0),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } =
    parsed.data.value === 0
      ? await supabase.from("salary_structure_components").delete().match({ structure_id: parsed.data.structure_id, component_id: parsed.data.component_id })
      : await supabase.from("salary_structure_components").upsert(parsed.data, { onConflict: "structure_id,component_id" });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: parsed.data.value === 0 ? "Line removed." : "Structure updated." };
}

export async function addStructure(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isPayroll) return { error: "Only HR or Finance can change payroll setup." };
  const parsed = z
    .object({
      code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/).transform((s) => s.toUpperCase()),
      name: z.string().trim().min(2).max(120),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a code (letters/numbers) and a name." };
  const supabase = await createClient();
  const { error } = await supabase.from("salary_structures").insert(parsed.data);
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: "Structure added — now add its lines." };
}

export async function addStatutoryRates(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isPayroll) return { error: "Only HR or Finance can change statutory rates." };
  const num = z.coerce.number().min(0);
  const parsed = z
    .object({
      effective_from: z.iso.date("Choose the effective date."),
      eobi_wage_base: num,
      eobi_employee_pct: num,
      eobi_employer_pct: num,
      pessi_wage_base: num,
      pessi_employer_pct: num,
      ot_multiplier: num,
      ot_basis_hours: z.coerce.number().positive(),
      notes: z.string().trim().max(300).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("statutory_rates").upsert(emptyToNull(parsed.data), { onConflict: "effective_from" });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: "Statutory rates saved. They apply to runs from that date (reprocess drafts)." };
}

export async function addTaxSlab(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isPayroll) return { error: "Only HR or Finance can change tax slabs." };
  const parsed = z
    .object({
      tax_year: z.coerce.number().int().min(2020).max(2100),
      lower_limit: z.coerce.number().min(0),
      upper_limit: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
      fixed_tax: z.coerce.number().min(0),
      rate_pct: z.coerce.number().min(0).max(100),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("tax_slabs").upsert(emptyToNull(parsed.data), { onConflict: "tax_year,lower_limit" });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: "Slab saved." };
}

// ---------- Full & Final (PAY-09) ----------

export async function saveSettlement(employeeId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isPayroll) return { error: "Only HR or Finance can prepare settlements." };
  const num = z.coerce.number().min(0);
  const parsed = z
    .object({
      exit_date: z.iso.date(),
      basic_salary: num,
      leave_days_encashed: num,
      leave_encashment: num,
      gratuity: num,
      other_additions: num,
      loan_recovery: num,
      other_deductions: num,
      notes: z.string().trim().max(500).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("fnf_settlements")
    .upsert(emptyToNull({ employee_id: employeeId, ...parsed.data }), { onConflict: "employee_id" });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: "Settlement saved as draft — Finance approves it." };
}

export async function approveSettlement(id: string, _: ActionState): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("fnf_approve", { p_id: id });
  if (error) return { error: friendlyError(error) };
  refresh();
  revalidatePath("/finance/ledger");
  return { ok: true, message: "Settlement approved and posted to the ledger." };
}

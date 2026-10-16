"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull, friendlyError } from "@/lib/format";
import type { ActionState } from "@/lib/types";

const err = (e: { message: string; code?: string } | null): ActionState => ({ error: friendlyError(e) });

// ---------- Assets ----------

export async function addAsset(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = z
    .object({
      asset_tag: z.string().trim().min(2).max(40).transform((s) => s.toUpperCase()),
      name: z.string().trim().min(2).max(120),
      category: z.enum(["laptop", "desktop", "phone", "tablet", "vehicle", "furniture", "equipment", "other"]),
      serial_number: z.string().trim().max(80).optional(),
      location_id: z.union([z.uuid(), z.literal("")]).optional(),
      purchase_date: z.union([z.iso.date(), z.literal("")]).optional(),
      purchase_cost: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
      condition: z.enum(["new", "good", "fair", "poor", "damaged"]),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("assets").insert(emptyToNull(p.data));
  if (error) return err(error);
  revalidatePath("/assets");
  return { ok: true, message: "Asset added to the register." };
}

export async function issueAsset(assetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const emp = String(fd.get("employee_id") ?? "");
  if (!emp) return { error: "Choose an employee." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("asset_issue", { p_asset: assetId, p_employee: emp, p_notes: String(fd.get("notes") ?? "") || null });
  if (error) return err(error);
  revalidatePath("/assets");
  return { ok: true, message: "Issued — the employee has been asked to acknowledge." };
}

export async function returnAsset(assetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const cond = String(fd.get("condition") ?? "good");
  const supabase = await createClient();
  const { error } = await supabase.rpc("asset_return", { p_asset: assetId, p_condition: cond, p_notes: String(fd.get("notes") ?? "") || null });
  if (error) return err(error);
  revalidatePath("/assets");
  revalidatePath("/exit", "layout");
  return { ok: true, message: "Return recorded." };
}

export async function transferAsset(assetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const to = String(fd.get("employee_id") ?? "");
  if (!to) return { error: "Choose the new holder." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("asset_transfer", { p_asset: assetId, p_to: to, p_notes: null });
  if (error) return err(error);
  revalidatePath("/assets");
  return { ok: true, message: "Transferred." };
}

export async function acknowledgeAsset(assignmentId: string) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("asset_acknowledge", { p_assignment: assignmentId });
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/assets");
}

export async function setAssetStatus(assetId: string, status: "available" | "retired") {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("assets").update({ status }).eq("id", assetId).in("status", ["maintenance", "available"]);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/assets");
}

// ---------- Benefits ----------

export async function addPlan(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const p = z
    .object({
      code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/).transform((s) => s.toUpperCase()),
      name: z.string().trim().min(2).max(120),
      plan_type: z.enum(["health", "life", "retirement", "transport", "meal", "other"]),
      provider: z.string().trim().max(120).optional(),
      employee_contribution: z.coerce.number().min(0),
      employer_contribution: z.coerce.number().min(0),
      max_dependents: z.coerce.number().int().min(0).max(20),
      min_tenure_months: z.coerce.number().int().min(0).max(120),
      eligible_grades: z.string().trim().max(200).optional(),
      description: z.string().trim().max(500).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const grades = (p.data.eligible_grades ?? "").split(",").map((g) => g.trim()).filter(Boolean);
  const supabase = await createClient();
  const { error } = await supabase.from("benefit_plans").insert(
    emptyToNull({ ...p.data, eligible_grades: grades.length ? grades : null, covers_dependents: p.data.max_dependents > 0 }),
  );
  if (error) return err(error);
  revalidatePath("/benefits");
  return { ok: true, message: "Plan added." };
}

export async function enroll(planId: string, employeeId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireSession();
  const emp = employeeId || String(fd.get("employee_id") ?? "") || session.employee?.id;
  if (!emp) return { error: "Choose an employee." };
  const deps = fd.getAll("dependent_ids").map(String).filter(Boolean);
  const supabase = await createClient();
  const { error } = await supabase.from("benefit_enrollments").insert({ plan_id: planId, employee_id: emp, dependent_ids: deps });
  if (error) return err(error);
  revalidatePath("/benefits");
  return { ok: true, message: "Enrolled. The contribution is deducted from payroll from this month." };
}

export async function cancelEnrollment(id: string) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("benefit_enrollments").update({ status: "cancelled" }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/benefits");
}

// ---------- Exit ----------

export async function submitSeparation(_: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireSession();
  const p = z
    .object({
      employee_id: z.union([z.uuid(), z.literal("")]).optional(),
      separation_type: z.enum(["resignation", "termination", "retirement", "contract_end", "other"]),
      last_working_day: z.iso.date("Choose the last working day."),
      reason: z.string().trim().min(3, "Give a reason.").max(1000),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const emp = p.data.employee_id || session.employee?.id;
  if (!emp) return { error: "Choose an employee." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exit_submit", {
    p_employee: emp,
    p_type: p.data.separation_type,
    p_last_day: p.data.last_working_day,
    p_reason: p.data.reason,
  });
  if (error) return err(error);
  revalidatePath("/exit", "layout");
  redirect(`/exit/${data}`);
}

export async function decideSeparation(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("exit_decide", {
    p_sep: id,
    p_approve: fd.get("decision") === "approve",
    p_comment: String(fd.get("comment") ?? "").trim() || null,
  });
  if (error) return err(error);
  revalidatePath("/exit", "layout");
  return { ok: true, message: "Decision recorded." };
}

export async function clearItem(itemId: string, sepId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("exit_clear", { p_item: itemId, p_notes: String(fd.get("notes") ?? "").trim() || null });
  if (error) return err(error);
  revalidatePath(`/exit/${sepId}`);
  return { ok: true };
}

export async function completeExit(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("exit_complete", { p_sep: id, p_interview: String(fd.get("exit_interview") ?? "").trim() || null });
  if (error) return err(error);
  revalidatePath("/exit", "layout");
  return { ok: true, message: "Exit completed. Prepare the full & final settlement next." };
}

export async function withdrawSeparation(id: string) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("exit_withdraw", { p_sep: id });
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/exit", "layout");
}

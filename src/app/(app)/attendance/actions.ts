"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull, friendlyError } from "@/lib/format";
import type { ActionState } from "@/lib/types";

const time = z.string().regex(/^\d{2}:\d{2}$/, "Enter a time like 09:00.");
/** Local Pakistan wall-clock date + time → ISO timestamp. */
const pkTs = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:00`).toISOString();

function refresh() {
  revalidatePath("/attendance", "layout");
  revalidatePath("/dashboard");
}

// ---------- Regularization (7.3) ----------

export async function requestRegularization(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.employee) return { error: "Your account isn't linked to an employee record." };
  const parsed = z
    .object({
      work_date: z.iso.date("Choose the date."),
      in_time: time,
      out_time: time,
      reason: z.string().trim().min(5, "Explain what happened (at least 5 characters).").max(500),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { work_date, in_time, out_time, reason } = parsed.data;
  // An out-time earlier than the in-time means the shift ended after midnight.
  const outDate = out_time <= in_time ? new Date(new Date(`${work_date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10) : work_date;

  const supabase = await createClient();
  const { error } = await supabase.from("attendance_regularizations").insert({
    employee_id: session.employee.id,
    work_date,
    requested_in: pkTs(work_date, in_time),
    requested_out: pkTs(outDate, out_time),
    reason,
  });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: "Correction requested — awaiting approval." };
}

export async function cancelRegularization(id: string) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("attendance_regularizations").update({ status: "cancelled" }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  refresh();
}

export async function decideRegularization(id: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const decision = formData.get("decision");
  if (decision !== "approved" && decision !== "rejected") return { error: "Choose approve or reject." };
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 500);
  if (decision === "rejected" && !comment) return { error: "Give a reason when rejecting." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_regularizations")
    .update({ status: decision, decision_comment: comment || null })
    .eq("id", id)
    .select("status")
    .maybeSingle();
  if (error) return { error: friendlyError(error) };
  if (!data) return { error: "You can't decide this request." };
  refresh();
  return { ok: true, message: `Correction ${data.status}.` };
}

// ---------- Field verification (7.4) ----------

export async function verifyPunch(id: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const decision = formData.get("decision");
  if (decision !== "verified" && decision !== "rejected") return { error: "Choose verify or reject." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  if (decision === "rejected" && !note) return { error: "Give a reason when rejecting." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_punches")
    .update({ verification: decision, verification_note: note || null })
    .eq("id", id)
    .select("verification")
    .maybeSingle();
  if (error) return { error: friendlyError(error) };
  if (!data) return { error: "You can't verify this punch." };
  refresh();
  return { ok: true, message: `Punch ${data.verification}.` };
}

// ---------- HR setup ----------

async function hrOnly() {
  const session = await requireSession();
  if (!session.isHR) throw new Error("Only HR can change attendance setup.");
  return session;
}

export async function addShift(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await hrOnly();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = z
    .object({
      code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, "Code: letters, numbers, - and _ only.").transform((s) => s.toUpperCase()),
      name: z.string().trim().min(2, "Name is required.").max(80),
      shift_type: z.enum(["fixed", "flexible"]),
      start_time: time,
      end_time: time,
      grace_minutes: z.coerce.number().int().min(0).max(240),
      full_day_minutes: z.coerce.number().int().min(60).max(1440),
      half_day_minutes: z.coerce.number().int().min(30).max(1440),
      overtime_enabled: z.literal("on").optional(),
      overtime_after_minutes: z.coerce.number().int().min(0).max(600),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const offDays = formData.getAll("weekly_off_days").map(Number).filter((d) => d >= 1 && d <= 7);
  if (parsed.data.half_day_minutes > parsed.data.full_day_minutes) {
    return { error: "Half-day minutes can't exceed full-day minutes." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("shifts")
    .insert({ ...parsed.data, overtime_enabled: parsed.data.overtime_enabled === "on", weekly_off_days: offDays });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: "Shift added." };
}

export async function setDefaultShift(id: string) {
  await hrOnly();
  const supabase = await createClient();
  await supabase.from("shifts").update({ is_default: false }).eq("is_default", true);
  const { error } = await supabase.from("shifts").update({ is_default: true }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  refresh();
}

/** Assigns a shift to one employee or a whole department from a date (rotations = successive assignments). */
export async function assignShift(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await hrOnly();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = z
    .object({
      shift_id: z.uuid("Choose a shift."),
      effective_from: z.iso.date("Choose a start date."),
      effective_to: z.union([z.iso.date(), z.literal("")]).optional(),
      employee_id: z.union([z.uuid(), z.literal("")]).optional(),
      department_id: z.union([z.uuid(), z.literal("")]).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { shift_id, effective_from, effective_to, employee_id, department_id } = parsed.data;
  if (!employee_id && !department_id) return { error: "Choose an employee or a department." };

  const supabase = await createClient();
  let ids: string[] = employee_id ? [employee_id] : [];
  if (!employee_id && department_id) {
    const { data } = await supabase
      .from("employees")
      .select("id")
      .eq("department_id", department_id)
      .is("deleted_at", null)
      .not("status", "in", "(exited,draft)");
    ids = (data ?? []).map((e) => e.id);
    if (!ids.length) return { error: "That department has no active employees." };
  }
  const { error } = await supabase
    .from("employee_shifts")
    .insert(ids.map((id) => emptyToNull({ employee_id: id, shift_id, effective_from, effective_to: effective_to ?? "" })));
  if (error) return { error: friendlyError(error) };
  refresh();
  revalidatePath("/employees/[id]", "page");
  return { ok: true, message: `Shift assigned to ${ids.length} employee(s). Recompute past dates if needed.` };
}

export async function registerDevice(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await hrOnly();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = z
    .object({
      code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/, "Code: letters, numbers, - and _ only.").transform((s) => s.toUpperCase()),
      name: z.string().trim().min(2, "Name is required.").max(80),
      location_id: z.union([z.uuid(), z.literal("")]).optional(),
      serial_number: z.string().trim().max(60).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const apiKey = randomBytes(24).toString("base64url");
  const supabase = await createClient();
  const { error } = await supabase.from("biometric_devices").insert(
    emptyToNull({ ...parsed.data, api_key_hash: createHash("sha256").update(apiKey).digest("hex") }),
  );
  if (error) return { error: friendlyError(error) };
  refresh();
  return {
    ok: true,
    message: `Device ${parsed.data.code} registered. API key (shown once — copy it now): ${apiKey}`,
  };
}

export async function recompute(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const parsed = z
    .object({ from: z.iso.date("Choose a start date."), to: z.iso.date("Choose an end date.") })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recompute_attendance", { p_from: parsed.data.from, p_to: parsed.data.to });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: `Recomputed ${data} employee-day(s).` };
}

/** HR manual entry (e.g. device outage). Audited like everything else. */
export async function manualPunch(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await hrOnly();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = z
    .object({
      employee_id: z.uuid("Choose an employee."),
      work_date: z.iso.date("Choose the date."),
      in_time: z.union([time, z.literal("")]).optional(),
      out_time: z.union([time, z.literal("")]).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { employee_id, work_date, in_time, out_time } = parsed.data;
  if (!in_time && !out_time) return { error: "Enter a check-in and/or check-out time." };

  const rows = [];
  if (in_time) rows.push({ employee_id, punch_type: "in", source: "manual", punch_time: pkTs(work_date, in_time) });
  if (out_time) {
    const outDate = in_time && out_time <= in_time ? new Date(Date.parse(`${work_date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : work_date;
    rows.push({ employee_id, punch_type: "out", source: "manual", punch_time: pkTs(outDate, out_time) });
  }
  const supabase = await createClient();
  const { error } = await supabase.from("attendance_punches").insert(rows);
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: "Manual punch recorded." };
}

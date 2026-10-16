"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/format";
import type { ActionState } from "@/lib/types";

const applySchema = z
  .object({
    leave_type_id: z.uuid("Choose a leave type."),
    start_date: z.iso.date("Choose a start date."),
    end_date: z.iso.date("Choose an end date."),
    half_day: z.literal("on").optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.end_date >= v.start_date, { message: "End date can't be before the start date." })
  .refine((v) => !v.half_day || v.start_date === v.end_date, {
    message: "A half day must start and end on the same date.",
  });

export async function applyLeave(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.employee) return { error: "Your account isn't linked to an employee record." };

  const parsed = applySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  // Days, balance, overlap and approver are all computed/enforced by the database.
  const { data, error } = await supabase
    .from("leave_requests")
    .insert({
      employee_id: session.employee.id,
      leave_type_id: parsed.data.leave_type_id,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      half_day: parsed.data.half_day === "on",
      reason: parsed.data.reason || null,
    })
    .select("days, stage")
    .single();
  if (error) return { error: friendlyError(error) };

  revalidatePath("/leave");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: `Submitted ${data.days} day(s) — awaiting ${data.stage === "hr" ? "HR" : "your manager"}.`,
  };
}

export async function cancelLeave(id: string) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("leave_requests").update({ status: "cancelled" }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/leave");
  revalidatePath("/dashboard");
}

export async function decideLeave(id: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const decision = formData.get("decision");
  if (decision !== "approved" && decision !== "rejected") return { error: "Choose approve or reject." };
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 500);
  if (decision === "rejected" && !comment) return { error: "Please give a reason when rejecting." };

  const supabase = await createClient();
  // The workflow trigger checks the approver and advances manager → HR → done.
  const { data, error } = await supabase
    .from("leave_requests")
    .update({ status: decision, decision_comment: comment || null })
    .eq("id", id)
    .select("status, stage")
    .maybeSingle();
  if (error) return { error: friendlyError(error) };
  if (!data) return { error: "You can't decide this request." };

  revalidatePath("/leave");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message:
      data.status === "pending" ? "Approved — forwarded to HR for final approval." : `Request ${data.status}.`,
  };
}

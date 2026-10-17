"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/format";
import type { ActionState } from "@/lib/types";

const REPORTS = ["workforce", "attendance", "leave", "payroll", "finance", "recruitment"] as const;

export async function saveSubscription(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const parsed = z
    .object({ report: z.enum(REPORTS), frequency: z.enum(["off", "daily", "weekly", "monthly"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Choose how often to receive this report." };
  const { report, frequency } = parsed.data;
  const supabase = await createClient();
  if (frequency === "off") {
    const { error } = await supabase.from("report_subscriptions").delete().eq("report", report);
    if (error) return { error: friendlyError(error) };
    revalidatePath("/analytics");
    return { ok: true, message: "Scheduled report turned off." };
  }
  const { data: existing } = await supabase.from("report_subscriptions").select("id").eq("report", report).maybeSingle();
  const { error } = existing
    ? await supabase.from("report_subscriptions").update({ frequency }).eq("id", existing.id)
    : await supabase.from("report_subscriptions").insert({ report, frequency });
  if (error) return { error: error.message.includes("row-level security") ? "Your role can't receive this report." : friendlyError(error) };
  revalidatePath("/analytics");
  const when = { daily: "every morning", weekly: "every Monday morning", monthly: "on the 1st of each month" }[frequency];
  return { ok: true, message: `You'll get this summary in your notifications ${when}.` };
}

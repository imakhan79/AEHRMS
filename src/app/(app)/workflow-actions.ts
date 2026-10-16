"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull, friendlyError } from "@/lib/format";
import type { ActionState } from "@/lib/types";

const fail = (e: { message: string; code?: string } | null) => ({ error: friendlyError(e) });

// ---------- Notifications ----------

export async function markAllRead() {
  const session = await requireSession();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", session.userId).is("read_at", null);
  revalidatePath("/", "layout");
}

// ---------- Travel & expenses ----------

export async function requestTravel(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.employee) return { error: "Your account isn't linked to an employee record." };
  const p = z
    .object({
      purpose: z.string().trim().min(3).max(200),
      destination: z.string().trim().min(2).max(100),
      start_date: z.iso.date(),
      end_date: z.iso.date(),
      estimated_cost: z.coerce.number().min(0),
      advance_requested: z.coerce.number().min(0),
    })
    .refine((v) => v.end_date >= v.start_date, { message: "End date can't be before start." })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("travel_requests").insert({ employee_id: session.employee.id, ...p.data });
  if (error) return fail(error);
  revalidatePath("/expenses");
  return { ok: true, message: "Travel request submitted for approval." };
}

export async function createClaim(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.employee) return { error: "Your account isn't linked to an employee record." };
  const title = String(formData.get("title") ?? "").trim();
  if (title.length < 3) return { error: "Give the claim a title." };
  const travel = String(formData.get("travel_request_id") ?? "") || null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_claims")
    .insert({ employee_id: session.employee.id, title, travel_request_id: travel })
    .select("id")
    .single();
  if (error) return fail(error);
  redirect(`/expenses/${data.id}`);
}

const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function addExpenseItem(claimId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.employee) return { error: "Not linked to an employee record." };
  const p = z
    .object({
      category_id: z.uuid("Choose a category."),
      expense_date: z.iso.date("Choose the date."),
      description: z.string().trim().min(2).max(200),
      amount: z.coerce.number().positive("Enter the amount."),
    })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0].message };
  const file = formData.get("receipt");
  const supabase = await createClient();
  let receipt_path: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > 4 * 1024 * 1024) return { error: "Receipts must be 4 MB or smaller." };
    if (!RECEIPT_TYPES.includes(file.type)) return { error: "Upload a PDF or image." };
    receipt_path = `${session.employee.id}/${claimId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-60)}`;
    const { error: upErr } = await supabase.storage.from("expense-receipts").upload(receipt_path, file, { contentType: file.type });
    if (upErr) return { error: upErr.message };
  }
  const { error } = await supabase.from("expense_items").insert({ claim_id: claimId, ...p.data, receipt_path });
  if (error) {
    if (receipt_path) await supabase.storage.from("expense-receipts").remove([receipt_path]);
    return fail(error);
  }
  revalidatePath(`/expenses/${claimId}`);
  return { ok: true, message: "Expense added." };
}

export async function removeExpenseItem(claimId: string, itemId: string) {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase.from("expense_items").delete().eq("id", itemId).select("receipt_path").maybeSingle();
  if (data?.receipt_path) await supabase.storage.from("expense-receipts").remove([data.receipt_path]);
  revalidatePath(`/expenses/${claimId}`);
}

export async function submitClaim(claimId: string, _: ActionState): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("exp_submit", { p_claim: claimId });
  if (error) return fail(error);
  revalidatePath("/expenses", "layout");
  return { ok: true, message: "Submitted for approval." };
}

export async function decide(kind: "claim" | "travel" | "loan", id: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const approve = formData.get("decision") === "approve";
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 300) || null;
  const bank = String(formData.get("bank_account_id") ?? "") || null;
  const supabase = await createClient();
  const { error } =
    kind === "claim"
      ? await supabase.rpc("exp_decide", { p_claim: id, p_approve: approve, p_comment: comment })
      : kind === "travel"
        ? await supabase.rpc("travel_decide", { p_req: id, p_approve: approve, p_comment: comment, p_bank: bank })
        : await supabase.rpc("loan_app_decide", { p_app: id, p_approve: approve, p_comment: comment, p_start_month: formData.get("start_month") ? `${formData.get("start_month")}-01` : null });
  if (error) return fail(error);
  revalidatePath("/expenses", "layout");
  revalidatePath("/loans", "layout");
  return { ok: true, message: approve ? "Approved." : "Rejected." };
}

export async function payClaim(claimId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const bank = String(formData.get("bank_account_id") ?? "");
  if (!bank) return { error: "Choose the bank account." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("exp_pay", { p_claim: claimId, p_bank: bank });
  if (error) return fail(error);
  revalidatePath("/expenses", "layout");
  return { ok: true, message: "Reimbursement paid and posted." };
}

export async function cancelRequest(table: "travel_requests" | "loan_applications", id: string) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from(table).update({ status: "cancelled" }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  revalidatePath(table === "travel_requests" ? "/expenses" : "/loans");
}

// ---------- Loans ----------

export async function applyLoan(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.employee) return { error: "Your account isn't linked to an employee record." };
  const p = z
    .object({
      loan_type: z.enum(["loan", "advance"]),
      amount: z.coerce.number().positive("Enter the amount."),
      installments: z.coerce.number().int().min(1).max(60),
      purpose: z.string().trim().min(3, "Tell us the purpose.").max(300),
    })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("loan_applications").insert({ employee_id: session.employee.id, ...p.data });
  if (error) return fail(error);
  revalidatePath("/loans");
  return { ok: true, message: "Application submitted." };
}

// ---------- Helpdesk ----------

export async function raiseTicket(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.employee) return { error: "Your account isn't linked to an employee record." };
  const p = z
    .object({
      category_id: z.uuid("Choose a category."),
      subject: z.string().trim().min(4).max(150),
      description: z.string().trim().min(5).max(4000),
      priority: z.enum(["low", "medium", "high", "critical"]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("tickets").insert({ requester_id: session.employee.id, ...p.data }).select("id").single();
  if (error) return fail(error);
  redirect(`/helpdesk/${data.id}`);
}

export async function commentTicket(ticketId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Write a message." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("ticket_comments")
    .insert({ ticket_id: ticketId, body: body.slice(0, 4000), is_internal: formData.get("is_internal") === "on" });
  if (error) return fail(error);
  revalidatePath(`/helpdesk/${ticketId}`);
  return { ok: true };
}

export async function updateTicket(ticketId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const p = z
    .object({
      status: z.enum(["open", "in_progress", "pending", "resolved", "closed"]).optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      assignee_id: z.union([z.uuid(), z.literal("")]).optional(),
      satisfaction: z.coerce.number().int().min(1).max(5).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").update(emptyToNull(p.data)).eq("id", ticketId);
  if (error) return fail(error);
  revalidatePath(`/helpdesk/${ticketId}`);
  revalidatePath("/helpdesk");
  return { ok: true, message: "Ticket updated." };
}

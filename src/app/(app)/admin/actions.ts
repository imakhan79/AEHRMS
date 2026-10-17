"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createMailerClient } from "@/lib/supabase/mailer";
import { friendlyError, emptyToNull } from "@/lib/format";
import { authCallbackUrl } from "@/lib/url";
import type { ActionState, AppRole } from "@/lib/types";

const ASSIGNABLE: AppRole[] = ["executive", "hr_admin", "finance", "hod", "recruiter", "system_admin", "auditor"];

export async function assignRole(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isAdmin) return { error: "Only a System Admin can assign roles." };
  const parsed = z
    .object({
      user_id: z.uuid("Choose a user."),
      role: z.enum(ASSIGNABLE as [AppRole, ...AppRole[]]),
      department_id: z.union([z.uuid(), z.literal("")]).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { user_id, role, department_id } = parsed.data;
  if (role === "hod" && !department_id) return { error: "Choose the department this HOD manages." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_roles")
    .insert({ user_id, role, department_id: role === "hod" ? department_id : null });
  if (error) return { error: error.code === "23505" ? "That user already has this role." : friendlyError(error) };
  revalidatePath("/admin/roles");
  return { ok: true, message: "Role assigned. It applies on the user's next page load." };
}

export async function removeRole(id: string) {
  const session = await requireSession();
  if (!session.isAdmin) throw new Error("Only a System Admin can remove roles.");
  const supabase = await createClient();
  const { data: row } = await supabase.from("user_roles").select("user_id, role").eq("id", id).single();
  if (row?.user_id === session.userId && row.role === "system_admin") {
    throw new Error("You can't remove your own System Admin role.");
  }
  const { error } = await supabase.from("user_roles").delete().eq("id", id);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/admin/roles");
}

// ---------------- Users (ADM-01) ----------------

export async function setUserDisabled(userId: string, disabled: boolean) {
  const session = await requireSession();
  if (!session.isAdmin) throw new Error("Only a System Admin can manage users.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_disabled", { p_user: userId, p_disabled: disabled });
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/admin/users");
}

export async function sendPasswordReset(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isAdmin) return { error: "Only a System Admin can reset passwords." };
  const email = z.email().safeParse(formData.get("email"));
  if (!email.success) return { error: "This account has no valid email address." };
  const { error } = await createMailerClient().auth.resetPasswordForEmail(email.data, {
    redirectTo: await authCallbackUrl("/account?set=password"),
  });
  if (error) return { error: error.status === 429 ? "Too many emails sent — try again in a minute." : error.message };
  return { ok: true, message: `Password reset link sent to ${email.data}.` };
}

/** Sends a sign-in link to an employee's work email; their account links to the record on first sign-in. */
export async function inviteEmployee(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isAdmin) return { error: "Only a System Admin can invite users." };
  const id = z.uuid().safeParse(formData.get("employee_id"));
  if (!id.success) return { error: "Choose an employee." };
  const supabase = await createClient();
  const { data: emp } = await supabase
    .from("employees")
    .select("full_name, work_email, user_id, status")
    .eq("id", id.data)
    .is("deleted_at", null)
    .maybeSingle();
  if (!emp) return { error: "Employee not found." };
  if (emp.user_id) return { error: `${emp.full_name} already has a login.` };
  if (emp.status === "exited") return { error: `${emp.full_name} has left the company.` };
  const email = z.email().safeParse(emp.work_email);
  if (!email.success) return { error: `Add a work email for ${emp.full_name} first.` };
  const { error } = await createMailerClient().auth.signInWithOtp({
    email: email.data,
    options: { shouldCreateUser: true, emailRedirectTo: await authCallbackUrl("/account?set=password") },
  });
  if (error) return { error: error.status === 429 ? "Too many emails sent — try again in a minute." : error.message };
  revalidatePath("/admin/users");
  return { ok: true, message: `Invitation sent to ${email.data}. They'll be asked to set a password.` };
}

// ---------------- System settings (ADM-06) ----------------

const settingsSchema = z.object({
  company_name: z.string().trim().min(2, "Enter the company name.").max(120),
  legal_name: z.string().trim().max(160),
  ntn: z.string().trim().max(20),
  strn: z.string().trim().max(20),
  address: z.string().trim().max(300),
  phone: z.string().trim().max(30),
  email: z.union([z.email("Enter a valid email."), z.literal("")]),
  website: z.union([z.url("Enter a full URL, e.g. https://aeglobal.pk"), z.literal("")]),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code."),
  timezone: z.string().trim().min(3).max(60),
  week_start: z.enum(["monday", "sunday", "saturday"]),
});

export async function updateSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isAdmin) return { error: "Only a System Admin can change system settings." };
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    new Intl.DateTimeFormat("en", { timeZone: parsed.data.timezone });
  } catch {
    return { error: "Unknown time zone. Use a name like Asia/Karachi." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("system_settings").update(emptyToNull(parsed.data)).eq("id", true);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/settings");
  return { ok: true, message: "Settings saved." };
}

// ---------------- Workflows & notifications (ADM-03, ADM-04) ----------------

export async function updateWorkflowRule(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isAdmin) return { error: "Only a System Admin can change approval workflows." };
  const num = z.union([z.literal("").transform(() => null), z.coerce.number().min(0, "Thresholds can't be negative.")]);
  const parsed = z
    .object({
      workflow: z.enum(["leave", "expense", "travel", "loan"]),
      manager_approval: z.enum(["always", "above", "never"]),
      manager_threshold: num,
      hr_above_days: num.optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workflow, manager_approval, manager_threshold, hr_above_days } = parsed.data;
  if (manager_approval === "above" && manager_threshold == null) {
    return { error: workflow === "leave" ? "Enter the number of days." : "Enter the amount." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("workflow_rules")
    .update({
      manager_approval,
      manager_threshold: manager_approval === "above" ? manager_threshold : null,
      ...(workflow === "leave" ? { hr_above_days: hr_above_days ?? null } : {}),
    })
    .eq("workflow", workflow);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/workflows");
  return { ok: true, message: "Saved. New requests follow this rule; requests already in progress keep their current step." };
}

export async function setNotificationRule(module: string, enabled: boolean) {
  const session = await requireSession();
  if (!session.isAdmin) throw new Error("Only a System Admin can change notification rules.");
  const supabase = await createClient();
  const { error } = await supabase.from("notification_rules").update({ enabled }).eq("module", module);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/admin/workflows");
}

export async function setLeaveTypeHr(leaveTypeId: string, required: boolean) {
  const session = await requireSession();
  if (!session.isAdmin) throw new Error("Only a System Admin can change approval workflows.");
  const supabase = await createClient();
  const { error } = await supabase.from("leave_types").update({ requires_hr_approval: required }).eq("id", leaveTypeId);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/admin/workflows");
}

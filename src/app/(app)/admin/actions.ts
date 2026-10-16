"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/format";
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

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull, friendlyError } from "@/lib/format";
import type { ActionState } from "@/lib/types";

// ESS-02: only these fields are self-editable (the database enforces the same list).
const contactSchema = z.object({
  phone: z.string().trim().max(30).optional(),
  personal_email: z.union([z.email("Personal email is not valid."), z.literal("")]).optional(),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(80).optional(),
  marital_status: z.enum(["single", "married", "divorced", "widowed", ""]).optional(),
});

export async function updateMyContact(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.employee) return { error: "Your account isn't linked to an employee record." };
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from("employees").update(emptyToNull(parsed.data)).eq("id", session.employee.id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/profile");
  return { ok: true, message: "Your contact details were updated." };
}

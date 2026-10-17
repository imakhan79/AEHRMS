"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

export async function changePassword(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const parsed = z
    .object({
      password: z.string().min(8, "Use at least 8 characters.").max(72, "Use at most 72 characters."),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { message: "The two passwords don't match." })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { error: "Choose a password you haven't used here before." };
    if (error.code === "weak_password") return { error: "That password is too easy to guess. Try a longer one." };
    if (error.code === "reauthentication_needed") return { error: "For security, sign out and back in, then try again." };
    return { error: error.message };
  }
  return { ok: true, message: "Password updated. Use it the next time you sign in." };
}

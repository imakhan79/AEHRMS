"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { authCallbackUrl } from "@/lib/url";
import type { ActionState } from "@/lib/types";

const credentials = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const callbackUrl = () => authCallbackUrl();

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      error:
        error.code === "email_not_confirmed"
          ? "Please confirm your email first — check your inbox for the link."
          : "Incorrect email or password.",
    };
  }
  redirect("/dashboard");
}

export async function signUp(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: await callbackUrl() },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/dashboard");
  return {
    ok: true,
    message: "Account created. Check your email and click the confirmation link to sign in.",
  };
}

export async function sendMagicLink(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = z.email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  // shouldCreateUser: false — magic links are for existing accounts only.
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { shouldCreateUser: false, emailRedirectTo: await callbackUrl() },
  });
  if (error && error.code !== "otp_disabled") {
    // Don't reveal whether an account exists.
    console.error("magic link:", error.message);
  }
  return { ok: true, message: "If an account exists for that email, a sign-in link is on its way." };
}

const DEMO_ACCOUNTS = {
  admin: "demo.admin@demo.aehrms.app",
  manager: "demo.manager@demo.aehrms.app",
  employee: "demo.employee@demo.aehrms.app",
  finance: "demo.finance@demo.aehrms.app",
} as const;

export type DemoPersona = keyof typeof DEMO_ACCOUNTS;

/** One-click demo sign-in. The password never leaves the server; off unless DEMO_MODE=true. */
export async function demoSignIn(persona: DemoPersona): Promise<ActionState> {
  if (process.env.DEMO_MODE !== "true" || !process.env.DEMO_PASSWORD) {
    return { error: "Demo access is turned off." };
  }
  const email = DEMO_ACCOUNTS[persona];
  if (!email) return { error: "Unknown demo account." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: process.env.DEMO_PASSWORD });
  if (error) return { error: "The demo account isn't available right now." };
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

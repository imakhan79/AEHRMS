"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { sendMagicLink, signIn, signUp } from "./actions";

type Mode = "signin" | "signup" | "magic";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const action = mode === "signin" ? signIn : mode === "signup" ? signUp : sendMagicLink;

  return (
    <div>
      <div className="mb-6 grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 text-xs font-medium">
        {(
          [
            ["signin", "Sign in"],
            ["magic", "Email link"],
            ["signup", "Create account"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md px-2 py-1.5 transition ${mode === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {initialError && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{initialError}</p>
      )}

      {/* key resets form state when switching modes */}
      <ActionForm key={mode} action={action} className="space-y-4">
        <Field label="Work email" name="email">
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="name@aeglobal.com" />
        </Field>
        {mode !== "magic" && (
          <Field
            label="Password"
            name="password"
            hint={mode === "signup" ? "At least 8 characters. Use your work email so HR can link your record." : undefined}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={8}
            />
          </Field>
        )}
        <div className="pt-1">
          <SubmitButton>
            {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a sign-in link"}
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

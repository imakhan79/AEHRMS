"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { changePassword } from "./actions";

export function PasswordForm({ autoFocus }: { autoFocus?: boolean }) {
  return (
    <ActionForm action={changePassword} className="max-w-sm space-y-3" resetOnSuccess>
      <Field label="New password" name="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus={autoFocus} />
      </Field>
      <Field label="Confirm new password" name="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <SubmitButton>Update password</SubmitButton>
    </ActionForm>
  );
}

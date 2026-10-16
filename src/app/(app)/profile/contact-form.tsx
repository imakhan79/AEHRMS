"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { updateMyContact } from "./actions";

export function ContactForm({ values }: { values: Record<string, string | null> }) {
  const v = (k: string) => values[k] ?? "";
  return (
    <ActionForm action={updateMyContact} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mobile" name="phone">
          <Input id="phone" name="phone" defaultValue={v("phone")} />
        </Field>
        <Field label="Personal email" name="personal_email">
          <Input id="personal_email" name="personal_email" type="email" defaultValue={v("personal_email")} />
        </Field>
        <Field label="City" name="city">
          <Input id="city" name="city" defaultValue={v("city")} />
        </Field>
        <Field label="Marital status" name="marital_status">
          <Select id="marital_status" name="marital_status" defaultValue={v("marital_status")}>
            <option value="">—</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="divorced">Divorced</option>
            <option value="widowed">Widowed</option>
          </Select>
        </Field>
        <Field label="Address" name="address" className="sm:col-span-2">
          <Textarea id="address" name="address" rows={2} defaultValue={v("address")} />
        </Field>
      </div>
      <SubmitButton size="sm">Save</SubmitButton>
    </ActionForm>
  );
}

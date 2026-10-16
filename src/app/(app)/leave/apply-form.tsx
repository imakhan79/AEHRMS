"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { LeaveType } from "@/lib/types";
import { applyLeave } from "./actions";

export function ApplyForm({ types }: { types: Pick<LeaveType, "id" | "name">[] }) {
  return (
    <ActionForm action={applyLeave} resetOnSuccess className="space-y-4">
      <Field label="Leave type" name="leave_type_id">
        <Select id="leave_type_id" name="leave_type_id" required defaultValue="">
          <option value="" disabled>
            Select…
          </option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" name="start_date">
          <Input id="start_date" name="start_date" type="date" required />
        </Field>
        <Field label="To" name="end_date">
          <Input id="end_date" name="end_date" type="date" required />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="half_day" className="rounded border-gray-300" /> Half day (single date only)
      </label>
      <Field label="Reason" name="reason">
        <Textarea id="reason" name="reason" maxLength={500} placeholder="Optional" />
      </Field>
      <p className="text-xs text-gray-500">Weekends and public holidays are not counted.</p>
      <SubmitButton>Submit request</SubmitButton>
    </ActionForm>
  );
}

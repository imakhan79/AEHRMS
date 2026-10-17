"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select } from "@/components/ui";
import { inviteEmployee, sendPasswordReset, updateSettings, updateWorkflowRule } from "./actions";

type Option = { id: string; label: string };

export function InviteForm({ employees }: { employees: Option[] }) {
  return (
    <ActionForm action={inviteEmployee} className="space-y-3" resetOnSuccess>
      <Field label="Employee" name="employee_id" hint="Employees with a work email and no login yet.">
        <Select id="employee_id" name="employee_id" required defaultValue="">
          <option value="" disabled>
            Select…
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton size="sm">Send invitation</SubmitButton>
    </ActionForm>
  );
}

export function ResetPasswordForm({ email }: { email: string }) {
  return (
    <ActionForm action={sendPasswordReset}>
      <input type="hidden" name="email" value={email} />
      <SubmitButton variant="secondary" size="sm">
        Send reset link
      </SubmitButton>
    </ActionForm>
  );
}

export type Settings = Record<
  "company_name" | "legal_name" | "ntn" | "strn" | "address" | "phone" | "email" | "website" | "currency" | "timezone" | "week_start",
  string | null
>;

export function SettingsForm({ values }: { values: Settings }) {
  const v = (k: keyof Settings) => values[k] ?? "";
  return (
    <ActionForm action={updateSettings} className="grid gap-4 sm:grid-cols-2">
      <Field label="Company name" name="company_name">
        <Input id="company_name" name="company_name" required defaultValue={v("company_name")} />
      </Field>
      <Field label="Registered legal name" name="legal_name">
        <Input id="legal_name" name="legal_name" defaultValue={v("legal_name")} />
      </Field>
      <Field label="NTN" name="ntn" hint="National Tax Number (FBR)">
        <Input id="ntn" name="ntn" defaultValue={v("ntn")} />
      </Field>
      <Field label="STRN" name="strn" hint="Sales Tax Registration Number">
        <Input id="strn" name="strn" defaultValue={v("strn")} />
      </Field>
      <Field label="Registered address" name="address" className="sm:col-span-2">
        <Input id="address" name="address" defaultValue={v("address")} />
      </Field>
      <Field label="Phone" name="phone">
        <Input id="phone" name="phone" type="tel" defaultValue={v("phone")} />
      </Field>
      <Field label="Contact email" name="email">
        <Input id="email" name="email" type="email" defaultValue={v("email")} />
      </Field>
      <Field label="Website" name="website">
        <Input id="website" name="website" type="url" placeholder="https://" defaultValue={v("website")} />
      </Field>
      <Field label="Base currency" name="currency" hint="Single-currency books (BRD 4.2).">
        <Input id="currency" name="currency" maxLength={3} required defaultValue={v("currency")} />
      </Field>
      <Field label="Time zone" name="timezone">
        <Input id="timezone" name="timezone" required defaultValue={v("timezone")} />
      </Field>
      <Field label="Week starts on" name="week_start">
        <Select id="week_start" name="week_start" defaultValue={v("week_start")}>
          <option value="monday">Monday</option>
          <option value="saturday">Saturday</option>
          <option value="sunday">Sunday</option>
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>Save settings</SubmitButton>
      </div>
    </ActionForm>
  );
}

export type Rule = {
  workflow: "leave" | "expense" | "travel" | "loan";
  manager_approval: "always" | "above" | "never";
  manager_threshold: number | null;
  hr_above_days: number | null;
};

const CHAIN: Record<Rule["workflow"], { next: string; unit: string }> = {
  leave: { next: "HR, when the leave type or length requires it", unit: "days" },
  expense: { next: "Finance verification", unit: "PKR" },
  travel: { next: "Finance, which pays any advance", unit: "PKR" },
  loan: { next: "Finance approval", unit: "PKR" },
};

export function WorkflowRuleForm({ rule }: { rule: Rule }) {
  const [mode, setMode] = useState(rule.manager_approval);
  const { next, unit } = CHAIN[rule.workflow];
  const id = (s: string) => `${rule.workflow}_${s}`;
  return (
    <ActionForm action={updateWorkflowRule} className="space-y-3">
      <input type="hidden" name="workflow" value={rule.workflow} />
      <Field label="Line manager approval" name={id("manager_approval")}>
        <Select id={id("manager_approval")} name="manager_approval" value={mode} onChange={(e) => setMode(e.target.value as Rule["manager_approval"])}>
          <option value="always">Always</option>
          <option value="above">Only above a threshold</option>
          <option value="never">Never — skip to the next step</option>
        </Select>
      </Field>
      {mode === "above" ? (
        <Field label={`Manager approves when more than (${unit})`} name={id("manager_threshold")}>
          <Input
            id={id("manager_threshold")}
            name="manager_threshold"
            type="number"
            min={0}
            step={unit === "days" ? 0.5 : 100}
            required
            defaultValue={rule.manager_threshold ?? ""}
          />
        </Field>
      ) : (
        <input type="hidden" name="manager_threshold" value="" />
      )}
      {rule.workflow === "leave" && (
        <Field label="Also require HR when longer than (days)" name={id("hr_above_days")} hint="Leave empty to follow each leave type's setting only.">
          <Input id={id("hr_above_days")} name="hr_above_days" type="number" min={0} step={0.5} defaultValue={rule.hr_above_days ?? ""} />
        </Field>
      )}
      <p className="text-xs text-gray-500">Then: {next}.</p>
      <SubmitButton size="sm">Save</SubmitButton>
    </ActionForm>
  );
}

"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, type Employee } from "@/lib/types";
import { saveEmployee } from "./actions";

export type Option = { id: string; label: string };

export interface EmployeeOptions {
  departments: Option[];
  positions: Option[];
  locations: Option[];
  managers: Option[];
}

function Opts({ items, none = "— None —" }: { items: Option[]; none?: string }) {
  return (
    <>
      <option value="">{none}</option>
      {items.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

export function EmployeeForm({ employee, options }: { employee?: Employee; options: EmployeeOptions }) {
  const e = employee;
  const v = (k: keyof Employee) => (e?.[k] as string | null | undefined) ?? "";

  return (
    <ActionForm action={saveEmployee.bind(null, e?.id ?? null)} className="space-y-6">
      <Section title="Identity">
        <Field label="Employee code *" name="employee_code">
          <Input id="employee_code" name="employee_code" required defaultValue={v("employee_code")} placeholder="AEG-0001" />
        </Field>
        <Field label="First name *" name="first_name">
          <Input id="first_name" name="first_name" required defaultValue={v("first_name")} />
        </Field>
        <Field label="Last name *" name="last_name">
          <Input id="last_name" name="last_name" required defaultValue={v("last_name")} />
        </Field>
        <Field label="Father's name" name="father_name">
          <Input id="father_name" name="father_name" defaultValue={v("father_name")} />
        </Field>
        <Field label="Date of birth" name="date_of_birth">
          <Input id="date_of_birth" name="date_of_birth" type="date" defaultValue={v("date_of_birth")} />
        </Field>
        <Field label="Gender" name="gender">
          <Select id="gender" name="gender" defaultValue={v("gender")}>
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Marital status" name="marital_status">
          <Select id="marital_status" name="marital_status" defaultValue={v("marital_status")}>
            <option value="">—</option>
            {["single", "married", "divorced", "widowed"].map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nationality" name="nationality">
          <Input id="nationality" name="nationality" defaultValue={e ? v("nationality") : "Pakistani"} />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Work email" name="work_email" hint="Used to link the employee's login.">
          <Input id="work_email" name="work_email" type="email" defaultValue={v("work_email")} />
        </Field>
        <Field label="Personal email" name="personal_email">
          <Input id="personal_email" name="personal_email" type="email" defaultValue={v("personal_email")} />
        </Field>
        <Field label="Phone" name="phone">
          <Input id="phone" name="phone" defaultValue={v("phone")} placeholder="0300-1234567" />
        </Field>
        <Field label="City" name="city">
          <Input id="city" name="city" defaultValue={v("city")} />
        </Field>
        <Field label="Address" name="address" className="sm:col-span-2">
          <Textarea id="address" name="address" rows={2} defaultValue={v("address")} />
        </Field>
      </Section>

      <Section title="Employment">
        <Field label="Department" name="department_id">
          <Select id="department_id" name="department_id" defaultValue={v("department_id")}>
            <Opts items={options.departments} />
          </Select>
        </Field>
        <Field label="Position" name="position_id">
          <Select id="position_id" name="position_id" defaultValue={v("position_id")}>
            <Opts items={options.positions} />
          </Select>
        </Field>
        <Field label="Location" name="location_id">
          <Select id="location_id" name="location_id" defaultValue={v("location_id")}>
            <Opts items={options.locations} />
          </Select>
        </Field>
        <Field label="Line manager" name="manager_id" hint="Approves this employee's leave.">
          <Select id="manager_id" name="manager_id" defaultValue={v("manager_id")}>
            <Opts items={options.managers.filter((m) => m.id !== e?.id)} />
          </Select>
        </Field>
        <Field label="Employment type" name="employment_type">
          <Select id="employment_type" name="employment_type" defaultValue={e?.employment_type ?? "permanent"}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {titleCase(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" name="status">
          <Select id="status" name="status" defaultValue={e?.status ?? "draft"}>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Joining date" name="joining_date">
          <Input id="joining_date" name="joining_date" type="date" defaultValue={v("joining_date")} />
        </Field>
        <Field label="Probation ends" name="probation_end_date">
          <Input id="probation_end_date" name="probation_end_date" type="date" defaultValue={v("probation_end_date")} />
        </Field>
        <Field label="Confirmation date" name="confirmation_date">
          <Input id="confirmation_date" name="confirmation_date" type="date" defaultValue={v("confirmation_date")} />
        </Field>
        <Field label="Contract ends" name="contract_end_date">
          <Input id="contract_end_date" name="contract_end_date" type="date" defaultValue={v("contract_end_date")} />
        </Field>
        <Field label="Exit date" name="exit_date">
          <Input id="exit_date" name="exit_date" type="date" defaultValue={v("exit_date")} />
        </Field>
      </Section>

      <SubmitButton>{e ? "Save changes" : "Create employee"}</SubmitButton>
    </ActionForm>
  );
}

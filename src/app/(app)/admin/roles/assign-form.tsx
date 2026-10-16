"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Select } from "@/components/ui";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { assignRole } from "../actions";

type Option = { id: string; label: string };

export function AssignForm({ users, departments }: { users: Option[]; departments: Option[] }) {
  const [role, setRole] = useState<AppRole>("hr_admin");
  return (
    <ActionForm action={assignRole} className="space-y-3">
      <Field label="User" name="user_id" hint="Only employees with a linked login are listed.">
        <Select id="user_id" name="user_id" required defaultValue="">
          <option value="" disabled>
            Select…
          </option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Role" name="role">
        <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
          {(Object.keys(ROLE_LABELS) as AppRole[])
            .filter((r) => r !== "employee")
            .map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
        </Select>
      </Field>
      {role === "hod" && (
        <Field label="Department" name="department_id" hint="The HOD can see and approve this department's staff.">
          <Select id="department_id" name="department_id" required defaultValue="">
            <option value="" disabled>
              Select…
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <SubmitButton size="sm">Assign role</SubmitButton>
    </ActionForm>
  );
}

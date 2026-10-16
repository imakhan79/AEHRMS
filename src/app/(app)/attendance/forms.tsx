"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import {
  addShift,
  assignShift,
  decideRegularization,
  manualPunch,
  recompute,
  registerDevice,
  requestRegularization,
  verifyPunch,
} from "./actions";

type Option = { id: string; label: string };

function Opts({ items, placeholder }: { items: Option[]; placeholder: string }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {items.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </>
  );
}

export function RegularizationForm({ defaultDate }: { defaultDate?: string }) {
  return (
    <ActionForm action={requestRegularization} resetOnSuccess className="space-y-3">
      <Field label="Date" name="work_date">
        <Input id="work_date" name="work_date" type="date" required defaultValue={defaultDate} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Actual check-in" name="in_time">
          <Input id="in_time" name="in_time" type="time" required defaultValue="09:00" />
        </Field>
        <Field label="Actual check-out" name="out_time">
          <Input id="out_time" name="out_time" type="time" required defaultValue="17:00" />
        </Field>
      </div>
      <Field label="Reason" name="reason">
        <Textarea id="reason" name="reason" required minLength={5} maxLength={500} placeholder="e.g. Forgot to check out; was at client site" />
      </Field>
      <SubmitButton size="sm">Request correction</SubmitButton>
    </ActionForm>
  );
}

export function DecideRegularization({ id }: { id: string }) {
  return (
    <ActionForm action={decideRegularization.bind(null, id)} className="flex flex-wrap items-center gap-2">
      <Input name="comment" placeholder="Comment (required to reject)" className="w-52 py-1.5 text-xs" maxLength={500} />
      <SubmitButton size="sm" variant="success" name="decision" value="approved">
        Approve
      </SubmitButton>
      <SubmitButton size="sm" variant="danger" name="decision" value="rejected">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}

export function VerifyPunch({ id }: { id: string }) {
  return (
    <ActionForm action={verifyPunch.bind(null, id)} className="flex flex-wrap items-center gap-2">
      <Input name="note" placeholder="Note (required to reject)" className="w-48 py-1.5 text-xs" maxLength={300} />
      <SubmitButton size="sm" variant="success" name="decision" value="verified">
        Verify
      </SubmitButton>
      <SubmitButton size="sm" variant="danger" name="decision" value="rejected">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

export function ShiftForm() {
  return (
    <ActionForm action={addShift} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" name="s_code">
          <Input id="s_code" name="code" required placeholder="e.g. NIGHT" />
        </Field>
        <Field label="Name" name="s_name">
          <Input id="s_name" name="name" required placeholder="e.g. Night (22:00–06:00)" />
        </Field>
        <Field label="Type" name="s_type" hint="Flexible: no late / early checks, judged on hours worked.">
          <Select id="s_type" name="shift_type" defaultValue="fixed">
            <option value="fixed">Fixed</option>
            <option value="flexible">Flexible</option>
          </Select>
        </Field>
        <Field label="Grace (min)" name="s_grace">
          <Input id="s_grace" name="grace_minutes" type="number" min={0} max={240} defaultValue={15} />
        </Field>
        <Field label="Start" name="s_start">
          <Input id="s_start" name="start_time" type="time" required defaultValue="09:00" />
        </Field>
        <Field label="End" name="s_end" hint="Earlier than start = overnight shift.">
          <Input id="s_end" name="end_time" type="time" required defaultValue="17:00" />
        </Field>
        <Field label="Full day (min)" name="s_full">
          <Input id="s_full" name="full_day_minutes" type="number" min={60} defaultValue={480} />
        </Field>
        <Field label="Half day (min)" name="s_half">
          <Input id="s_half" name="half_day_minutes" type="number" min={30} defaultValue={240} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="overtime_enabled" defaultChecked className="rounded border-gray-300" /> Overtime counts
        </label>
        <Field label="OT after extra (min)" name="s_ot">
          <Input id="s_ot" name="overtime_after_minutes" type="number" min={0} defaultValue={30} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-700">Weekly off days</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {DAYS.map(([n, label]) => (
            <label key={n} className="flex items-center gap-1">
              <input type="checkbox" name="weekly_off_days" value={n} defaultChecked={n >= 6} className="rounded border-gray-300" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton size="sm">Add shift</SubmitButton>
    </ActionForm>
  );
}

export function AssignShiftForm({
  shifts,
  employees,
  departments,
  fixedEmployeeId,
}: {
  shifts: Option[];
  employees?: Option[];
  departments?: Option[];
  fixedEmployeeId?: string;
}) {
  return (
    <ActionForm action={assignShift} resetOnSuccess className="space-y-3">
      {fixedEmployeeId && <input type="hidden" name="employee_id" value={fixedEmployeeId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Shift" name="as_shift">
          <Select id="as_shift" name="shift_id" required defaultValue="">
            <Opts items={shifts} placeholder="Select…" />
          </Select>
        </Field>
        {!fixedEmployeeId && (
          <>
            <Field label="Employee" name="as_emp">
              <Select id="as_emp" name="employee_id" defaultValue="">
                <Opts items={employees ?? []} placeholder="— or a whole department —" />
              </Select>
            </Field>
            <Field label="Department" name="as_dept">
              <Select id="as_dept" name="department_id" defaultValue="">
                <Opts items={departments ?? []} placeholder="— None —" />
              </Select>
            </Field>
          </>
        )}
        <Field label="From" name="as_from">
          <Input id="as_from" name="effective_from" type="date" required />
        </Field>
        <Field label="To (optional)" name="as_to">
          <Input id="as_to" name="effective_to" type="date" />
        </Field>
      </div>
      <SubmitButton size="sm">Assign shift</SubmitButton>
    </ActionForm>
  );
}

export function DeviceForm({ locations }: { locations: Option[] }) {
  return (
    <ActionForm action={registerDevice} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" name="dv_code">
          <Input id="dv_code" name="code" required placeholder="e.g. LHR-ZK-01" />
        </Field>
        <Field label="Name" name="dv_name">
          <Input id="dv_name" name="name" required placeholder="Main gate" />
        </Field>
        <Field label="Location" name="dv_loc">
          <Select id="dv_loc" name="location_id" defaultValue="">
            <Opts items={locations} placeholder="— None —" />
          </Select>
        </Field>
        <Field label="Serial no." name="dv_sn">
          <Input id="dv_sn" name="serial_number" />
        </Field>
      </div>
      <SubmitButton size="sm">Register device</SubmitButton>
    </ActionForm>
  );
}

export function RecomputeForm() {
  return (
    <ActionForm action={recompute} className="flex flex-wrap items-end gap-3">
      <Field label="From" name="rc_from">
        <Input id="rc_from" name="from" type="date" required />
      </Field>
      <Field label="To" name="rc_to">
        <Input id="rc_to" name="to" type="date" required />
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Recompute
      </SubmitButton>
    </ActionForm>
  );
}

export function ManualPunchForm({ employees }: { employees: Option[] }) {
  return (
    <ActionForm action={manualPunch} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Employee" name="mp_emp" className="sm:col-span-2">
          <Select id="mp_emp" name="employee_id" required defaultValue="">
            <Opts items={employees} placeholder="Select…" />
          </Select>
        </Field>
        <Field label="Date" name="mp_date">
          <Input id="mp_date" name="work_date" type="date" required />
        </Field>
        <div />
        <Field label="Check-in" name="mp_in">
          <Input id="mp_in" name="in_time" type="time" />
        </Field>
        <Field label="Check-out" name="mp_out">
          <Input id="mp_out" name="out_time" type="time" />
        </Field>
      </div>
      <SubmitButton size="sm">Record punch</SubmitButton>
    </ActionForm>
  );
}

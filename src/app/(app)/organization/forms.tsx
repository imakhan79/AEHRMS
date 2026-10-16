"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select } from "@/components/ui";
import { addCostCenter, addDepartment, addLocation, addPosition } from "./actions";

type Option = { id: string; label: string };

function Options({ items, placeholder }: { items: Option[]; placeholder: string }) {
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

const grid = "grid gap-3 sm:grid-cols-2";

export function DepartmentForm({ departments, costCenters }: { departments: Option[]; costCenters: Option[] }) {
  return (
    <ActionForm action={addDepartment} resetOnSuccess className="space-y-3">
      <div className={grid}>
        <Field label="Code" name="d_code">
          <Input id="d_code" name="code" required maxLength={20} placeholder="e.g. HR-REC" />
        </Field>
        <Field label="Name" name="d_name">
          <Input id="d_name" name="name" required placeholder="e.g. Recruitment" />
        </Field>
        <Field label="Level" name="d_type">
          <Select id="d_type" name="unit_type" defaultValue="department">
            <option value="department">Department</option>
            <option value="section">Section</option>
            <option value="team">Team</option>
          </Select>
        </Field>
        <Field label="Parent unit" name="d_parent">
          <Select id="d_parent" name="parent_id" defaultValue="">
            <Options items={departments} placeholder="— None (top level) —" />
          </Select>
        </Field>
        <Field label="Cost center" name="d_cc" className="sm:col-span-2">
          <Select id="d_cc" name="cost_center_id" defaultValue="">
            <Options items={costCenters} placeholder="— None —" />
          </Select>
        </Field>
      </div>
      <SubmitButton size="sm">Add unit</SubmitButton>
    </ActionForm>
  );
}

export function PositionForm({ departments }: { departments: Option[] }) {
  return (
    <ActionForm action={addPosition} resetOnSuccess className="space-y-3">
      <div className={grid}>
        <Field label="Code" name="p_code">
          <Input id="p_code" name="code" required maxLength={20} placeholder="e.g. HR-MGR" />
        </Field>
        <Field label="Title" name="p_title">
          <Input id="p_title" name="title" required placeholder="e.g. HR Manager" />
        </Field>
        <Field label="Grade" name="p_grade">
          <Input id="p_grade" name="grade" maxLength={10} placeholder="e.g. M2" />
        </Field>
        <Field label="Department" name="p_dept">
          <Select id="p_dept" name="department_id" defaultValue="">
            <Options items={departments} placeholder="— Any —" />
          </Select>
        </Field>
      </div>
      <SubmitButton size="sm">Add position</SubmitButton>
    </ActionForm>
  );
}

export function LocationForm() {
  return (
    <ActionForm action={addLocation} resetOnSuccess className="space-y-3">
      <div className={grid}>
        <Field label="Code" name="l_code">
          <Input id="l_code" name="code" required maxLength={20} placeholder="e.g. SITE-01" />
        </Field>
        <Field label="Name" name="l_name">
          <Input id="l_name" name="name" required />
        </Field>
        <Field label="City" name="l_city">
          <Input id="l_city" name="city" />
        </Field>
        <Field label="Geofence radius (m)" name="l_radius">
          <Input id="l_radius" name="geofence_radius_m" type="number" min={10} max={5000} defaultValue={200} />
        </Field>
        <Field label="Latitude" name="l_lat">
          <Input id="l_lat" name="latitude" type="number" step="0.000001" placeholder="31.5204" />
        </Field>
        <Field label="Longitude" name="l_lng">
          <Input id="l_lng" name="longitude" type="number" step="0.000001" placeholder="74.3587" />
        </Field>
        <Field label="Address" name="l_addr" className="sm:col-span-2">
          <Input id="l_addr" name="address" />
        </Field>
      </div>
      <SubmitButton size="sm">Add location</SubmitButton>
    </ActionForm>
  );
}

export function CostCenterForm() {
  return (
    <ActionForm action={addCostCenter} resetOnSuccess className="space-y-3">
      <div className={grid}>
        <Field label="Code" name="c_code">
          <Input id="c_code" name="code" required maxLength={20} placeholder="e.g. CC-100" />
        </Field>
        <Field label="Name" name="c_name">
          <Input id="c_name" name="name" required />
        </Field>
      </div>
      <SubmitButton size="sm">Add cost center</SubmitButton>
    </ActionForm>
  );
}

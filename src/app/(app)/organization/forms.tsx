"use client";

import { useRef, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select } from "@/components/ui";
import { addCostCenter, addDepartment, addLocation, addPosition, updateLocationGeofence } from "./actions";

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

/** Edit an office's geofence; "Use my current location" fills the coordinates while standing at the office. */
export function GeofenceForm({ id, latitude, longitude, radius }: { id: string; latitude: number | null; longitude: number | null; radius: number }) {
  const lat = useRef<HTMLInputElement>(null);
  const lng = useRef<HTMLInputElement>(null);
  const [gps, setGps] = useState<string | null>(null);

  function useHere() {
    if (!("geolocation" in navigator)) return setGps("This browser can't share its location.");
    setGps("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (lat.current) lat.current.value = p.coords.latitude.toFixed(6);
        if (lng.current) lng.current.value = p.coords.longitude.toFixed(6);
        setGps(`Location found (±${Math.round(p.coords.accuracy)} m). Save to apply.`);
      },
      (e) => setGps(e.code === e.PERMISSION_DENIED ? "Location permission was denied. Allow it in the browser and try again." : "Couldn't get a GPS fix. Try again near a window."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <ActionForm action={updateLocationGeofence} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Latitude" name={`lat_${id}`}>
          <Input ref={lat} id={`lat_${id}`} name="latitude" type="number" step="0.000001" min={-90} max={90} defaultValue={latitude ?? ""} placeholder="31.520400" />
        </Field>
        <Field label="Longitude" name={`lng_${id}`}>
          <Input ref={lng} id={`lng_${id}`} name="longitude" type="number" step="0.000001" min={-180} max={180} defaultValue={longitude ?? ""} placeholder="74.358700" />
        </Field>
        <Field label="Radius (m)" name={`rad_${id}`}>
          <Input id={`rad_${id}`} name="geofence_radius_m" type="number" min={10} max={5000} defaultValue={radius} required />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={useHere} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200 transition-colors hover:bg-indigo-50">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
            <path fillRule="evenodd" d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .976.544l.062.029.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd" />
          </svg>
          Use my current location
        </button>
        <SubmitButton size="sm">Save geofence</SubmitButton>
      </div>
      {gps && <p className="text-xs text-gray-600">{gps}</p>}
    </ActionForm>
  );
}

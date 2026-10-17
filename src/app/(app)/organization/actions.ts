"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull, friendlyError } from "@/lib/format";
import type { ActionState } from "@/lib/types";

const code = z
  .string()
  .trim()
  .min(1, "Code is required.")
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, numbers, - and _.")
  .transform((s) => s.toUpperCase());
const optionalUuid = z.union([z.uuid(), z.literal("")]).optional();

async function insert(table: string, values: Record<string, unknown>, label: string): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isHR) return { error: "Only HR can change the organization structure." };
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert(emptyToNull(values));
  if (error) return { error: friendlyError(error) };
  revalidatePath("/organization");
  return { ok: true, message: `${label} added.` };
}

export async function addDepartment(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      code,
      name: z.string().trim().min(2, "Name is required."),
      unit_type: z.enum(["department", "section", "team"]),
      parent_id: optionalUuid,
      cost_center_id: optionalUuid,
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id").eq("org_type", "company").limit(1).single();
  return insert("departments", { ...parsed.data, organization_id: org?.id }, "Unit");
}

export async function addPosition(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      code,
      title: z.string().trim().min(2, "Title is required."),
      grade: z.string().trim().max(10).optional(),
      department_id: optionalUuid,
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return insert("positions", parsed.data, "Position");
}

export async function addLocation(_: ActionState, formData: FormData): Promise<ActionState> {
  const coord = z.union([z.coerce.number(), z.literal("")]).optional();
  const parsed = z
    .object({
      code,
      name: z.string().trim().min(2, "Name is required."),
      city: z.string().trim().optional(),
      address: z.string().trim().optional(),
      latitude: coord,
      longitude: coord,
      geofence_radius_m: z.coerce.number().int().min(10).max(5000).default(200),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return insert("locations", parsed.data, "Location");
}

export async function addCostCenter(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ code, name: z.string().trim().min(2, "Name is required.") })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return insert("cost_centers", parsed.data, "Cost center");
}

/** Office coordinates + radius used to auto-verify web/mobile check-ins (ATT-04). */
export async function updateLocationGeofence(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isHR) return { error: "Only HR can change office locations." };
  const parsed = z
    .object({
      id: z.uuid(),
      latitude: z.union([z.literal("").transform(() => null), z.coerce.number().min(-90).max(90)]),
      longitude: z.union([z.literal("").transform(() => null), z.coerce.number().min(-180).max(180)]),
      geofence_radius_m: z.coerce.number().int().min(10, "Radius must be at least 10 m.").max(5000, "Radius can be at most 5,000 m."),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, latitude, longitude, geofence_radius_m } = parsed.data;
  if ((latitude == null) !== (longitude == null)) return { error: "Enter both latitude and longitude, or clear both." };
  const supabase = await createClient();
  const { error } = await supabase.from("locations").update({ latitude, longitude, geofence_radius_m }).eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/organization");
  revalidatePath("/attendance");
  return { ok: true, message: latitude == null ? "Geofence cleared — check-ins here need manager verification." : "Geofence saved. Check-ins inside it are verified automatically." };
}

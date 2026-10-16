"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull, friendlyError } from "@/lib/format";
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, type ActionState } from "@/lib/types";

const optText = z.string().trim().max(200).optional();
const optDate = z.union([z.iso.date(), z.literal("")]).optional();
const optUuid = z.union([z.uuid(), z.literal("")]).optional();

const employeeSchema = z.object({
  employee_code: z
    .string()
    .trim()
    .min(1, "Employee code is required.")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Employee code may only contain letters, numbers and -.")
    .transform((s) => s.toUpperCase()),
  first_name: z.string().trim().min(1, "First name is required.").max(80),
  last_name: z.string().trim().min(1, "Last name is required.").max(80),
  father_name: optText,
  work_email: z.union([z.email("Work email is not valid."), z.literal("")]).optional(),
  personal_email: z.union([z.email("Personal email is not valid."), z.literal("")]).optional(),
  phone: optText,
  date_of_birth: optDate,
  gender: z.enum(["male", "female", "other", ""]).optional(),
  marital_status: z.enum(["single", "married", "divorced", "widowed", ""]).optional(),
  nationality: optText,
  address: z.string().trim().max(500).optional(),
  city: optText,
  department_id: optUuid,
  position_id: optUuid,
  location_id: optUuid,
  manager_id: optUuid,
  employment_type: z.enum(EMPLOYMENT_TYPES),
  status: z.enum(EMPLOYEE_STATUSES),
  joining_date: optDate,
  probation_end_date: optDate,
  confirmation_date: optDate,
  contract_end_date: optDate,
  exit_date: optDate,
});

function changed(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

export async function saveEmployee(id: string | null, _: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isHR) return { error: "Only HR can edit employee records." };

  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const values = emptyToNull(parsed.data);
  if (id && values.manager_id === id) return { error: "An employee can't be their own manager." };

  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("employees").update(values).eq("id", id);
    if (error) return { error: friendlyError(error) };
    changed(`/employees/${id}`, "/employees");
    return { ok: true, message: "Employee updated." };
  }

  const { data: org } = await supabase.from("organizations").select("id").eq("org_type", "company").limit(1).single();
  const { data, error } = await supabase
    .from("employees")
    .insert({ ...values, organization_id: org?.id })
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };

  if (values.joining_date) {
    await supabase.from("employment_history").insert({
      employee_id: data.id,
      change_type: "joining",
      effective_date: values.joining_date,
      to_department_id: values.department_id,
      to_position_id: values.position_id,
    });
  }
  changed("/employees");
  redirect(`/employees/${data.id}`);
}

const privateSchema = z.object({
  cnic: z.union([z.string().regex(/^\d{5}-\d{7}-\d$/, "CNIC must look like 35202-1234567-1."), z.literal("")]).optional(),
  ntn: optText,
  eobi_number: optText,
  pessi_number: optText,
  pf_number: optText,
  bank_name: optText,
  bank_branch: optText,
  account_title: optText,
  account_number: optText,
  iban: z
    .union([
      z
        .string()
        .transform((s) => s.replace(/\s+/g, "").toUpperCase())
        .pipe(z.string().regex(/^PK\d{2}[A-Z]{4}\d{16}$/, "IBAN must be 24 characters, e.g. PK36SCBL0000001123456702.")),
      z.literal(""),
    ])
    .optional(),
});

export async function savePrivate(employeeId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isHR) return { error: "Only HR can change CNIC, bank and statutory details." };
  const parsed = privateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_private")
    .upsert({ employee_id: employeeId, ...emptyToNull(parsed.data) });
  if (error) return { error: friendlyError(error) };
  changed(`/employees/${employeeId}`);
  return { ok: true, message: "Restricted details saved." };
}

export async function allocateLeave(employeeId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isHR) return { error: "Only HR can allocate leave." };
  const parsed = z
    .object({
      leave_type_id: z.uuid("Choose a leave type."),
      year: z.coerce.number().int().min(2000).max(2100),
      allocated: z.coerce.number().min(0).max(365),
      carried_forward: z.coerce.number().min(0).max(365).default(0),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("leave_balances")
    .upsert({ employee_id: employeeId, ...parsed.data }, { onConflict: "employee_id,leave_type_id,year" });
  if (error) return { error: friendlyError(error) };
  changed(`/employees/${employeeId}`);
  return { ok: true, message: "Leave balance saved." };
}

export async function allocateDefaultLeave(employeeId: string) {
  const session = await requireSession();
  if (!session.isHR) throw new Error("Only HR can allocate leave.");
  const supabase = await createClient();
  const year = new Date().getFullYear();
  const [{ data: types }, { data: emp }] = await Promise.all([
    supabase.from("leave_types").select("id, days_per_year, gender").eq("is_active", true),
    supabase.from("employees").select("gender").eq("id", employeeId).single(),
  ]);
  const rows = (types ?? [])
    .filter((t) => !t.gender || t.gender === emp?.gender)
    .map((t) => ({ employee_id: employeeId, leave_type_id: t.id, year, allocated: t.days_per_year }));
  // ignoreDuplicates keeps any balances HR already adjusted.
  const { error } = await supabase
    .from("leave_balances")
    .upsert(rows, { onConflict: "employee_id,leave_type_id,year", ignoreDuplicates: true });
  if (error) throw new Error(friendlyError(error));
  changed(`/employees/${employeeId}`);
}

export async function addHistory(employeeId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isHR) return { error: "Only HR can record employment history." };
  const parsed = z
    .object({
      change_type: z.enum(["promotion", "transfer", "increment", "confirmation", "status_change", "contract_renewal", "exit"]),
      effective_date: z.iso.date("Choose an effective date."),
      to_department_id: optUuid,
      to_position_id: optUuid,
      notes: z.string().trim().max(500).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: emp } = await supabase
    .from("employees")
    .select("department_id, position_id")
    .eq("id", employeeId)
    .single();
  const { error } = await supabase.from("employment_history").insert(
    emptyToNull({
      employee_id: employeeId,
      ...parsed.data,
      from_department_id: emp?.department_id ?? "",
      from_position_id: emp?.position_id ?? "",
    }),
  );
  if (error) return { error: friendlyError(error) };
  changed(`/employees/${employeeId}`);
  return { ok: true, message: "History entry recorded. Update the employment details above if they changed." };
}

export async function addDependent(employeeId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (!session.isHR) return { error: "Only HR can manage dependents." };
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Name is required.").max(120),
      relationship: z.enum(["spouse", "son", "daughter", "father", "mother", "other"]),
      date_of_birth: optDate,
      cnic_or_bform: optText,
      is_nominee: z.literal("on").optional(),
      nominee_share: z.union([z.coerce.number().min(0).max(100), z.literal("")]).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_dependents")
    .insert(emptyToNull({ employee_id: employeeId, ...parsed.data, is_nominee: parsed.data.is_nominee === "on" }));
  if (error) return { error: friendlyError(error) };
  changed(`/employees/${employeeId}`);
  return { ok: true, message: "Dependent added." };
}

export async function addEmergencyContact(employeeId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Name is required.").max(120),
      relationship: z.string().trim().min(1, "Relationship is required.").max(40),
      phone: z.string().trim().min(7, "Phone number is required.").max(30),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  // RLS allows the employee themselves or HR.
  const { error } = await supabase.from("employee_emergency_contacts").insert({ employee_id: employeeId, ...parsed.data });
  if (error) return { error: friendlyError(error) };
  changed(`/employees/${employeeId}`, "/profile");
  return { ok: true, message: "Emergency contact added." };
}

export async function deleteEmergencyContact(id: string) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.from("employee_emergency_contacts").delete().eq("id", id);
  if (error) throw new Error(friendlyError(error));
  revalidatePath("/profile");
  revalidatePath("/employees/[id]", "page");
}

const MAX_UPLOAD = 4 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function uploadDocument(employeeId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const file = formData.get("file");
  const parsed = z
    .object({
      doc_type: z.enum(["cnic", "degree", "experience_letter", "contract", "offer_letter", "photo", "other"]),
      title: z.string().trim().min(1, "Give the document a title.").max(120),
      expiry_date: optDate,
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD) return { error: "Files must be 4 MB or smaller." };
  if (!ALLOWED.includes(file.type)) return { error: "Upload a PDF, JPG, PNG or WebP file." };

  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${employeeId}/${crypto.randomUUID()}-${safeName}`;
  const supabase = await createClient();
  // Storage RLS: employees can only write into their own folder; HR into any.
  const { error: upErr } = await supabase.storage
    .from("employee-documents")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { error: upErr.message.includes("row-level security") ? "You can't upload to this record." : upErr.message };

  const { error } = await supabase.from("employee_documents").insert(
    emptyToNull({
      employee_id: employeeId,
      ...parsed.data,
      file_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    }),
  );
  if (error) {
    await supabase.storage.from("employee-documents").remove([path]);
    return { error: friendlyError(error) };
  }
  changed(`/employees/${employeeId}`, "/profile");
  return { ok: true, message: "Document uploaded." };
}

export async function deleteDocument(id: string) {
  const session = await requireSession();
  if (!session.isHR) throw new Error("Only HR can delete documents.");
  const supabase = await createClient();
  const { data: doc, error } = await supabase.from("employee_documents").delete().eq("id", id).select("file_path, employee_id").single();
  if (error) throw new Error(friendlyError(error));
  await supabase.storage.from("employee-documents").remove([doc.file_path]);
  changed(`/employees/${doc.employee_id}`, "/profile");
}

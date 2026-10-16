"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { Option } from "./employee-form";
import {
  addDependent,
  addEmergencyContact,
  addHistory,
  allocateLeave,
  savePrivate,
  uploadDocument,
} from "./actions";

const grid = "grid gap-3 sm:grid-cols-2";

export function PrivateForm({ employeeId, values }: { employeeId: string; values: Record<string, string | null> }) {
  const v = (k: string) => values[k] ?? "";
  return (
    <ActionForm action={savePrivate.bind(null, employeeId)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="CNIC" name="cnic">
          <Input id="cnic" name="cnic" defaultValue={v("cnic")} placeholder="35202-1234567-1" pattern="\d{5}-\d{7}-\d" />
        </Field>
        <Field label="NTN" name="ntn">
          <Input id="ntn" name="ntn" defaultValue={v("ntn")} />
        </Field>
        <Field label="EOBI no." name="eobi_number">
          <Input id="eobi_number" name="eobi_number" defaultValue={v("eobi_number")} />
        </Field>
        <Field label="PESSI no." name="pessi_number">
          <Input id="pessi_number" name="pessi_number" defaultValue={v("pessi_number")} />
        </Field>
        <Field label="PF no." name="pf_number">
          <Input id="pf_number" name="pf_number" defaultValue={v("pf_number")} />
        </Field>
        <Field label="Bank" name="bank_name">
          <Input id="bank_name" name="bank_name" defaultValue={v("bank_name")} />
        </Field>
        <Field label="Branch" name="bank_branch">
          <Input id="bank_branch" name="bank_branch" defaultValue={v("bank_branch")} />
        </Field>
        <Field label="Account title" name="account_title">
          <Input id="account_title" name="account_title" defaultValue={v("account_title")} />
        </Field>
        <Field label="Account number" name="account_number">
          <Input id="account_number" name="account_number" defaultValue={v("account_number")} />
        </Field>
        <Field label="IBAN" name="iban" className="sm:col-span-2">
          <Input id="iban" name="iban" defaultValue={v("iban")} placeholder="PK36SCBL0000001123456702" />
        </Field>
      </div>
      <SubmitButton size="sm">Save restricted details</SubmitButton>
    </ActionForm>
  );
}

export function AllocateForm({ employeeId, types }: { employeeId: string; types: (Option & { days: number })[] }) {
  return (
    <ActionForm action={allocateLeave.bind(null, employeeId)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Leave type" name="a_type" className="sm:col-span-2">
          <Select id="a_type" name="leave_type_id" required defaultValue="">
            <option value="" disabled>
              Select…
            </option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} ({t.days}/yr)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Year" name="a_year">
          <Input id="a_year" name="year" type="number" defaultValue={new Date().getFullYear()} required />
        </Field>
        <Field label="Days" name="a_days">
          <Input id="a_days" name="allocated" type="number" step="0.5" min={0} required />
        </Field>
        <Field label="Carried forward" name="a_cf">
          <Input id="a_cf" name="carried_forward" type="number" step="0.5" min={0} defaultValue={0} />
        </Field>
      </div>
      <SubmitButton size="sm">Save balance</SubmitButton>
    </ActionForm>
  );
}

export function HistoryForm({ employeeId, departments, positions }: { employeeId: string; departments: Option[]; positions: Option[] }) {
  return (
    <ActionForm action={addHistory.bind(null, employeeId)} resetOnSuccess className="space-y-3">
      <div className={grid}>
        <Field label="Change" name="h_type">
          <Select id="h_type" name="change_type" defaultValue="promotion">
            <option value="promotion">Promotion</option>
            <option value="transfer">Transfer</option>
            <option value="increment">Increment</option>
            <option value="confirmation">Confirmation</option>
            <option value="contract_renewal">Contract renewal</option>
            <option value="status_change">Status change</option>
            <option value="exit">Exit</option>
          </Select>
        </Field>
        <Field label="Effective date" name="h_date">
          <Input id="h_date" name="effective_date" type="date" required />
        </Field>
        <Field label="New department" name="h_dept">
          <Select id="h_dept" name="to_department_id" defaultValue="">
            <option value="">— Unchanged —</option>
            {departments.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="New position" name="h_pos">
          <Select id="h_pos" name="to_position_id" defaultValue="">
            <option value="">— Unchanged —</option>
            {positions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" name="h_notes" className="sm:col-span-2">
          <Textarea id="h_notes" name="notes" rows={2} maxLength={500} />
        </Field>
      </div>
      <SubmitButton size="sm">Record change</SubmitButton>
    </ActionForm>
  );
}

export function DependentForm({ employeeId }: { employeeId: string }) {
  return (
    <ActionForm action={addDependent.bind(null, employeeId)} resetOnSuccess className="space-y-3">
      <div className={grid}>
        <Field label="Name" name="dep_name">
          <Input id="dep_name" name="name" required />
        </Field>
        <Field label="Relationship" name="dep_rel">
          <Select id="dep_rel" name="relationship" defaultValue="spouse">
            {["spouse", "son", "daughter", "father", "mother", "other"].map((r) => (
              <option key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date of birth" name="dep_dob">
          <Input id="dep_dob" name="date_of_birth" type="date" />
        </Field>
        <Field label="CNIC / B-Form" name="dep_cnic">
          <Input id="dep_cnic" name="cnic_or_bform" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="is_nominee" className="rounded border-gray-300" /> Nominee
        </label>
        <Field label="Nominee share %" name="dep_share">
          <Input id="dep_share" name="nominee_share" type="number" min={0} max={100} step="0.01" />
        </Field>
      </div>
      <SubmitButton size="sm">Add dependent</SubmitButton>
    </ActionForm>
  );
}

export function EmergencyForm({ employeeId }: { employeeId: string }) {
  return (
    <ActionForm action={addEmergencyContact.bind(null, employeeId)} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" name="ec_name">
          <Input id="ec_name" name="name" required />
        </Field>
        <Field label="Relationship" name="ec_rel">
          <Input id="ec_rel" name="relationship" required placeholder="e.g. Brother" />
        </Field>
        <Field label="Phone" name="ec_phone">
          <Input id="ec_phone" name="phone" required />
        </Field>
      </div>
      <SubmitButton size="sm">Add contact</SubmitButton>
    </ActionForm>
  );
}

export function UploadForm({ employeeId }: { employeeId: string }) {
  return (
    <ActionForm action={uploadDocument.bind(null, employeeId)} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Type" name="doc_type">
          <Select id="doc_type" name="doc_type" defaultValue="cnic">
            <option value="cnic">CNIC</option>
            <option value="degree">Degree</option>
            <option value="experience_letter">Experience letter</option>
            <option value="contract">Contract</option>
            <option value="offer_letter">Offer letter</option>
            <option value="photo">Photo</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Title" name="doc_title">
          <Input id="doc_title" name="title" required placeholder="e.g. CNIC front & back" />
        </Field>
        <Field label="Expiry (optional)" name="doc_exp">
          <Input id="doc_exp" name="expiry_date" type="date" />
        </Field>
      </div>
      <Field label="File (PDF, JPG, PNG — max 4 MB)" name="file">
        <Input id="file" name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="py-1.5" />
      </Field>
      <SubmitButton size="sm">Upload</SubmitButton>
    </ActionForm>
  );
}

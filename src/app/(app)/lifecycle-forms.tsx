"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import * as A from "./lifecycle-actions";

type Option = { id: string; label: string };
const Opts = ({ items, placeholder }: { items: Option[]; placeholder?: string }) => (
  <>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {items.map((o) => (
      <option key={o.id} value={o.id}>
        {o.label}
      </option>
    ))}
  </>
);
const CONDITIONS = ["new", "good", "fair", "poor", "damaged"];

export function AssetForm({ locations }: { locations: Option[] }) {
  return (
    <ActionForm action={A.addAsset} resetOnSuccess className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Asset tag" name="as_tag">
          <Input id="as_tag" name="asset_tag" required placeholder="AEG-LAP-0012" />
        </Field>
        <Field label="Category" name="as_cat">
          <Select id="as_cat" name="category" defaultValue="laptop">
            {["laptop", "desktop", "phone", "tablet", "vehicle", "furniture", "equipment", "other"].map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name / model" name="as_name" className="col-span-2">
          <Input id="as_name" name="name" required placeholder="Dell Latitude 5440" />
        </Field>
        <Field label="Serial no." name="as_sn">
          <Input id="as_sn" name="serial_number" />
        </Field>
        <Field label="Location" name="as_loc">
          <Select id="as_loc" name="location_id" defaultValue="">
            <Opts items={locations} placeholder="—" />
          </Select>
        </Field>
        <Field label="Purchased" name="as_pd">
          <Input id="as_pd" name="purchase_date" type="date" />
        </Field>
        <Field label="Cost (PKR)" name="as_cost">
          <Input id="as_cost" name="purchase_cost" type="number" min={0} />
        </Field>
        <Field label="Condition" name="as_cond">
          <Select id="as_cond" name="condition" defaultValue="new">
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <SubmitButton size="sm">Add asset</SubmitButton>
    </ActionForm>
  );
}

export function IssueForm({ assetId, people, transfer = false }: { assetId: string; people: Option[]; transfer?: boolean }) {
  return (
    <ActionForm action={(transfer ? A.transferAsset : A.issueAsset).bind(null, assetId)} className="flex gap-1">
      <Select name="employee_id" required defaultValue="" className="w-44 py-1 text-xs">
        <Opts items={people} placeholder={transfer ? "Transfer to…" : "Issue to…"} />
      </Select>
      <SubmitButton size="sm" variant="secondary">
        {transfer ? "Transfer" : "Issue"}
      </SubmitButton>
    </ActionForm>
  );
}

export function ReturnForm({ assetId }: { assetId: string }) {
  return (
    <ActionForm action={A.returnAsset.bind(null, assetId)} className="flex gap-1">
      <Select name="condition" defaultValue="good" className="w-28 py-1 text-xs" aria-label="Condition on return">
        {[...CONDITIONS, "lost"].map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <SubmitButton size="sm" variant="secondary">
        Receive
      </SubmitButton>
    </ActionForm>
  );
}

export function PlanForm() {
  return (
    <ActionForm action={A.addPlan} resetOnSuccess className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" name="bp_code">
          <Input id="bp_code" name="code" required placeholder="OPD" />
        </Field>
        <Field label="Type" name="bp_type">
          <Select id="bp_type" name="plan_type" defaultValue="health">
            {["health", "life", "retirement", "transport", "meal", "other"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" name="bp_name" className="col-span-2">
          <Input id="bp_name" name="name" required />
        </Field>
        <Field label="Provider" name="bp_prov">
          <Input id="bp_prov" name="provider" />
        </Field>
        <Field label="Max dependents" name="bp_dep">
          <Input id="bp_dep" name="max_dependents" type="number" min={0} defaultValue={0} />
        </Field>
        <Field label="Employee pays / month" name="bp_ee">
          <Input id="bp_ee" name="employee_contribution" type="number" min={0} defaultValue={0} />
        </Field>
        <Field label="Company pays / month" name="bp_er">
          <Input id="bp_er" name="employer_contribution" type="number" min={0} defaultValue={0} />
        </Field>
        <Field label="Min. service (months)" name="bp_ten">
          <Input id="bp_ten" name="min_tenure_months" type="number" min={0} defaultValue={0} />
        </Field>
        <Field label="Grades (comma list, blank = all)" name="bp_gr">
          <Input id="bp_gr" name="eligible_grades" placeholder="M1, M2" />
        </Field>
      </div>
      <Field label="Description" name="bp_desc">
        <Textarea id="bp_desc" name="description" rows={2} />
      </Field>
      <SubmitButton size="sm">Add plan</SubmitButton>
    </ActionForm>
  );
}

export function EnrollForm({ planId, employeeId, dependents, people, maxDependents }: { planId: string; employeeId: string | null; dependents: Option[]; people?: Option[]; maxDependents: number }) {
  return (
    <ActionForm action={A.enroll.bind(null, planId, employeeId)} className="space-y-2">
      {people && (
        <Select name="employee_id" required defaultValue="" className="py-1.5 text-xs">
          <Opts items={people} placeholder="Employee…" />
        </Select>
      )}
      {maxDependents > 0 && dependents.length > 0 && (
        <fieldset className="text-xs">
          <legend className="mb-1 text-gray-600">Cover dependents (max {maxDependents})</legend>
          {dependents.map((d) => (
            <label key={d.id} className="mr-3 inline-flex items-center gap-1">
              <input type="checkbox" name="dependent_ids" value={d.id} className="rounded border-gray-300" /> {d.label}
            </label>
          ))}
        </fieldset>
      )}
      <SubmitButton size="sm">Enrol</SubmitButton>
    </ActionForm>
  );
}

export function SeparationForm({ people }: { people?: Option[] }) {
  const min = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={A.submitSeparation} className="space-y-3">
      {people && (
        <Field label="Employee" name="sp_emp">
          <Select id="sp_emp" name="employee_id" required defaultValue="">
            <Opts items={people} placeholder="Select…" />
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" name="sp_type">
          <Select id="sp_type" name="separation_type" defaultValue="resignation">
            <option value="resignation">Resignation</option>
            {people && (
              <>
                <option value="termination">Termination</option>
                <option value="retirement">Retirement</option>
                <option value="contract_end">Contract end</option>
                <option value="other">Other</option>
              </>
            )}
          </Select>
        </Field>
        <Field label="Last working day" name="sp_lwd">
          <Input id="sp_lwd" name="last_working_day" type="date" min={min} required />
        </Field>
      </div>
      <Field label="Reason" name="sp_reason">
        <Textarea id="sp_reason" name="reason" required rows={3} />
      </Field>
      <SubmitButton>{people ? "Initiate separation" : "Submit resignation"}</SubmitButton>
    </ActionForm>
  );
}

export function SeparationDecision({ id }: { id: string }) {
  return (
    <ActionForm action={A.decideSeparation.bind(null, id)} className="flex flex-wrap items-center gap-2">
      <Input name="comment" placeholder="Comment (required to reject)" className="w-56 py-1.5 text-xs" />
      <SubmitButton size="sm" variant="success" name="decision" value="approve">
        Approve
      </SubmitButton>
      <SubmitButton size="sm" variant="danger" name="decision" value="reject">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}

export function ClearForm({ itemId, sepId }: { itemId: string; sepId: string }) {
  return (
    <ActionForm action={A.clearItem.bind(null, itemId, sepId)} className="flex gap-1">
      <Input name="notes" placeholder="Note" className="w-40 py-1 text-xs" />
      <SubmitButton size="sm" variant="success">
        Clear
      </SubmitButton>
    </ActionForm>
  );
}

export function CompleteExitForm({ id }: { id: string }) {
  return (
    <ActionForm action={A.completeExit.bind(null, id)} className="space-y-2">
      <Textarea name="exit_interview" rows={3} placeholder="Exit interview notes (reason for leaving, feedback, rehire eligibility)" />
      <SubmitButton variant="success">Complete exit</SubmitButton>
    </ActionForm>
  );
}

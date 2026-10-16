"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import {
  addExpenseItem,
  applyLoan,
  commentTicket,
  createClaim,
  decide,
  payClaim,
  raiseTicket,
  requestTravel,
  submitClaim,
  updateTicket,
} from "./workflow-actions";

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

export function TravelForm() {
  return (
    <ActionForm action={requestTravel} resetOnSuccess className="space-y-3">
      <Field label="Purpose" name="tv_purpose">
        <Input id="tv_purpose" name="purpose" required placeholder="Client meeting / site visit" />
      </Field>
      <Field label="Destination" name="tv_dest">
        <Input id="tv_dest" name="destination" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" name="tv_from">
          <Input id="tv_from" name="start_date" type="date" required />
        </Field>
        <Field label="To" name="tv_to">
          <Input id="tv_to" name="end_date" type="date" required />
        </Field>
        <Field label="Estimated cost" name="tv_est">
          <Input id="tv_est" name="estimated_cost" type="number" min={0} defaultValue={0} />
        </Field>
        <Field label="Advance needed" name="tv_adv">
          <Input id="tv_adv" name="advance_requested" type="number" min={0} defaultValue={0} />
        </Field>
      </div>
      <SubmitButton size="sm">Request travel</SubmitButton>
    </ActionForm>
  );
}

export function NewClaimForm({ trips }: { trips: Option[] }) {
  return (
    <ActionForm action={createClaim} className="space-y-3">
      <Field label="Title" name="cl_title">
        <Input id="cl_title" name="title" required placeholder="e.g. Karachi site visit — Oct" />
      </Field>
      <Field label="Against approved travel (optional)" name="cl_trip" hint="Any travel advance is adjusted automatically.">
        <Select id="cl_trip" name="travel_request_id" defaultValue="">
          <Opts items={trips} placeholder="— None —" />
        </Select>
      </Field>
      <SubmitButton size="sm">Start claim</SubmitButton>
    </ActionForm>
  );
}

export function ExpenseItemForm({ claimId, categories }: { claimId: string; categories: Option[] }) {
  return (
    <ActionForm action={addExpenseItem.bind(null, claimId)} resetOnSuccess className="grid gap-3 sm:grid-cols-5 sm:items-end">
      <Field label="Category" name="ei_cat">
        <Select id="ei_cat" name="category_id" required defaultValue="">
          <Opts items={categories} placeholder="Select…" />
        </Select>
      </Field>
      <Field label="Date" name="ei_date">
        <Input id="ei_date" name="expense_date" type="date" required />
      </Field>
      <Field label="Description" name="ei_desc">
        <Input id="ei_desc" name="description" required maxLength={200} />
      </Field>
      <Field label="Amount (PKR)" name="ei_amt">
        <Input id="ei_amt" name="amount" type="number" min={1} step="0.01" required />
      </Field>
      <Field label="Receipt" name="ei_rcpt">
        <Input id="ei_rcpt" name="receipt" type="file" accept="application/pdf,image/*" className="py-1.5" />
      </Field>
      <div className="sm:col-span-5">
        <SubmitButton size="sm" variant="secondary">
          Add expense
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function SubmitClaimButton({ claimId }: { claimId: string }) {
  return (
    <ActionForm action={submitClaim.bind(null, claimId)}>
      <SubmitButton>Submit for approval</SubmitButton>
    </ActionForm>
  );
}

export function DecideForm({ kind, id, banks, needsBank, loanStart }: { kind: "claim" | "travel" | "loan"; id: string; banks?: Option[]; needsBank?: boolean; loanStart?: boolean }) {
  return (
    <ActionForm action={decide.bind(null, kind, id)} className="flex flex-wrap items-center gap-2">
      {needsBank && banks && (
        <Select name="bank_account_id" className="w-44 py-1.5 text-xs" defaultValue={banks[0]?.id}>
          <Opts items={banks} />
        </Select>
      )}
      {loanStart && <Input name="start_month" type="month" className="w-36 py-1.5 text-xs" aria-label="First deduction month" />}
      <Input name="comment" placeholder="Comment (required to reject)" className="w-48 py-1.5 text-xs" maxLength={300} />
      <SubmitButton size="sm" variant="success" name="decision" value="approve">
        Approve
      </SubmitButton>
      <SubmitButton size="sm" variant="danger" name="decision" value="reject">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}

export function PayClaimForm({ claimId, banks }: { claimId: string; banks: Option[] }) {
  return (
    <ActionForm action={payClaim.bind(null, claimId)} className="flex items-center gap-2">
      <Select name="bank_account_id" className="w-44 py-1.5 text-xs" defaultValue={banks[0]?.id}>
        <Opts items={banks} />
      </Select>
      <SubmitButton size="sm" variant="success">
        Pay
      </SubmitButton>
    </ActionForm>
  );
}

export function LoanApplicationForm() {
  return (
    <ActionForm action={applyLoan} resetOnSuccess className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" name="la_type">
          <Select id="la_type" name="loan_type" defaultValue="loan">
            <option value="loan">Loan</option>
            <option value="advance">Salary advance</option>
          </Select>
        </Field>
        <Field label="Amount (PKR)" name="la_amt">
          <Input id="la_amt" name="amount" type="number" min={1} required />
        </Field>
        <Field label="Repay over (months)" name="la_inst">
          <Input id="la_inst" name="installments" type="number" min={1} max={60} defaultValue={6} required />
        </Field>
      </div>
      <Field label="Purpose" name="la_purpose">
        <Textarea id="la_purpose" name="purpose" required minLength={3} maxLength={300} />
      </Field>
      <SubmitButton size="sm">Apply</SubmitButton>
    </ActionForm>
  );
}

export function TicketForm({ categories }: { categories: Option[] }) {
  return (
    <ActionForm action={raiseTicket} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" name="tk_cat">
          <Select id="tk_cat" name="category_id" required defaultValue="">
            <Opts items={categories} placeholder="Select…" />
          </Select>
        </Field>
        <Field label="Priority" name="tk_pri">
          <Select id="tk_pri" name="priority" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </Field>
      </div>
      <Field label="Subject" name="tk_subj">
        <Input id="tk_subj" name="subject" required minLength={4} maxLength={150} />
      </Field>
      <Field label="Details" name="tk_desc">
        <Textarea id="tk_desc" name="description" rows={4} required minLength={5} />
      </Field>
      <SubmitButton size="sm">Raise ticket</SubmitButton>
    </ActionForm>
  );
}

export function CommentForm({ ticketId, agent }: { ticketId: string; agent: boolean }) {
  return (
    <ActionForm action={commentTicket.bind(null, ticketId)} resetOnSuccess className="space-y-2">
      <Textarea name="body" rows={3} required placeholder="Write a reply…" />
      <div className="flex items-center justify-between">
        {agent ? (
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" name="is_internal" className="rounded border-gray-300" /> Internal note (hidden from requester)
          </label>
        ) : (
          <span />
        )}
        <SubmitButton size="sm">Send</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AgentTicketForm({ ticketId, status, priority, assignee, agents }: { ticketId: string; status: string; priority: string; assignee: string | null; agents: Option[] }) {
  return (
    <ActionForm action={updateTicket.bind(null, ticketId)} className="space-y-3">
      <Field label="Status" name="at_status">
        <Select id="at_status" name="status" defaultValue={status}>
          {["open", "in_progress", "pending", "resolved", "closed"].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Priority" name="at_pri">
        <Select id="at_pri" name="priority" defaultValue={priority}>
          {["low", "medium", "high", "critical"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Assignee" name="at_asg">
        <Select id="at_asg" name="assignee_id" defaultValue={assignee ?? ""}>
          <Opts items={agents} placeholder="— Unassigned —" />
        </Select>
      </Field>
      <SubmitButton size="sm">Update</SubmitButton>
    </ActionForm>
  );
}

export function RequesterTicketForm({ ticketId }: { ticketId: string }) {
  return (
    <ActionForm action={updateTicket.bind(null, ticketId)} className="flex flex-wrap items-end gap-2">
      <Field label="Rate the resolution" name="rt_sat">
        <Select id="rt_sat" name="satisfaction" defaultValue="5">
          {[5, 4, 3, 2, 1].map((s) => (
            <option key={s} value={s}>
              {"★".repeat(s)}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton size="sm" variant="success" name="status" value="closed">
        Close ticket
      </SubmitButton>
      <SubmitButton size="sm" variant="secondary" name="status" value="open">
        Not fixed — reopen
      </SubmitButton>
    </ActionForm>
  );
}

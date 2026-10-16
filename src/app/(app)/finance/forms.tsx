"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import {
  addAccount,
  addBankAccount,
  addDocumentLine,
  addParty,
  addTax,
  approveBudget,
  autoMatch,
  createBudget,
  createDocument,
  createJournal,
  createPayment,
  importStatement,
  matchLine,
  openFiscalYear,
  postDocument,
  postJournal,
  postPayment,
  reverseJournal,
  saveReconciliation,
  setBudgetLine,
} from "./actions";

type Option = { id: string; label: string; type?: string };

function Opts({ items, placeholder }: { items: Option[]; placeholder?: string }) {
  return (
    <>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {items.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </>
  );
}

const fmt = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 });

// ---------- Accounts ----------

export function AccountForm({ parents }: { parents: Option[] }) {
  return (
    <ActionForm action={addAccount} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" name="ac_code" hint="4–6 digits, e.g. 5295">
          <Input id="ac_code" name="code" required inputMode="numeric" />
        </Field>
        <Field label="Name" name="ac_name">
          <Input id="ac_name" name="name" required />
        </Field>
        <Field label="Type" name="ac_type">
          <Select id="ac_type" name="account_type" defaultValue="expense">
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="equity">Equity</option>
            <option value="revenue">Revenue</option>
            <option value="expense">Expense</option>
          </Select>
        </Field>
        <Field label="Parent (group)" name="ac_parent">
          <Select id="ac_parent" name="parent_id" defaultValue="">
            <Opts items={parents} placeholder="— None —" />
          </Select>
        </Field>
        <Field label="Cash-flow category" name="ac_cf" className="sm:col-span-2">
          <Select id="ac_cf" name="cash_flow_category" defaultValue="operating">
            <option value="operating">Operating</option>
            <option value="investing">Investing (fixed assets)</option>
            <option value="financing">Financing (loans, capital)</option>
          </Select>
        </Field>
      </div>
      <SubmitButton size="sm">Add account</SubmitButton>
    </ActionForm>
  );
}

// ---------- Manual journal ----------

type JLine = { account_id: string; cost_center_id: string; debit: string; credit: string; description: string };
const blank = (): JLine => ({ account_id: "", cost_center_id: "", debit: "", credit: "", description: "" });

export function JournalForm({ accounts, costCenters, defaultDate }: { accounts: Option[]; costCenters: Option[]; defaultDate: string }) {
  const [lines, setLines] = useState<JLine[]>([blank(), blank()]);
  const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = dr > 0 && Math.round(dr * 100) === Math.round(cr * 100);
  const payload = useMemo(
    () =>
      JSON.stringify(
        lines
          .filter((l) => l.account_id)
          .map((l) => ({ ...l, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      ),
    [lines],
  );
  const set = (i: number, k: keyof JLine, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <ActionForm action={createJournal} className="space-y-4">
      <input type="hidden" name="lines" value={payload} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Date" name="je_date">
          <Input id="je_date" name="entry_date" type="date" required defaultValue={defaultDate} />
        </Field>
        <Field label="Description" name="je_desc" className="sm:col-span-3">
          <Input id="je_desc" name="description" required maxLength={300} placeholder="e.g. Accrue October electricity" />
        </Field>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs text-gray-500">
            <tr>
              <th className="py-1 pr-2 text-left font-medium">Account</th>
              <th className="py-1 pr-2 text-left font-medium">Cost center</th>
              <th className="py-1 pr-2 text-left font-medium">Narration</th>
              <th className="w-32 py-1 pr-2 text-right font-medium">Debit</th>
              <th className="w-32 py-1 pr-2 text-right font-medium">Credit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <Select value={l.account_id} onChange={(e) => set(i, "account_id", e.target.value)} className="min-w-56 py-1.5">
                    <Opts items={accounts} placeholder="Select…" />
                  </Select>
                </td>
                <td className="py-1 pr-2">
                  <Select value={l.cost_center_id} onChange={(e) => set(i, "cost_center_id", e.target.value)} className="py-1.5">
                    <Opts items={costCenters} placeholder="—" />
                  </Select>
                </td>
                <td className="py-1 pr-2">
                  <Input value={l.description} onChange={(e) => set(i, "description", e.target.value)} className="py-1.5" maxLength={200} />
                </td>
                <td className="py-1 pr-2">
                  <Input type="number" min={0} step="0.01" value={l.debit} onChange={(e) => set(i, "debit", e.target.value)} className="py-1.5 text-right" />
                </td>
                <td className="py-1 pr-2">
                  <Input type="number" min={0} step="0.01" value={l.credit} onChange={(e) => set(i, "credit", e.target.value)} className="py-1.5 text-right" />
                </td>
                <td className="py-1">
                  {lines.length > 2 && (
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-xs text-gray-400 hover:text-red-600">
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-semibold">
              <td colSpan={3} className="py-2">
                <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className={buttonClass("secondary", "sm")}>
                  + Line
                </button>
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmt.format(dr)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmt.format(cr)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className={`text-sm ${balanced ? "text-emerald-700" : "text-amber-700"}`}>
        {balanced ? "Balanced." : `Out of balance by ${fmt.format(Math.abs(dr - cr))}.`} Saved as a draft — another Finance user posts it.
      </p>
      <SubmitButton>Save draft</SubmitButton>
    </ActionForm>
  );
}

export function PostJournalButton({ id }: { id: string }) {
  return (
    <ActionForm action={postJournal.bind(null, id)}>
      <SubmitButton variant="success">Post journal</SubmitButton>
    </ActionForm>
  );
}

export function ReverseJournalForm({ id, defaultDate }: { id: string; defaultDate: string }) {
  return (
    <ActionForm action={reverseJournal.bind(null, id)} className="flex flex-wrap items-end gap-2">
      <Field label="Reversal date" name="rv_date">
        <Input id="rv_date" name="date" type="date" required defaultValue={defaultDate} />
      </Field>
      <Field label="Reason" name="rv_reason">
        <Input id="rv_reason" name="reason" required className="w-64" maxLength={200} />
      </Field>
      <SubmitButton variant="danger">Reverse</SubmitButton>
    </ActionForm>
  );
}

// ---------- Parties ----------

export function PartyForm({ kind, whtTaxes = [] }: { kind: "vendors" | "customers"; whtTaxes?: Option[] }) {
  return (
    <ActionForm action={addParty.bind(null, kind)} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" name="pt_code">
          <Input id="pt_code" name="code" required placeholder={kind === "vendors" ? "V-001" : "C-001"} />
        </Field>
        <Field label="Name" name="pt_name">
          <Input id="pt_name" name="name" required />
        </Field>
        <Field label="NTN" name="pt_ntn">
          <Input id="pt_ntn" name="ntn" />
        </Field>
        <Field label="STRN" name="pt_strn">
          <Input id="pt_strn" name="strn" />
        </Field>
        <Field label="Contact person" name="pt_contact">
          <Input id="pt_contact" name="contact_person" />
        </Field>
        <Field label="Phone" name="pt_phone">
          <Input id="pt_phone" name="phone" />
        </Field>
        <Field label="Email" name="pt_email">
          <Input id="pt_email" name="email" type="email" />
        </Field>
        <Field label="Payment terms (days)" name="pt_terms">
          <Input id="pt_terms" name="payment_terms_days" type="number" min={0} max={365} defaultValue={30} />
        </Field>
        {kind === "vendors" && (
          <Field label="Default withholding tax" name="pt_wht" className="sm:col-span-2">
            <Select id="pt_wht" name="default_wht_tax_id" defaultValue="">
              <Opts items={whtTaxes} placeholder="— None —" />
            </Select>
          </Field>
        )}
        <Field label="Address" name="pt_addr" className="sm:col-span-2">
          <Textarea id="pt_addr" name="address" rows={2} />
        </Field>
      </div>
      <SubmitButton size="sm">Add {kind === "vendors" ? "vendor" : "customer"}</SubmitButton>
    </ActionForm>
  );
}

// ---------- Bills / invoices ----------

export function NewDocumentForm({ kind, parties, defaultDate }: { kind: "bill" | "invoice"; parties: Option[]; defaultDate: string }) {
  return (
    <ActionForm action={createDocument.bind(null, kind)} className="space-y-3">
      <Field label={kind === "bill" ? "Vendor" : "Customer"} name="doc_party">
        <Select id="doc_party" name="party_id" required defaultValue="">
          <Opts items={parties} placeholder="Select…" />
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={kind === "bill" ? "Bill date" : "Invoice date"} name="doc_date">
          <Input id="doc_date" name="doc_date" type="date" required defaultValue={defaultDate} />
        </Field>
        <Field label="Due date" name="doc_due" hint="Blank = payment terms">
          <Input id="doc_due" name="due_date" type="date" />
        </Field>
      </div>
      {kind === "bill" && (
        <Field label="Vendor's invoice no." name="doc_vin">
          <Input id="doc_vin" name="vendor_invoice_no" maxLength={60} />
        </Field>
      )}
      <Field label="Description" name="doc_desc">
        <Input id="doc_desc" name="description" maxLength={300} />
      </Field>
      <SubmitButton size="sm">Create draft</SubmitButton>
    </ActionForm>
  );
}

export function DocumentLineForm({
  kind,
  docId,
  accounts,
  costCenters,
  taxes,
}: {
  kind: "bill" | "invoice";
  docId: string;
  accounts: Option[];
  costCenters: Option[];
  taxes: Option[];
}) {
  return (
    <ActionForm action={addDocumentLine.bind(null, kind, docId)} resetOnSuccess className="grid gap-3 sm:grid-cols-6 sm:items-end">
      <Field label="Account" name="dl_acct" className="sm:col-span-2">
        <Select id="dl_acct" name="account_id" required defaultValue="">
          <Opts items={accounts} placeholder="Select…" />
        </Select>
      </Field>
      <Field label="Description" name="dl_desc">
        <Input id="dl_desc" name="description" maxLength={200} />
      </Field>
      <Field label="Amount (excl. tax)" name="dl_amt">
        <Input id="dl_amt" name="amount" type="number" min={0.01} step="0.01" required />
      </Field>
      <Field label="Sales tax" name="dl_tax">
        <Select id="dl_tax" name="tax_id" defaultValue="">
          <Opts items={taxes} placeholder="None" />
        </Select>
      </Field>
      <Field label="Cost center" name="dl_cc">
        <Select id="dl_cc" name="cost_center_id" defaultValue="">
          <Opts items={costCenters} placeholder="—" />
        </Select>
      </Field>
      <div className="sm:col-span-6">
        <SubmitButton size="sm" variant="secondary">
          Add line
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PostDocumentButton({ kind, docId }: { kind: "bill" | "invoice"; docId: string }) {
  return (
    <ActionForm action={postDocument.bind(null, kind, docId)}>
      <SubmitButton variant="success">Post to ledger</SubmitButton>
    </ActionForm>
  );
}

// ---------- Payments / receipts ----------

type OpenDoc = { id: string; ref: string; date: string; due: string; outstanding: number };

export function NewPaymentForm({
  kind,
  partyId,
  docs,
  banks,
  whtTaxes,
  defaultWht,
  defaultDate,
}: {
  kind: "payment" | "receipt";
  partyId: string;
  docs: OpenDoc[];
  banks: Option[];
  whtTaxes: (Option & { rate?: number })[];
  defaultWht: string | null;
  defaultDate: string;
}) {
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [whtId, setWhtId] = useState(defaultWht ?? "");
  const [whtManual, setWhtManual] = useState<string | null>(null);
  const total = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);
  const rate = whtTaxes.find((t) => t.id === whtId)?.rate ?? 0;
  const whtAuto = Math.round(total * rate) / 100;
  const wht = whtManual !== null ? Number(whtManual) || 0 : kind === "payment" ? whtAuto : 0;

  return (
    <ActionForm action={createPayment.bind(null, kind)} className="space-y-4">
      <input type="hidden" name="party_id" value={partyId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Date" name="py_date">
          <Input id="py_date" name="pay_date" type="date" required defaultValue={defaultDate} />
        </Field>
        <Field label="Bank account" name="py_bank">
          <Select id="py_bank" name="bank_account_id" required defaultValue={banks[0]?.id}>
            <Opts items={banks} />
          </Select>
        </Field>
        <Field label="Cheque / reference" name="py_ref">
          <Input id="py_ref" name="reference" maxLength={60} />
        </Field>
        {kind === "payment" ? (
          <Field label="Withholding tax" name="py_wht">
            <Select id="py_wht" name="wht_tax_id" value={whtId} onChange={(e) => { setWhtId(e.target.value); setWhtManual(null); }}>
              <Opts items={whtTaxes} placeholder="None" />
            </Select>
          </Field>
        ) : (
          <div />
        )}
      </div>
      <table className="min-w-full text-sm">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="py-1 text-left font-medium">{kind === "payment" ? "Bill" : "Invoice"}</th>
            <th className="py-1 text-left font-medium">Date</th>
            <th className="py-1 text-left font-medium">Due</th>
            <th className="py-1 text-right font-medium">Outstanding</th>
            <th className="w-40 py-1 text-right font-medium">Settle now</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-t border-gray-100">
              <td className="py-1.5 font-medium">{d.ref}</td>
              <td className="py-1.5">{d.date}</td>
              <td className="py-1.5">{d.due}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt.format(d.outstanding)}</td>
              <td className="py-1.5 pl-2">
                <div className="flex gap-1">
                  <Input
                    name={`alloc_${d.id}`}
                    type="number"
                    min={0}
                    max={d.outstanding}
                    step="0.01"
                    value={alloc[d.id] ?? ""}
                    onChange={(e) => setAlloc((a) => ({ ...a, [d.id]: e.target.value }))}
                    className="py-1 text-right"
                  />
                  <button type="button" onClick={() => setAlloc((a) => ({ ...a, [d.id]: String(d.outstanding) }))} className="text-xs text-indigo-600">
                    Full
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!docs.length && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-gray-500">
                Nothing outstanding.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="grid gap-3 rounded-lg bg-gray-50 p-3 text-sm sm:grid-cols-3">
        <div>
          Settles: <strong className="tabular-nums">{fmt.format(total)}</strong>
        </div>
        <label className="flex items-center gap-2">
          {kind === "payment" ? "Tax withheld" : "Tax withheld by customer"}:
          <Input
            name="wht_amount"
            type="number"
            min={0}
            step="0.01"
            value={whtManual ?? String(wht)}
            onChange={(e) => setWhtManual(e.target.value)}
            className="w-32 py-1 text-right"
          />
        </label>
        <div>
          {kind === "payment" ? "Bank pays" : "Bank receives"}: <strong className="tabular-nums">{fmt.format(total - wht)}</strong>
        </div>
      </div>
      <SubmitButton>{kind === "payment" ? "Prepare payment" : "Save receipt"}</SubmitButton>
      {kind === "payment" && <p className="text-xs text-gray-500">Payments are released by a second Finance user (maker-checker).</p>}
    </ActionForm>
  );
}

export function PostPaymentButton({ kind, id }: { kind: "payment" | "receipt"; id: string }) {
  return (
    <ActionForm action={postPayment.bind(null, kind, id)}>
      <SubmitButton variant="success">{kind === "payment" ? "Release & post" : "Post receipt"}</SubmitButton>
    </ActionForm>
  );
}

// ---------- Bank ----------

export function BankAccountForm({ glAccounts }: { glAccounts: Option[] }) {
  return (
    <ActionForm action={addBankAccount} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="ba_name">
          <Input id="ba_name" name="name" required placeholder="MCB — Collections" />
        </Field>
        <Field label="Ledger account" name="ba_gl" hint="An asset account not used by another bank">
          <Select id="ba_gl" name="gl_account_id" required defaultValue="">
            <Opts items={glAccounts} placeholder="Select…" />
          </Select>
        </Field>
        <Field label="Bank" name="ba_bank">
          <Input id="ba_bank" name="bank_name" />
        </Field>
        <Field label="Account no." name="ba_no">
          <Input id="ba_no" name="account_number" />
        </Field>
        <Field label="IBAN" name="ba_iban" className="sm:col-span-2">
          <Input id="ba_iban" name="iban" />
        </Field>
      </div>
      <SubmitButton size="sm">Add bank account</SubmitButton>
    </ActionForm>
  );
}

export function ImportStatementForm({ bankId }: { bankId: string }) {
  return (
    <ActionForm action={importStatement.bind(null, bankId)} resetOnSuccess className="space-y-3">
      <Field label="Statement CSV" name="st_file" hint="Header row with Date, Description, Reference and Amount (or Debit + Credit). Dates as YYYY-MM-DD or DD/MM/YYYY.">
        <Input id="st_file" name="file" type="file" accept=".csv,text/csv" className="py-1.5" />
      </Field>
      <Field label="…or paste CSV" name="st_csv">
        <Textarea id="st_csv" name="csv" rows={3} placeholder={"Date,Description,Reference,Amount\n2026-10-03,IBFT from client,RV-12,250000"} />
      </Field>
      <SubmitButton size="sm">Import & auto-match</SubmitButton>
    </ActionForm>
  );
}

export function AutoMatchButton({ bankId }: { bankId: string }) {
  return (
    <ActionForm action={autoMatch.bind(null, bankId)}>
      <SubmitButton size="sm" variant="secondary">
        Auto-match
      </SubmitButton>
    </ActionForm>
  );
}

export function MatchSelect({ stmtId, candidates }: { stmtId: string; candidates: Option[] }) {
  return (
    <ActionForm action={matchLine.bind(null, stmtId)} className="flex gap-1">
      <Select name="line_id" defaultValue="" className="max-w-64 py-1 text-xs">
        <option value="">Match to…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
        <option value="ignore">Ignore (not a book item)</option>
      </Select>
      <SubmitButton size="sm" variant="secondary">
        OK
      </SubmitButton>
    </ActionForm>
  );
}

export function ReconcileForm({ bankId, defaultDate }: { bankId: string; defaultDate: string }) {
  return (
    <ActionForm action={saveReconciliation.bind(null, bankId)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Statement date" name="rc_date">
          <Input id="rc_date" name="as_of" type="date" required defaultValue={defaultDate} />
        </Field>
        <Field label="Closing balance per statement" name="rc_bal">
          <Input id="rc_bal" name="statement_balance" type="number" step="0.01" required />
        </Field>
      </div>
      <Field label="Notes" name="rc_notes">
        <Input id="rc_notes" name="notes" maxLength={300} />
      </Field>
      <SubmitButton size="sm">Reconcile & save</SubmitButton>
    </ActionForm>
  );
}

// ---------- Budgets ----------

export function NewBudgetForm({ defaultFy }: { defaultFy: number }) {
  return (
    <ActionForm action={createBudget} className="flex flex-wrap items-end gap-2">
      <Field label="Fiscal year" name="bd_fy">
        <Input id="bd_fy" name="fiscal_year" type="number" defaultValue={defaultFy} className="w-28" required />
      </Field>
      <Field label="Name" name="bd_name">
        <Input id="bd_name" name="name" defaultValue="Operating budget" required className="w-56" />
      </Field>
      <SubmitButton size="sm">Create budget</SubmitButton>
    </ActionForm>
  );
}

export function BudgetLineForm({ budgetId, fy, accounts, costCenters }: { budgetId: string; fy: number; accounts: Option[]; costCenters: Option[] }) {
  return (
    <ActionForm action={setBudgetLine.bind(null, budgetId, fy)} resetOnSuccess className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <Field label="Account" name="bl_acct" className="sm:col-span-2">
        <Select id="bl_acct" name="account_id" required defaultValue="">
          <Opts items={accounts} placeholder="Select…" />
        </Select>
      </Field>
      <Field label="Cost center" name="bl_cc">
        <Select id="bl_cc" name="cost_center_id" defaultValue="">
          <Opts items={costCenters} placeholder="All" />
        </Select>
      </Field>
      <Field label="Annual amount (0 removes)" name="bl_amt">
        <Input id="bl_amt" name="annual" type="number" min={0} step="1" required />
      </Field>
      <div className="sm:col-span-4">
        <SubmitButton size="sm">Save line</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ApproveBudgetButton({ id }: { id: string }) {
  return (
    <ActionForm action={approveBudget.bind(null, id)}>
      <SubmitButton variant="success">Approve budget</SubmitButton>
    </ActionForm>
  );
}

// ---------- Settings ----------

export function OpenYearForm({ defaultFy }: { defaultFy: number }) {
  return (
    <ActionForm action={openFiscalYear} className="flex items-end gap-2">
      <Field label="Fiscal year (Jul–Jun, by ending year)" name="fy_year">
        <Input id="fy_year" name="fiscal_year" type="number" defaultValue={defaultFy} className="w-32" />
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Open year
      </SubmitButton>
    </ActionForm>
  );
}

export function TaxForm({ accounts }: { accounts: Option[] }) {
  return (
    <ActionForm action={addTax} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" name="tx_code">
          <Input id="tx_code" name="code" required placeholder="WHT-153-SVC" />
        </Field>
        <Field label="Name" name="tx_name">
          <Input id="tx_name" name="name" required placeholder="WHT on services s.153(1)(b)" />
        </Field>
        <Field label="Type" name="tx_type">
          <Select id="tx_type" name="tax_type" defaultValue="wht_payable">
            <option value="wht_payable">Withholding we deduct from vendors</option>
            <option value="wht_receivable">Withholding customers deduct from us</option>
            <option value="gst_output">Sales tax on our invoices (output)</option>
            <option value="gst_input">Sales tax on purchases (input)</option>
          </Select>
        </Field>
        <Field label="Rate %" name="tx_rate">
          <Input id="tx_rate" name="rate_pct" type="number" min={0} max={100} step="0.001" required />
        </Field>
        <Field label="Ledger account" name="tx_acct" className="sm:col-span-2">
          <Select id="tx_acct" name="account_id" required defaultValue="">
            <Opts items={accounts} placeholder="Select…" />
          </Select>
        </Field>
        <Field label="Notes / legal reference" name="tx_notes" className="sm:col-span-2">
          <Input id="tx_notes" name="notes" maxLength={300} />
        </Field>
      </div>
      <SubmitButton size="sm">Add tax</SubmitButton>
    </ActionForm>
  );
}

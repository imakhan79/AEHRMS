"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull, friendlyError } from "@/lib/format";
import type { ActionState } from "@/lib/types";

const uuid = z.uuid();
const optUuid = z.union([z.uuid(), z.literal("")]).optional();
const money = z.coerce.number().positive("Enter an amount greater than 0.");
const code = z
  .string()
  .trim()
  .min(1, "Code is required.")
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, "Code: letters, numbers, - and _ only.")
  .transform((s) => s.toUpperCase());

async function finance() {
  const session = await requireSession();
  if (!session.isFinance) throw new Error("Only Finance can do this.");
  return session;
}

function refresh() {
  revalidatePath("/finance", "layout");
}

async function guard<T>(fn: () => Promise<T>): Promise<T | ActionState> {
  try {
    return await fn();
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // let redirect() through
    return { error: (e as Error).message };
  }
}

// ---------- Chart of accounts ----------

export async function addAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const p = z
      .object({
        code: z.string().trim().regex(/^\d{4,6}$/, "Account codes are 4–6 digits."),
        name: z.string().trim().min(2).max(120),
        account_type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
        parent_id: optUuid,
        cash_flow_category: z.enum(["operating", "investing", "financing"]),
      })
      .parse(Object.fromEntries(formData));
    const supabase = await createClient();
    const { error } = await supabase.from("chart_of_accounts").insert(emptyToNull(p));
    if (error) throw new Error(friendlyError(error));
    refresh();
    return { ok: true, message: "Account added." };
  }) as Promise<ActionState>;
}

export async function toggleAccount(id: string, active: boolean) {
  await finance();
  const supabase = await createClient();
  const { error } = await supabase.from("chart_of_accounts").update({ is_active: active }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  refresh();
}

// ---------- Manual journals ----------

const jeSchema = z.object({
  entry_date: z.iso.date("Choose the date."),
  description: z.string().trim().min(3, "Describe the entry.").max(300),
  lines: z
    .array(
      z.object({
        account_id: uuid,
        cost_center_id: z.string().optional(),
        debit: z.number().min(0),
        credit: z.number().min(0),
        description: z.string().max(200).optional(),
      }),
    )
    .min(2, "Add at least two lines."),
});

export async function createJournal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const parsed = jeSchema.safeParse({
      entry_date: formData.get("entry_date"),
      description: formData.get("description"),
      lines: JSON.parse(String(formData.get("lines") || "[]")),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const lines = parsed.data.lines.filter((l) => l.debit > 0 || l.credit > 0);
    if (lines.some((l) => l.debit > 0 && l.credit > 0)) return { error: "A line can't have both a debit and a credit." };
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.round(dr * 100) !== Math.round(cr * 100)) return { error: `Debits (${dr}) and credits (${cr}) must be equal.` };

    const supabase = await createClient();
    const { data: je, error } = await supabase
      .from("journal_entries")
      .insert({ entry_date: parsed.data.entry_date, description: parsed.data.description })
      .select("id")
      .single();
    if (error) throw new Error(friendlyError(error));
    const { error: lErr } = await supabase.from("journal_entry_lines").insert(
      lines.map((l) => ({
        journal_entry_id: je.id,
        account_id: l.account_id,
        cost_center_id: l.cost_center_id || null,
        debit: l.debit,
        credit: l.credit,
        description: l.description || null,
      })),
    );
    if (lErr) {
      await supabase.from("journal_entries").delete().eq("id", je.id);
      throw new Error(friendlyError(lErr));
    }
    refresh();
    redirect(`/finance/journals/${je.id}`);
  }) as Promise<ActionState>;
}

export async function postJournal(id: string, _: ActionState): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_post_manual_journal", { p_id: id });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: "Journal posted." };
}

export async function deleteDraftJournal(id: string) {
  await finance();
  const supabase = await createClient();
  const { error } = await supabase.from("journal_entries").delete().eq("id", id).eq("status", "draft");
  if (error) throw new Error(friendlyError(error));
  refresh();
  redirect("/finance/journals");
}

export async function reverseJournal(id: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const p = z
    .object({ date: z.iso.date("Choose the reversal date."), reason: z.string().trim().min(3, "Give a reason.").max(200) })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fin_reverse_journal", { p_id: id, p_date: p.data.date, p_reason: p.data.reason });
  if (error) return { error: friendlyError(error) };
  refresh();
  redirect(`/finance/journals/${data}`);
}

// ---------- Parties ----------

const partySchema = z.object({
  code,
  name: z.string().trim().min(2, "Name is required.").max(160),
  ntn: z.string().trim().max(20).optional(),
  strn: z.string().trim().max(20).optional(),
  contact_person: z.string().trim().max(100).optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  payment_terms_days: z.coerce.number().int().min(0).max(365),
});

export async function addParty(kind: "vendors" | "customers", _: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const p = partySchema.safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: p.error.issues[0].message };
    const extra = kind === "vendors" ? { default_wht_tax_id: (formData.get("default_wht_tax_id") as string) || null } : {};
    const supabase = await createClient();
    const { error } = await supabase.from(kind).insert({ ...emptyToNull(p.data), ...extra });
    if (error) throw new Error(friendlyError(error));
    refresh();
    return { ok: true, message: `${kind === "vendors" ? "Vendor" : "Customer"} added.` };
  }) as Promise<ActionState>;
}

// ---------- Bills / invoices ----------

type DocKind = "bill" | "invoice";
const DOC = {
  bill: { table: "bills", lines: "bill_lines", fk: "bill_id", party: "vendor_id", date: "bill_date", rpc: "fin_post_bill", path: "/finance/payables/bills" },
  invoice: { table: "invoices", lines: "invoice_lines", fk: "invoice_id", party: "customer_id", date: "invoice_date", rpc: "fin_post_invoice", path: "/finance/receivables/invoices" },
} as const;

export async function createDocument(kind: DocKind, _: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const d = DOC[kind];
    const p = z
      .object({
        party_id: z.uuid("Choose the party."),
        doc_date: z.iso.date("Choose the date."),
        due_date: z.union([z.iso.date(), z.literal("")]).optional(),
        vendor_invoice_no: z.string().trim().max(60).optional(),
        description: z.string().trim().max(300).optional(),
      })
      .safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: p.error.issues[0].message };
    const supabase = await createClient();
    const { data: party } = await supabase
      .from(kind === "bill" ? "vendors" : "customers")
      .select("payment_terms_days")
      .eq("id", p.data.party_id)
      .single();
    const due = p.data.due_date || new Date(Date.parse(p.data.doc_date) + (party?.payment_terms_days ?? 30) * 86400000).toISOString().slice(0, 10);
    const row: Record<string, unknown> = {
      [d.party]: p.data.party_id,
      [d.date]: p.data.doc_date,
      due_date: due,
      description: p.data.description || null,
    };
    if (kind === "bill") row.vendor_invoice_no = p.data.vendor_invoice_no || null;
    const { data, error } = await supabase.from(d.table).insert(row).select("id").single();
    if (error) throw new Error(friendlyError(error));
    refresh();
    redirect(`${d.path}/${data.id}`);
  }) as Promise<ActionState>;
}

export async function addDocumentLine(kind: DocKind, docId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const d = DOC[kind];
    const p = z
      .object({
        account_id: z.uuid("Choose the account."),
        cost_center_id: optUuid,
        description: z.string().trim().max(200).optional(),
        amount: money,
        tax_id: optUuid,
      })
      .safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: p.error.issues[0].message };
    const supabase = await createClient();
    const { error } = await supabase.from(d.lines).insert(emptyToNull({ [d.fk]: docId, ...p.data }));
    if (error) throw new Error(friendlyError(error));
    revalidatePath(`${d.path}/${docId}`);
    return { ok: true, message: "Line added." };
  }) as Promise<ActionState>;
}

export async function removeDocumentLine(kind: DocKind, lineId: string, docId: string) {
  await finance();
  const supabase = await createClient();
  const { error } = await supabase.from(DOC[kind].lines).delete().eq("id", lineId);
  if (error) throw new Error(friendlyError(error));
  revalidatePath(`${DOC[kind].path}/${docId}`);
}

export async function postDocument(kind: DocKind, docId: string, _: ActionState): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc(DOC[kind].rpc, { p_id: docId });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: `${kind === "bill" ? "Bill" : "Invoice"} posted to the ledger.` };
}

export async function deleteDraftDocument(kind: DocKind, docId: string) {
  await finance();
  const supabase = await createClient();
  const { error } = await supabase.from(DOC[kind].table).delete().eq("id", docId).eq("status", "draft");
  if (error) throw new Error(friendlyError(error));
  refresh();
  redirect(kind === "bill" ? "/finance/payables" : "/finance/receivables");
}

// ---------- Payments / receipts ----------

type PayKind = "payment" | "receipt";
const PAY = {
  payment: { table: "vendor_payments", alloc: "payment_allocations", fk: "payment_id", docFk: "bill_id", party: "vendor_id", date: "payment_date", rpc: "fin_post_vendor_payment", path: "/finance/payables/payments" },
  receipt: { table: "customer_receipts", alloc: "receipt_allocations", fk: "receipt_id", docFk: "invoice_id", party: "customer_id", date: "receipt_date", rpc: "fin_post_receipt", path: "/finance/receivables/receipts" },
} as const;

/** Creates a draft payment/receipt with its allocations in one step. */
export async function createPayment(kind: PayKind, _: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const d = PAY[kind];
    const p = z
      .object({
        party_id: z.uuid("Choose the party."),
        pay_date: z.iso.date("Choose the date."),
        bank_account_id: z.uuid("Choose the bank account."),
        wht_tax_id: optUuid,
        wht_amount: z.coerce.number().min(0).default(0),
        reference: z.string().trim().max(60).optional(),
      })
      .safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: p.error.issues[0].message };
    const allocs = [...formData.entries()]
      .filter(([k, v]) => k.startsWith("alloc_") && Number(v) > 0)
      .map(([k, v]) => ({ doc_id: k.slice(6), amount: Math.round(Number(v) * 100) / 100 }));
    if (!allocs.length) return { error: "Enter the amount to settle against at least one document." };
    const amount = allocs.reduce((s, a) => s + a.amount, 0);
    if (p.data.wht_amount >= amount) return { error: "Withholding can't be the whole amount." };

    const supabase = await createClient();
    const row: Record<string, unknown> = {
      [d.party]: p.data.party_id,
      [d.date]: p.data.pay_date,
      bank_account_id: p.data.bank_account_id,
      amount,
      wht_amount: p.data.wht_amount,
      reference: p.data.reference || null,
    };
    if (kind === "payment") row.wht_tax_id = p.data.wht_tax_id || null;
    const { data, error } = await supabase.from(d.table).insert(row).select("id").single();
    if (error) throw new Error(friendlyError(error));
    const { error: aErr } = await supabase
      .from(d.alloc)
      .insert(allocs.map((a) => ({ [d.fk]: data.id, [d.docFk]: a.doc_id, amount: a.amount })));
    if (aErr) {
      await supabase.from(d.table).delete().eq("id", data.id);
      throw new Error(friendlyError(aErr));
    }
    refresh();
    redirect(`${d.path}/${data.id}`);
  }) as Promise<ActionState>;
}

export async function postPayment(kind: PayKind, id: string, _: ActionState): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc(PAY[kind].rpc, { p_id: id });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: kind === "payment" ? "Payment released and posted." : "Receipt posted." };
}

export async function deleteDraftPayment(kind: PayKind, id: string) {
  await finance();
  const supabase = await createClient();
  const { error } = await supabase.from(PAY[kind].table).delete().eq("id", id).eq("status", "draft");
  if (error) throw new Error(friendlyError(error));
  refresh();
  redirect(kind === "payment" ? "/finance/payables" : "/finance/receivables");
}

// ---------- Bank ----------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

function toIsoDate(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/YYYY (Pakistani bank exports)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

const num = (s: string | undefined) => (s ? Number(s.replace(/[,\s]/g, "").replace(/^\((.*)\)$/, "-$1")) || 0 : 0);

/** CSV with a header row: Date, Description, Reference, and either Amount or Debit/Credit (or Withdrawal/Deposit). */
export async function importStatement(bankId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const file = formData.get("file");
    const text = file instanceof File && file.size ? await file.text() : String(formData.get("csv") ?? "");
    if (!text.trim()) return { error: "Upload a CSV file or paste the statement." };
    if (text.length > 2_000_000) return { error: "The statement is too large (max ~2 MB)." };
    const rows = parseCsv(text);
    const header = rows.shift()?.map((h) => h.toLowerCase()) ?? [];
    const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const iDate = col("date");
    const iDesc = col("description", "narration", "particular", "details");
    const iRef = col("reference", "ref", "cheque", "chq");
    const iAmt = col("amount");
    const iDr = col("debit", "withdrawal");
    const iCr = col("credit", "deposit");
    if (iDate < 0 || (iAmt < 0 && (iDr < 0 || iCr < 0))) {
      return { error: "Header must include Date and either Amount or Debit + Credit columns." };
    }
    const batch = crypto.randomUUID();
    const lines = [];
    for (const r of rows) {
      const date = toIsoDate(r[iDate] ?? "");
      const amount = iAmt >= 0 ? num(r[iAmt]) : num(r[iCr]) - num(r[iDr]);
      if (!date || !amount) continue;
      lines.push({
        bank_account_id: bankId,
        txn_date: date,
        description: (iDesc >= 0 ? r[iDesc] : "")?.slice(0, 300) ?? "",
        reference: (iRef >= 0 ? r[iRef] : "")?.slice(0, 100) ?? "",
        amount: Math.round(amount * 100) / 100,
        import_batch: batch,
      });
    }
    if (!lines.length) return { error: "No transactions found in the file." };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("bank_statement_lines")
      .upsert(lines, { onConflict: "bank_account_id,txn_date,amount,reference,description", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(friendlyError(error));
    const { data: matched } = await supabase.rpc("fin_auto_match", { p_bank: bankId });
    revalidatePath("/finance/bank");
    return {
      ok: true,
      message: `Imported ${data?.length ?? 0} new line(s) (${lines.length - (data?.length ?? 0)} duplicates skipped); auto-matched ${matched ?? 0}.`,
    };
  }) as Promise<ActionState>;
}

export async function autoMatch(bankId: string, _: ActionState): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fin_auto_match", { p_bank: bankId });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/finance/bank");
  return { ok: true, message: `Matched ${data} line(s).` };
}

export async function matchLine(stmtId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const lineId = String(formData.get("line_id") ?? "");
  const supabase = await createClient();
  const { error } = lineId === "ignore"
    ? await supabase.rpc("fin_ignore_statement_line", { p_stmt: stmtId, p_ignore: true })
    : await supabase.rpc("fin_match_statement_line", { p_stmt: stmtId, p_line: lineId || null });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/finance/bank");
  return { ok: true };
}

export async function unmatchLine(stmtId: string) {
  await requireSession();
  const supabase = await createClient();
  await supabase.rpc("fin_match_statement_line", { p_stmt: stmtId, p_line: null });
  await supabase.rpc("fin_ignore_statement_line", { p_stmt: stmtId, p_ignore: false });
  revalidatePath("/finance/bank");
}

export async function saveReconciliation(bankId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const p = z
      .object({ as_of: z.iso.date(), statement_balance: z.coerce.number(), notes: z.string().trim().max(300).optional() })
      .safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: "Enter the statement date and closing balance." };
    const supabase = await createClient();
    const { data: s, error } = await supabase.rpc("fin_reconciliation_summary", {
      p_bank: bankId,
      p_as_of: p.data.as_of,
      p_statement_balance: p.data.statement_balance,
    });
    if (error) throw new Error(friendlyError(error));
    const { error: iErr } = await supabase.from("bank_reconciliations").upsert(
      {
        bank_account_id: bankId,
        statement_date: p.data.as_of,
        statement_balance: p.data.statement_balance,
        book_balance: s.book_balance,
        uncleared_book: s.uncleared_book,
        unbooked_bank: s.unbooked_bank,
        difference: s.difference,
        notes: p.data.notes || null,
      },
      { onConflict: "bank_account_id,statement_date" },
    );
    if (iErr) throw new Error(friendlyError(iErr));
    revalidatePath("/finance/bank");
    return {
      ok: Number(s.difference) === 0,
      message: Number(s.difference) === 0 ? "Reconciled — difference is zero. Saved." : undefined,
      error: Number(s.difference) !== 0 ? `Saved, but there's an unexplained difference of ${s.difference}. Match or book the remaining items.` : undefined,
    };
  }) as Promise<ActionState>;
}

export async function addBankAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const p = z
      .object({
        name: z.string().trim().min(2).max(100),
        bank_name: z.string().trim().max(100).optional(),
        account_number: z.string().trim().max(40).optional(),
        iban: z.string().trim().max(34).optional(),
        gl_account_id: z.uuid("Choose the ledger account."),
      })
      .safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: p.error.issues[0].message };
    const supabase = await createClient();
    const { error } = await supabase.from("bank_accounts").insert(emptyToNull(p.data));
    if (error) throw new Error(friendlyError(error));
    refresh();
    return { ok: true, message: "Bank account added." };
  }) as Promise<ActionState>;
}

// ---------- Budgets ----------

export async function createBudget(_: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const p = z
      .object({ fiscal_year: z.coerce.number().int().min(2020).max(2100), name: z.string().trim().min(2).max(100) })
      .safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: "Enter the fiscal year and a name." };
    const supabase = await createClient();
    const { data, error } = await supabase.from("budgets").insert(p.data).select("id").single();
    if (error) throw new Error(friendlyError(error));
    refresh();
    redirect(`/finance/budgets/${data.id}`);
  }) as Promise<ActionState>;
}

/** Annual amount phased evenly over the 12 fiscal months (remainder on June). */
export async function setBudgetLine(budgetId: string, fy: number, _: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const p = z
      .object({ account_id: z.uuid("Choose an account."), cost_center_id: optUuid, annual: z.coerce.number().min(0) })
      .safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: p.error.issues[0].message };
    const monthly = Math.floor((p.data.annual / 12) * 100) / 100;
    const rows = Array.from({ length: 12 }, (_, i) => ({
      budget_id: budgetId,
      account_id: p.data.account_id,
      cost_center_id: p.data.cost_center_id || null,
      period_start: new Date(Date.UTC(fy - 1, 6 + i, 1)).toISOString().slice(0, 10),
      amount: i === 11 ? Math.round((p.data.annual - monthly * 11) * 100) / 100 : monthly,
    }));
    const supabase = await createClient();
    let del = supabase.from("budget_lines").delete().eq("budget_id", budgetId).eq("account_id", p.data.account_id);
    del = p.data.cost_center_id ? del.eq("cost_center_id", p.data.cost_center_id) : del.is("cost_center_id", null);
    const { error: dErr } = await del;
    if (dErr) throw new Error(friendlyError(dErr));
    if (p.data.annual > 0) {
      const { error } = await supabase.from("budget_lines").insert(rows);
      if (error) throw new Error(friendlyError(error));
    }
    revalidatePath(`/finance/budgets/${budgetId}`);
    return { ok: true, message: p.data.annual > 0 ? "Budget line saved (phased monthly)." : "Budget line removed." };
  }) as Promise<ActionState>;
}

export async function approveBudget(id: string, _: ActionState): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_approve_budget", { p_id: id });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: "Budget approved and locked." };
}

// ---------- Settings ----------

export async function setPeriodStatus(period: string, status: "open" | "closed") {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_set_period_status", { p_period: period, p_status: status });
  if (error) throw new Error(friendlyError(error));
  refresh();
}

export async function openFiscalYear(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const fy = Number(formData.get("fiscal_year"));
  if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) return { error: "Enter a fiscal year like 2028." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fin_open_fiscal_year", { p_fy: fy });
  if (error) return { error: friendlyError(error) };
  refresh();
  return { ok: true, message: `Opened ${data} period(s) for FY${fy}.` };
}

export async function addTax(_: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async () => {
    await finance();
    const p = z
      .object({
        code,
        name: z.string().trim().min(2).max(100),
        tax_type: z.enum(["gst_output", "gst_input", "wht_payable", "wht_receivable"]),
        rate_pct: z.coerce.number().min(0).max(100),
        account_id: z.uuid("Choose the ledger account."),
        notes: z.string().trim().max(300).optional(),
      })
      .safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: p.error.issues[0].message };
    const supabase = await createClient();
    const { error } = await supabase.from("taxes").insert(emptyToNull(p.data));
    if (error) throw new Error(friendlyError(error));
    refresh();
    return { ok: true, message: "Tax added." };
  }) as Promise<ActionState>;
}

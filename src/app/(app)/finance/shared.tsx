import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { financeOptions, outstanding, today } from "@/lib/finance";
import { Badge, Card, DescList, Notice, PageHeader, Stat, Table, Td, buttonClass } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { money } from "@/lib/payroll";
import {
  DocumentLineForm,
  NewDocumentForm,
  NewPaymentForm,
  PartyForm,
  PostDocumentButton,
  PostPaymentButton,
} from "./forms";
import { deleteDraftDocument, deleteDraftPayment, removeDocumentLine } from "./actions";

export const CFG = {
  bill: {
    title: "Bill",
    table: "bills",
    lines: "bill_lines",
    fk: "bill_id",
    party: "vendor_id",
    partyTable: "vendors",
    date: "bill_date",
    ref: "reference",
    paid: "amount_paid",
    base: "/finance/payables",
    path: "/finance/payables/bills",
  },
  invoice: {
    title: "Invoice",
    table: "invoices",
    lines: "invoice_lines",
    fk: "invoice_id",
    party: "customer_id",
    partyTable: "customers",
    date: "invoice_date",
    ref: "invoice_no",
    paid: "amount_received",
    base: "/finance/receivables",
    path: "/finance/receivables/invoices",
  },
} as const;

export const PCFG = {
  payment: {
    title: "Payment",
    table: "vendor_payments",
    alloc: "payment_allocations",
    fk: "payment_id",
    docFk: "bill_id",
    doc: "bill",
    party: "vendor_id",
    partyTable: "vendors",
    date: "payment_date",
    no: "payment_no",
    net: "net_paid",
    base: "/finance/payables",
    path: "/finance/payables/payments",
  },
  receipt: {
    title: "Receipt",
    table: "customer_receipts",
    alloc: "receipt_allocations",
    fk: "receipt_id",
    docFk: "invoice_id",
    doc: "invoice",
    party: "customer_id",
    partyTable: "customers",
    date: "receipt_date",
    no: "receipt_no",
    net: "net_received",
    base: "/finance/receivables",
    path: "/finance/receivables/receipts",
  },
} as const;

export async function requireFinanceReader(): Promise<Session> {
  const session = await requireSession();
  if (!session.canReadPayroll) notFound();
  return session;
}

function dueBadge(due: string, open: number) {
  if (open <= 0) return <Badge tone="green">Settled</Badge>;
  return due < today() ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">Open</Badge>;
}

/** AP or AR landing: parties, documents, payments. */
export async function LedgerSidePage({ kind }: { kind: "bill" | "invoice" }) {
  const session = await requireFinanceReader();
  const c = CFG[kind];
  const p = kind === "bill" ? PCFG.payment : PCFG.receipt;
  const supabase = await createClient();
  const [{ data: parties }, { data: docs }, { data: pays }, opts] = await Promise.all([
    supabase.from(c.partyTable).select("*").order("name"),
    supabase.from(c.table).select(`*, party:${c.partyTable}(name)`).order(c.date, { ascending: false }).limit(200),
    supabase.from(p.table).select(`*, party:${p.partyTable}(name)`).order(p.date, { ascending: false }).limit(100),
    financeOptions(),
  ]);
  type Doc = Record<string, string | number | null> & { party: { name: string } | null };
  const list = (docs ?? []) as Doc[];
  const open = list.filter((d) => d.status === "posted").reduce((s, d) => s + outstanding(d.total as number, d[c.paid] as number), 0);
  const overdue = list.filter((d) => d.status === "posted" && outstanding(d.total as number, d[c.paid] as number) > 0 && String(d.due_date) < today());
  const isAp = kind === "bill";

  return (
    <>
      <PageHeader
        title={isAp ? "Accounts payable" : "Accounts receivable"}
        description={isAp ? "Vendor bills, payments and withholding tax." : "Customer invoices, receipts and tax withheld by customers."}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label={isAp ? "Owed to vendors" : "Owed by customers"} value={`PKR ${money(open)}`} />
        <Stat label="Overdue" value={overdue.length} hint={`PKR ${money(overdue.reduce((s, d) => s + outstanding(d.total as number, d[c.paid] as number), 0))}`} />
        <Stat label={isAp ? "Vendors" : "Customers"} value={parties?.length ?? 0} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={isAp ? "Bills" : "Invoices"}>
            <Table head={["Ref", isAp ? "Vendor" : "Customer", "Date", "Due", "Total", "Outstanding", "Status"]} empty="None yet.">
              {list.map((d) => {
                const o = outstanding(d.total as number, d[c.paid] as number);
                return (
                  <tr key={d.id as string}>
                    <Td>
                      <Link href={`${c.path}/${d.id}`} className="font-medium text-indigo-700 hover:underline">
                        {d[c.ref]}
                      </Link>
                      {isAp && d.vendor_invoice_no && <div className="text-xs text-gray-500">{d.vendor_invoice_no}</div>}
                    </Td>
                    <Td>{d.party?.name}</Td>
                    <Td>{fmtDate(d[c.date] as string)}</Td>
                    <Td>{fmtDate(d.due_date as string)}</Td>
                    <Td className="tabular-nums">{money(d.total)}</Td>
                    <Td className="tabular-nums">{d.status === "posted" ? money(o) : "—"}</Td>
                    <Td>{d.status === "draft" ? <Badge tone="blue">Draft</Badge> : dueBadge(String(d.due_date), o)}</Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
          <Card title={isAp ? "Payments" : "Receipts"}>
            <Table head={["No.", isAp ? "Vendor" : "Customer", "Date", "Amount", "Tax withheld", isAp ? "Paid from bank" : "Received", "Status"]} empty="None yet.">
              {((pays ?? []) as Doc[]).map((x) => (
                <tr key={x.id as string}>
                  <Td>
                    <Link href={`${p.path}/${x.id}`} className="font-medium text-indigo-700 hover:underline">
                      {x[p.no]}
                    </Link>
                  </Td>
                  <Td>{x.party?.name}</Td>
                  <Td>{fmtDate(x[p.date] as string)}</Td>
                  <Td className="tabular-nums">{money(x.amount)}</Td>
                  <Td className="tabular-nums">{money(x.wht_amount)}</Td>
                  <Td className="tabular-nums">{money(x[p.net])}</Td>
                  <Td>{x.status === "draft" ? <Badge tone="amber">Awaiting release</Badge> : <Badge tone="green">Posted</Badge>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          {session.isFinance && (
            <Card title={isAp ? "New bill" : "New invoice"}>
              <NewDocumentForm kind={kind} parties={(parties ?? []).filter((x) => x.is_active).map((x) => ({ id: x.id, label: `${x.name} (${x.code})` }))} defaultDate={today()} />
            </Card>
          )}
          <Card title={isAp ? "Vendors" : "Customers"}>
            <ul className="space-y-2 text-sm">
              {(parties ?? []).map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium text-gray-900">{x.name}</span> <span className="text-xs text-gray-500">{x.code}{x.ntn ? ` · NTN ${x.ntn}` : ""}</span>
                  </span>
                  {session.isFinance && (
                    <Link href={`${c.base}/${isAp ? "pay" : "receive"}/${x.id}`} className="text-xs text-indigo-600 hover:underline">
                      {isAp ? "Pay" : "Receive"}
                    </Link>
                  )}
                </li>
              ))}
              {!parties?.length && <li className="text-gray-500">None yet.</li>}
            </ul>
            {session.isFinance && (
              <details className="mt-4 border-t border-gray-100 pt-3">
                <summary className="cursor-pointer text-xs font-medium text-indigo-700">Add {isAp ? "vendor" : "customer"}</summary>
                <div className="mt-3">
                  <PartyForm kind={isAp ? "vendors" : "customers"} whtTaxes={opts.taxes.filter((t) => t.type === "wht_payable")} />
                </div>
              </details>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/** Bill or invoice detail: lines (editable in draft), post, journal. */
export async function DocumentPage({ kind, id }: { kind: "bill" | "invoice"; id: string }) {
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireFinanceReader();
  const c = CFG[kind];
  const supabase = await createClient();
  const { data: doc } = await supabase.from(c.table).select(`*, party:${c.partyTable}(name, ntn, strn)`).eq("id", id).maybeSingle();
  if (!doc) notFound();
  const [{ data: lines }, opts] = await Promise.all([
    supabase.from(c.lines).select("*, chart_of_accounts(code, name), cost_centers(code), taxes(name)").eq(c.fk, id),
    financeOptions(),
  ]);
  const draft = doc.status === "draft";
  const edit = draft && session.isFinance;
  const o = outstanding(doc.total, doc[c.paid]);
  const isAp = kind === "bill";
  const lineAccounts = opts.accounts.filter((a) => (isAp ? ["expense", "asset"] : ["revenue"]).includes(a.type));
  const taxes = opts.taxes.filter((t) => t.type === (isAp ? "gst_input" : "gst_output"));
  type L = { id: string; description: string | null; amount: number; tax_amount: number; chart_of_accounts: { code: string; name: string } | null; cost_centers: { code: string } | null; taxes: { name: string } | null };

  return (
    <>
      <PageHeader
        title={`${c.title} ${doc[c.ref]}`}
        description={`${doc.party?.name}${doc.party?.ntn ? ` · NTN ${doc.party.ntn}` : ""}`}
        actions={
          <Link href={c.base} className={buttonClass("secondary")}>
            ← Back
          </Link>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Subtotal" value={money(doc.subtotal)} />
        <Stat label="Sales tax" value={money(doc.tax_total)} />
        <Stat label="Total" value={money(doc.total)} />
        <Stat label="Outstanding" value={draft ? "—" : money(o)} hint={draft ? "Draft" : o <= 0 ? "Settled" : `due ${fmtDate(doc.due_date)}`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Lines" className="lg:col-span-2">
          <Table head={["Account", "Description", "Cost center", "Amount", "Tax", ""]} empty="No lines yet.">
            {((lines ?? []) as unknown as L[]).map((l) => (
              <tr key={l.id}>
                <Td>
                  <span className="font-mono text-xs text-gray-500">{l.chart_of_accounts?.code}</span> {l.chart_of_accounts?.name}
                </Td>
                <Td>{l.description ?? "—"}</Td>
                <Td className="text-xs">{l.cost_centers?.code ?? "—"}</Td>
                <Td className="tabular-nums">{money(l.amount)}</Td>
                <Td className="text-xs">{l.taxes ? `${l.taxes.name}: ${money(l.tax_amount)}` : "—"}</Td>
                <Td>
                  {edit && (
                    <form action={removeDocumentLine.bind(null, kind, l.id, id)}>
                      <button className="text-xs text-gray-400 hover:text-red-600">Remove</button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          {edit && (
            <div className="mt-8 border-t border-gray-100 pt-4">
              <DocumentLineForm kind={kind} docId={id} accounts={lineAccounts} costCenters={opts.costCenters} taxes={taxes} />
            </div>
          )}
        </Card>
        <Card title="Details">
          <DescList
            items={[
              ["Status", draft ? <Badge tone="blue">Draft</Badge> : dueBadge(doc.due_date, o)],
              [isAp ? "Bill date" : "Invoice date", fmtDate(doc[c.date])],
              ["Due", fmtDate(doc.due_date)],
              ...(isAp ? ([["Vendor invoice", doc.vendor_invoice_no ?? "—"]] as [string, string][]) : []),
              ["Description", doc.description ?? "—"],
              ["Posted", doc.posted_at ? fmtDateTime(doc.posted_at) : "—"],
            ]}
          />
          {edit && (
            <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
              <PostDocumentButton kind={kind} docId={id} />
              <form action={deleteDraftDocument.bind(null, kind, id)}>
                <button className={buttonClass("danger")}>Delete draft</button>
              </form>
            </div>
          )}
          {!draft && doc.journal_entry_id && (
            <Link href={`/finance/journals/${doc.journal_entry_id}`} className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
              View journal entry →
            </Link>
          )}
        </Card>
      </div>
    </>
  );
}

/** New payment (AP) or receipt (AR) for one party, allocating to open documents. */
export async function PayPartyPage({ kind, partyId }: { kind: "payment" | "receipt"; partyId: string }) {
  if (!z.uuid().safeParse(partyId).success) notFound();
  const session = await requireFinanceReader();
  if (!session.isFinance) notFound();
  const p = PCFG[kind];
  const c = CFG[p.doc];
  const supabase = await createClient();
  const { data: party } = await supabase.from(p.partyTable).select("*").eq("id", partyId).maybeSingle();
  if (!party) notFound();
  const [{ data: docs }, opts, { data: taxRates }] = await Promise.all([
    supabase.from(c.table).select("*").eq(c.party, partyId).eq("status", "posted").order("due_date"),
    financeOptions(),
    supabase.from("taxes").select("id, rate_pct").eq("is_active", true),
  ]);
  const rate = new Map((taxRates ?? []).map((t) => [t.id, Number(t.rate_pct)]));
  const open = (docs ?? [])
    .map((d) => ({ id: d.id, ref: d[c.ref], date: fmtDate(d[c.date]), due: fmtDate(d.due_date), outstanding: outstanding(d.total, d[c.paid]) }))
    .filter((d) => d.outstanding > 0);

  return (
    <>
      <PageHeader
        title={`${kind === "payment" ? "Pay" : "Receive from"} ${party.name}`}
        actions={
          <Link href={p.base} className={buttonClass("secondary")}>
            ← Back
          </Link>
        }
      />
      <Card>
        <NewPaymentForm
          kind={kind}
          partyId={partyId}
          docs={open}
          banks={opts.banks}
          whtTaxes={opts.taxes.filter((t) => t.type === "wht_payable").map((t) => ({ ...t, rate: rate.get(t.id) }))}
          defaultWht={kind === "payment" ? (party.default_wht_tax_id ?? null) : null}
          defaultDate={today()}
        />
      </Card>
    </>
  );
}

export async function PaymentPage({ kind, id }: { kind: "payment" | "receipt"; id: string }) {
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireFinanceReader();
  const p = PCFG[kind];
  const c = CFG[p.doc];
  const supabase = await createClient();
  const { data: pay } = await supabase.from(p.table).select(`*, party:${p.partyTable}(name), bank_accounts(name)`).eq("id", id).maybeSingle();
  if (!pay) notFound();
  const { data: allocs } = await supabase.from(p.alloc).select(`amount, doc:${c.table}(id, ${c.ref})`).eq(p.fk, id);
  const draft = pay.status === "draft";
  const isMaker = pay.created_by === session.userId;
  type A = { amount: number; doc: Record<string, string> | null };

  return (
    <>
      <PageHeader
        title={`${p.title} ${pay[p.no]}`}
        description={pay.party?.name}
        actions={
          <Link href={p.base} className={buttonClass("secondary")}>
            ← Back
          </Link>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Settles" value={money(pay.amount)} />
        <Stat label="Tax withheld" value={money(pay.wht_amount)} />
        <Stat label={kind === "payment" ? "Bank pays" : "Bank receives"} value={money(pay[p.net])} hint={pay.bank_accounts?.name} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Allocated to" className="lg:col-span-2">
          <Table head={[c.title, "Amount"]}>
            {((allocs ?? []) as unknown as A[]).map((a, i) => (
              <tr key={i}>
                <Td>
                  <Link href={`${c.path}/${a.doc?.id}`} className="text-indigo-700 hover:underline">
                    {a.doc?.[c.ref]}
                  </Link>
                </Td>
                <Td className="tabular-nums">{money(a.amount)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Status">
          <DescList
            items={[
              ["Status", draft ? <Badge tone="amber">{kind === "payment" ? "Awaiting release" : "Draft"}</Badge> : <Badge tone="green">Posted</Badge>],
              ["Date", fmtDate(pay[p.date])],
              ["Reference", pay.reference ?? "—"],
              ["Posted", pay.posted_at ? fmtDateTime(pay.posted_at) : "—"],
            ]}
          />
          {draft && session.isFinance && (
            <div className="mt-6 space-y-3 border-t border-gray-100 pt-4">
              {kind === "payment" && isMaker ? (
                <Notice>You prepared this payment — another Finance user must release it.</Notice>
              ) : (
                <PostPaymentButton kind={kind} id={id} />
              )}
              <form action={deleteDraftPayment.bind(null, kind, id)}>
                <button className={buttonClass("danger", "sm")}>Delete draft</button>
              </form>
            </div>
          )}
          {!draft && pay.journal_entry_id && (
            <Link href={`/finance/journals/${pay.journal_entry_id}`} className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
              View journal entry →
            </Link>
          )}
        </Card>
      </div>
    </>
  );
}

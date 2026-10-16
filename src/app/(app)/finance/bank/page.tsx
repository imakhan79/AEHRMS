import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/finance";
import { Badge, Card, PageHeader, Stat, Table, Td, cn } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { money } from "@/lib/payroll";
import { AutoMatchButton, BankAccountForm, ImportStatementForm, MatchSelect, ReconcileForm } from "../forms";
import { unmatchLine } from "../actions";
import { requireFinanceReader } from "../shared";

export const metadata: Metadata = { title: "Bank reconciliation" };

type Unmatched = { line_id: string; entry_date: string; amount: number; description: string; entry_no: string };

export default async function BankPage({ searchParams }: PageProps<"/finance/bank">) {
  const session = await requireFinanceReader();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: banks } = await supabase.from("bank_accounts").select("*, chart_of_accounts(code)").order("name");
  const current = (banks ?? []).find((b) => b.id === sp.account) ?? banks?.[0];
  const t = today();

  if (!current) {
    return (
      <>
        <PageHeader title="Bank reconciliation" />
        <Card>No bank accounts set up.</Card>
      </>
    );
  }

  const [{ data: stmt }, { data: book }, { data: recs }, { data: tb }, { data: glAll }] = await Promise.all([
    supabase.from("bank_statement_lines").select("*").eq("bank_account_id", current.id).order("txn_date", { ascending: false }).limit(300),
    supabase.rpc("fin_unmatched_book_lines", { p_bank: current.id, p_to: "2100-01-01" }),
    supabase.from("bank_reconciliations").select("*").eq("bank_account_id", current.id).order("statement_date", { ascending: false }).limit(12),
    supabase.rpc("trial_balance", { p_as_of: t }),
    supabase.from("chart_of_accounts").select("id, code, name").eq("account_type", "asset").eq("is_postable", true).order("code"),
  ]);
  const unmatchedBook = (book ?? []) as Unmatched[];
  const bookBal = Number(((tb ?? []) as { account_id: string; balance: number }[]).find((r) => r.account_id === current.gl_account_id)?.balance ?? 0);
  const stmtRows = stmt ?? [];
  const usedGl = new Set((banks ?? []).map((b) => b.gl_account_id));

  return (
    <>
      <PageHeader title="Bank reconciliation" description="Import the bank statement, match it to the ledger, and reconcile to zero (FIN-06)." />
      <div className="mb-6 flex flex-wrap gap-2">
        {(banks ?? []).map((b) => (
          <Link
            key={b.id}
            href={`/finance/bank?account=${b.id}`}
            className={cn("rounded-lg px-3 py-1.5 text-sm ring-1", b.id === current.id ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50")}
          >
            {b.name}
          </Link>
        ))}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Book balance (today)" value={money(bookBal)} hint={`GL ${current.chart_of_accounts?.code}`} />
        <Stat label="Statement lines unmatched" value={stmtRows.filter((s) => s.status === "unmatched").length} />
        <Stat label="Ledger items not on statement" value={unmatchedBook.length} hint={money(unmatchedBook.reduce((s, b) => s + Number(b.amount), 0))} />
        <Stat label="Last reconciled" value={recs?.[0] ? fmtDate(recs[0].statement_date) : "Never"} hint={recs?.[0] ? `difference ${money(recs[0].difference)}` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Statement lines" actions={session.isFinance && <AutoMatchButton bankId={current.id} />}>
            <Table head={["Date", "Description", "Reference", "Amount", "Status", ""]} empty="No statement imported yet.">
              {stmtRows.map((s) => {
                const candidates = unmatchedBook
                  .filter((b) => Number(b.amount) === Number(s.amount))
                  .map((b) => ({ id: b.line_id, label: `${b.entry_no} · ${fmtDate(b.entry_date)} · ${b.description.slice(0, 40)}` }));
                return (
                  <tr key={s.id}>
                    <Td>{fmtDate(s.txn_date)}</Td>
                    <Td className="max-w-56 truncate">{s.description}</Td>
                    <Td className="text-xs">{s.reference}</Td>
                    <Td className={cn("tabular-nums", Number(s.amount) < 0 && "text-red-700")}>{money(s.amount)}</Td>
                    <Td>
                      <Badge tone={s.status === "matched" ? "green" : s.status === "ignored" ? "gray" : "amber"}>{s.status}</Badge>
                    </Td>
                    <Td>
                      {session.isFinance &&
                        (s.status === "unmatched" ? (
                          <MatchSelect stmtId={s.id} candidates={candidates} />
                        ) : (
                          <form action={unmatchLine.bind(null, s.id)}>
                            <button className="text-xs text-gray-500 hover:text-indigo-700">Undo</button>
                          </form>
                        ))}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
          <Card title="Ledger items not yet on the statement" description="Uncleared cheques and deposits in transit — or items the bank hasn't processed.">
            <Table head={["Date", "Journal", "Description", "Amount"]} empty="Everything in the ledger is matched.">
              {unmatchedBook.map((b) => (
                <tr key={b.line_id}>
                  <Td>{fmtDate(b.entry_date)}</Td>
                  <Td className="font-mono text-xs">{b.entry_no}</Td>
                  <Td className="max-w-md truncate">{b.description}</Td>
                  <Td className={cn("tabular-nums", Number(b.amount) < 0 && "text-red-700")}>{money(b.amount)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          {session.isFinance && (
            <>
              <Card title="Import statement">
                <ImportStatementForm bankId={current.id} />
              </Card>
              <Card title="Reconcile" description="Statement balance + uncleared ledger items − unbooked bank items must equal the book balance.">
                <ReconcileForm bankId={current.id} defaultDate={t} />
              </Card>
            </>
          )}
          <Card title="Reconciliation history">
            <ul className="space-y-2 text-sm">
              {(recs ?? []).map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span>{fmtDate(r.statement_date)}</span>
                  <span className={Number(r.difference) === 0 ? "text-emerald-700" : "text-red-700"}>
                    {Number(r.difference) === 0 ? "Reconciled" : `Diff ${money(r.difference)}`}
                  </span>
                </li>
              ))}
              {!recs?.length && <li className="text-gray-500">None yet.</li>}
            </ul>
          </Card>
          {session.isFinance && (
            <Card title="Add bank account">
              <BankAccountForm glAccounts={(glAll ?? []).filter((a) => !usedGl.has(a.id)).map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }))} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

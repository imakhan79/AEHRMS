import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Input, PageHeader, Table, Td, buttonClass, cn } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";

export const metadata: Metadata = { title: "General ledger" };

type TB = { account_id: string; code: string; name: string; account_type: string; debit: number; credit: number; balance: number };
type Entry = {
  id: string;
  entry_no: string;
  entry_date: string;
  description: string;
  source: string;
  status: string;
  journal_entry_lines: { debit: number; credit: number; description: string | null; chart_of_accounts: { code: string; name: string } | null }[];
};

/** GL core (FIN-01..03, FIN-07 trial balance). Full finance module (AP, AR, bank rec) is a later phase. */
export default async function LedgerPage({ searchParams }: PageProps<"/finance/ledger">) {
  const session = await requireSession();
  if (!session.canReadPayroll) redirect("/dashboard");
  const sp = await searchParams;
  const asOf = typeof sp.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.as_of) ? sp.as_of : new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const [tb, entries] = await Promise.all([
    supabase.rpc("trial_balance", { p_as_of: asOf }),
    supabase
      .from("journal_entries")
      .select("id, entry_no, entry_date, description, source, status, journal_entry_lines(debit, credit, description, chart_of_accounts(code, name))")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const rows = ((tb.data ?? []) as TB[]).filter((r) => Number(r.debit) || Number(r.credit));
  const totalDr = rows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCr = rows.reduce((s, r) => s + Number(r.credit), 0);

  return (
    <>
      <PageHeader title="General ledger" description="Every payroll, loan and settlement posts here automatically as a balanced journal entry." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card
          title="Trial balance"
          className="lg:col-span-2"
          actions={
            <form className="flex gap-1">
              <Input type="date" name="as_of" defaultValue={asOf} className="py-1 text-xs" />
              <button className={buttonClass("secondary", "sm")}>As of</button>
            </form>
          }
        >
          <Table head={["Account", "Debit", "Credit"]} empty="No postings yet.">
            {rows.map((r) => (
              <tr key={r.account_id}>
                <Td>
                  <span className="font-mono text-xs text-gray-500">{r.code}</span> {r.name}
                </Td>
                <Td className="tabular-nums">{Number(r.debit) > Number(r.credit) ? money(Number(r.debit) - Number(r.credit)) : ""}</Td>
                <Td className="tabular-nums">{Number(r.credit) > Number(r.debit) ? money(Number(r.credit) - Number(r.debit)) : ""}</Td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className={cn("font-semibold", totalDr === totalCr ? "bg-emerald-50" : "bg-red-50")}>
                <Td>{totalDr === totalCr ? "Balanced" : "Out of balance"}</Td>
                <Td className="tabular-nums">{money(rows.reduce((s, r) => s + Math.max(0, Number(r.debit) - Number(r.credit)), 0))}</Td>
                <Td className="tabular-nums">{money(rows.reduce((s, r) => s + Math.max(0, Number(r.credit) - Number(r.debit)), 0))}</Td>
              </tr>
            )}
          </Table>
        </Card>

        <Card title="Recent journal entries" className="lg:col-span-3">
          <div className="space-y-5">
            {((entries.data ?? []) as unknown as Entry[]).map((e) => (
              <div key={e.id} className="rounded-lg border border-gray-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/60 px-3 py-2">
                  <div className="text-sm">
                    <span className="font-mono text-xs text-gray-500">{e.entry_no}</span> <span className="font-medium text-gray-900">{e.description}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {fmtDate(e.entry_date)} · {titleCase(e.source)}
                    <Badge tone={e.status === "posted" ? "green" : "gray"}>{titleCase(e.status)}</Badge>
                  </div>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {e.journal_entry_lines.map((l, i) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className={cn("px-3 py-1.5", Number(l.credit) > 0 && "pl-8")}>
                          <span className="font-mono text-gray-400">{l.chart_of_accounts?.code}</span> {l.chart_of_accounts?.name}
                        </td>
                        <td className="w-28 px-3 py-1.5 text-right tabular-nums">{Number(l.debit) ? money(l.debit) : ""}</td>
                        <td className="w-28 px-3 py-1.5 text-right tabular-nums">{Number(l.credit) ? money(l.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {!entries.data?.length && <p className="text-sm text-gray-500">No journal entries yet.</p>}
          </div>
        </Card>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { financeOptions } from "@/lib/finance";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { fmtDateTime, titleCase } from "@/lib/format";
import { OpenYearForm, TaxForm } from "../forms";
import { setPeriodStatus } from "../actions";
import { requireFinanceReader } from "../shared";

export const metadata: Metadata = { title: "Periods & taxes" };

export default async function FinanceSettingsPage() {
  const session = await requireFinanceReader();
  const supabase = await createClient();
  const [{ data: periods }, { data: taxes }, opts] = await Promise.all([
    supabase.from("fiscal_periods").select("*").order("period_start", { ascending: false }),
    supabase.from("taxes").select("*, chart_of_accounts(code, name)").order("code"),
    financeOptions(),
  ]);
  const years = [...new Set((periods ?? []).map((p) => p.fiscal_year as number))];
  const nextFy = (years[0] ?? new Date().getFullYear()) + 1;
  const monthName = (d: string) => new Intl.DateTimeFormat("en-PK", { month: "short", year: "numeric" }).format(new Date(`${d}T00:00:00`));

  return (
    <>
      <PageHeader title="Periods & taxes" description="Close months to lock them (FIN-11). Only a System Admin can reopen a closed month." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Fiscal periods" actions={session.isFinance && <OpenYearForm defaultFy={nextFy} />}>
          <div className="space-y-6">
            {years.map((fy) => (
              <div key={fy}>
                <div className="mb-2 text-sm font-medium text-gray-900">FY{fy} (Jul {fy - 1} – Jun {fy})</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {(periods ?? [])
                    .filter((p) => p.fiscal_year === fy)
                    .reverse()
                    .map((p) => (
                      <div key={p.period_start} className="rounded-lg border border-gray-200 p-2 text-xs">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-medium text-gray-900">{monthName(p.period_start)}</span>
                          <Badge tone={p.status === "closed" ? "gray" : "green"}>{p.status}</Badge>
                        </div>
                        {session.isFinance && (
                          <form action={setPeriodStatus.bind(null, p.period_start, p.status === "open" ? "closed" : "open")} className="mt-1.5">
                            <button className="text-indigo-700 hover:underline" title={p.closed_at ? `Closed ${fmtDateTime(p.closed_at)}` : undefined}>
                              {p.status === "open" ? "Close" : session.isAdmin ? "Reopen" : ""}
                            </button>
                          </form>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Taxes" description="GST on documents; withholding on vendor payments. Confirm rates with your tax advisor.">
          <Table head={["Code", "Name", "Type", "Rate", "Account"]}>
            {(taxes ?? []).map((t) => (
              <tr key={t.id}>
                <Td className="font-mono text-xs">{t.code}</Td>
                <Td>
                  {t.name}
                  {t.notes && <div className="text-xs text-gray-500">{t.notes}</div>}
                </Td>
                <Td className="text-xs">{titleCase(t.tax_type)}</Td>
                <Td>{Number(t.rate_pct)}%</Td>
                <Td className="text-xs">{t.chart_of_accounts?.code}</Td>
              </tr>
            ))}
          </Table>
          {session.isFinance && (
            <div className="mt-8 border-t border-gray-100 pt-4">
              <TaxForm accounts={opts.accounts.filter((a) => a.type === "asset" || a.type === "liability")} />
            </div>
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-gray-500">Close a month after payroll, bank reconciliation and accruals are done.</p>
    </>
  );
}

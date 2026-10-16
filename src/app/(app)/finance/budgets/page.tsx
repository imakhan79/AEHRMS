import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/finance";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { money } from "@/lib/payroll";
import { NewBudgetForm } from "../forms";
import { requireFinanceReader } from "../shared";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const session = await requireFinanceReader();
  const supabase = await createClient();
  const { data } = await supabase.from("budgets").select("*, budget_lines(amount)").order("fiscal_year", { ascending: false });
  const t = today();
  const fy = Number(t.slice(0, 4)) + (Number(t.slice(5, 7)) >= 7 ? 1 : 0);
  type B = { id: string; fiscal_year: number; name: string; status: string; approved_at: string | null; budget_lines: { amount: number }[] };

  return (
    <>
      <PageHeader title="Budgets" description="Annual budgets by account and cost center, phased monthly. Preparer and approver must differ (FIN-10)." />
      <div className="space-y-6">
        <Card>
          <Table head={["Fiscal year", "Budget", "Total", "Status"]} empty="No budgets yet.">
            {((data ?? []) as B[]).map((b) => (
              <tr key={b.id}>
                <Td>FY{b.fiscal_year}</Td>
                <Td>
                  <Link href={`/finance/budgets/${b.id}`} className="font-medium text-indigo-700 hover:underline">
                    {b.name}
                  </Link>
                </Td>
                <Td className="tabular-nums">{money(b.budget_lines.reduce((s, l) => s + Number(l.amount), 0))}</Td>
                <Td>
                  {b.status === "approved" ? <Badge tone="green">Approved {fmtDate(b.approved_at)}</Badge> : <Badge tone="amber">Draft</Badge>}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        {session.isFinance && (
          <Card title="New budget">
            <NewBudgetForm defaultFy={fy} />
          </Card>
        )}
      </div>
    </>
  );
}

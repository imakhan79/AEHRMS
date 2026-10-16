import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { financeOptions } from "@/lib/finance";
import { Badge, Card, Notice, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { money } from "@/lib/payroll";
import { ApproveBudgetButton, BudgetLineForm } from "../../forms";
import { requireFinanceReader } from "../../shared";

export const metadata: Metadata = { title: "Budget" };

export default async function BudgetPage({ params }: PageProps<"/finance/budgets/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireFinanceReader();
  const supabase = await createClient();
  const { data: b } = await supabase.from("budgets").select("*").eq("id", id).maybeSingle();
  if (!b) notFound();
  const [{ data: lines }, opts] = await Promise.all([
    supabase.from("budget_lines").select("account_id, cost_center_id, amount, chart_of_accounts(code, name, account_type), cost_centers(code)").eq("budget_id", id),
    financeOptions(),
  ]);
  type L = { account_id: string; cost_center_id: string | null; amount: number; chart_of_accounts: { code: string; name: string; account_type: string } | null; cost_centers: { code: string } | null };
  const grouped = new Map<string, { code: string; name: string; type: string; cc: string; total: number }>();
  for (const l of (lines ?? []) as unknown as L[]) {
    const k = `${l.account_id}|${l.cost_center_id ?? ""}`;
    const g = grouped.get(k) ?? { code: l.chart_of_accounts?.code ?? "", name: l.chart_of_accounts?.name ?? "", type: l.chart_of_accounts?.account_type ?? "", cc: l.cost_centers?.code ?? "All", total: 0 };
    g.total += Number(l.amount);
    grouped.set(k, g);
  }
  const rows = [...grouped.values()].sort((a, c) => a.code.localeCompare(c.code));
  const draft = b.status === "draft";

  return (
    <>
      <PageHeader
        title={`FY${b.fiscal_year} — ${b.name}`}
        description={`July ${b.fiscal_year - 1} – June ${b.fiscal_year}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/finance/reports?r=bva&budget=${id}&from=${b.fiscal_year - 1}-07-01&to=${b.fiscal_year}-06-30`} className={buttonClass("secondary")}>
              Budget vs actual
            </Link>
            <Link href="/finance/budgets" className={buttonClass("secondary")}>
              ← Budgets
            </Link>
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Lines (annual)" className="lg:col-span-2">
          <Table head={["Code", "Account", "Type", "Cost center", "Annual", "Monthly"]} empty="No lines yet.">
            {rows.map((r) => (
              <tr key={`${r.code}${r.cc}`}>
                <Td className="font-mono text-xs">{r.code}</Td>
                <Td>{r.name}</Td>
                <Td className="text-xs">{r.type}</Td>
                <Td className="text-xs">{r.cc}</Td>
                <Td className="tabular-nums font-medium">{money(r.total)}</Td>
                <Td className="tabular-nums">{money(r.total / 12)}</Td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="bg-gray-50 font-semibold">
                <Td>Total</Td>
                <Td />
                <Td />
                <Td />
                <Td className="tabular-nums">{money(rows.reduce((s, r) => s + r.total, 0))}</Td>
                <Td />
              </tr>
            )}
          </Table>
          {draft && session.isFinance && (
            <div className="mt-8 border-t border-gray-100 pt-4">
              <BudgetLineForm
                budgetId={id}
                fy={b.fiscal_year}
                accounts={opts.accounts.filter((a) => a.type === "expense" || a.type === "revenue")}
                costCenters={opts.costCenters}
              />
            </div>
          )}
        </Card>
        <Card title="Status">
          {draft ? <Badge tone="amber">Draft</Badge> : <Badge tone="green">Approved — locked</Badge>}
          {draft && session.isFinance && (
            <div className="mt-4">
              {b.created_by === session.userId ? <Notice>You prepared this budget — another Finance user approves it.</Notice> : <ApproveBudgetButton id={id} />}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

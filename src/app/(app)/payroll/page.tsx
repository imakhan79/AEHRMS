import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { money, monthLabel, type PayrollRun } from "@/lib/payroll";
import { CreateRunForm } from "./forms";

export const metadata: Metadata = { title: "Payroll" };

const TONE = { draft: "blue", review: "amber", approved: "green", posted: "green", paid: "gray" } as const;

export default async function PayrollPage() {
  const session = await requireSession();
  if (!session.canReadPayroll) redirect("/dashboard");
  const supabase = await createClient();
  const [{ data: runs }, { count: onPayroll }] = await Promise.all([
    supabase.from("payroll_runs").select("*").order("period_month", { ascending: false }).order("is_parallel"),
    supabase.from("employee_salaries").select("employee_id", { count: "exact", head: true }),
  ]);
  const list = (runs ?? []) as PayrollRun[];
  const latest = list.find((r) => !r.is_parallel && ["posted", "paid"].includes(r.status));
  const thisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()).slice(0, 7);

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly gross-to-net with FBR tax, EOBI, PESSI, PF and VPS. HR prepares, Finance approves and posts."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Salary records" value={onPayroll ?? 0} hint="employees with a salary set" />
        <Stat label="Last posted payroll" value={latest ? monthLabel(latest.period_month) : "—"} hint={latest ? `${latest.employee_count} employees` : undefined} />
        <Stat label="Last net pay" value={latest ? `₨ ${money(latest.total_net)}` : "—"} />
        <Stat label="Last income tax" value={latest ? `₨ ${money(latest.total_tax)}` : "—"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Payroll runs">
            <Table head={["Month", "Status", "Employees", "Gross", "Net", "Tax", "Processed"]} empty="No payroll runs yet.">
              {list.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <Td>
                    <Link href={`/payroll/runs/${r.id}`} className="font-medium text-indigo-700 hover:underline">
                      {monthLabel(r.period_month)}
                    </Link>
                    {r.is_parallel && <span className="ml-2 text-xs text-gray-500">parallel run</span>}
                  </Td>
                  <Td>
                    <Badge tone={TONE[r.status]}>{r.status === "posted" ? "Posted to GL" : r.status[0].toUpperCase() + r.status.slice(1)}</Badge>
                  </Td>
                  <Td className="tabular-nums">{r.employee_count}</Td>
                  <Td className="tabular-nums">{money(r.total_gross)}</Td>
                  <Td className="tabular-nums font-medium text-gray-900">{money(r.total_net)}</Td>
                  <Td className="tabular-nums">{money(r.total_tax)}</Td>
                  <Td className="text-xs">{fmtDateTime(r.processed_at)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          {session.isPayroll && (
            <Card title="New payroll run" description="Uses each employee's salary, attendance, overtime, unpaid leave and loans.">
              <CreateRunForm defaultMonth={thisMonth} />
            </Card>
          )}
          <Card title="Workflow">
            <ol className="space-y-2 text-sm text-gray-600">
              <li><strong className="text-gray-900">1. Draft</strong> — HR/Finance calculate and recalculate freely.</li>
              <li><strong className="text-gray-900">2. Review</strong> — submitted; locked for changes.</li>
              <li><strong className="text-gray-900">3. Approved</strong> — by Finance, not the submitter. Payslips become visible to employees.</li>
              <li><strong className="text-gray-900">4. Posted</strong> — journal entry posted to the GL; loan balances updated.</li>
              <li><strong className="text-gray-900">5. Paid</strong> — after bank disbursement; clears salaries payable.</li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

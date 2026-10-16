import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Notice, PageHeader, Table, Td } from "@/components/ui";
import { money, monthLabel } from "@/lib/payroll";

export const metadata: Metadata = { title: "My payslips" };

/** ESS-03: own payslips, only from approved runs (enforced by RLS). */
export default async function MyPayslipsPage() {
  const session = await requireSession();
  if (!session.employee) {
    return (
      <>
        <PageHeader title="My payslips" />
        <Notice>Your account isn&apos;t linked to an employee record.</Notice>
      </>
    );
  }
  const supabase = await createClient();
  const [{ data }, loans] = await Promise.all([
    // Own payslips; RLS only returns those from approved, non-parallel runs.
    supabase
      .from("payslips")
      .select("id, period_month, gross_pay, total_deductions, net_pay, income_tax")
      .eq("employee_id", session.employee.id)
      .order("period_month", { ascending: false })
      .limit(24),
    supabase.from("loans").select("id, loan_type, principal, installment_amount, balance, status, start_month").eq("employee_id", session.employee.id).order("created_at", { ascending: false }),
  ]);
  type Row = { id: string; period_month: string; gross_pay: number; total_deductions: number; net_pay: number; income_tax: number };
  const rows = (data ?? []) as Row[];

  return (
    <>
      <PageHeader title="My payslips" description="Payslips appear here once Finance approves the month's payroll." />
      <div className="space-y-6">
        <Card>
          <Table head={["Month", "Gross", "Income tax", "Deductions", "Net pay", ""]} empty="No payslips yet.">
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium text-gray-900">{monthLabel(r.period_month)}</Td>
                <Td className="tabular-nums">{money(r.gross_pay)}</Td>
                <Td className="tabular-nums">{money(r.income_tax)}</Td>
                <Td className="tabular-nums">{money(r.total_deductions)}</Td>
                <Td className="tabular-nums font-semibold text-gray-900">{money(r.net_pay)}</Td>
                <Td>
                  <Link href={`/payroll/payslips/${r.id}`} className="text-xs text-indigo-600 hover:underline">
                    View / download
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        {(loans.data?.length ?? 0) > 0 && (
          <Card title="My loans & advances">
            <Table head={["Type", "Amount", "Installment", "Balance", "Status"]}>
              {(loans.data ?? []).map((l) => (
                <tr key={l.id}>
                  <Td>{l.loan_type === "advance" ? "Salary advance" : "Loan"}</Td>
                  <Td className="tabular-nums">{money(l.principal)}</Td>
                  <Td className="tabular-nums">{money(l.installment_amount)}</Td>
                  <Td className="tabular-nums font-semibold">{money(l.balance)}</Td>
                  <Td>{l.status === "active" ? "Active" : "Closed"}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}

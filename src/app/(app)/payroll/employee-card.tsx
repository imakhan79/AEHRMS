import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Table, Td } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { money, monthLabel } from "@/lib/payroll";
import { LoanForm, SalaryForm, type SalaryDefaults } from "./forms";

/** Salary, loans and recent payslips on the employee record (payroll staff only). */
export async function EmployeePayrollCard({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const [salaries, structures, components, loans, slips] = await Promise.all([
    supabase
      .from("employee_salaries")
      .select("*, salary_structures(code, name), employee_salary_components(component_id, value)")
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false }),
    supabase.from("salary_structures").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("salary_components").select("id, name").eq("is_active", true).eq("is_system", false).order("sort_order"),
    supabase.from("loans").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false }),
    supabase.from("payslips").select("id, period_month, gross_pay, net_pay").eq("employee_id", employeeId).order("period_month", { ascending: false }).limit(6),
  ]);
  type Sal = SalaryDefaults & {
    id: string;
    effective_from: string;
    notes: string | null;
    salary_structures: { code: string; name: string } | null;
    employee_salary_components: { component_id: string; value: number }[];
  };
  const history = (salaries.data ?? []) as unknown as Sal[];
  const current = history[0];
  const defaults: SalaryDefaults | null = current
    ? { ...current, extras: Object.fromEntries(current.employee_salary_components.map((c) => [c.component_id, Number(c.value)])) }
    : null;

  return (
    <Card
      title="Salary, loans & payslips"
      description="Visible to HR, Finance, Executives and Auditors."
      actions={
        <Link href="/payroll" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
          Payroll →
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Salary history</h3>
          <Table head={["From", "Basic", "Structure", "Statutory"]} empty="No salary set — this employee won't appear on payroll.">
            {history.map((s) => (
              <tr key={s.id}>
                <Td>{fmtDate(s.effective_from)}</Td>
                <Td className="tabular-nums font-medium">{money(s.basic_salary)}</Td>
                <Td className="text-xs">{s.salary_structures?.code ?? "Basic only"}</Td>
                <Td className="text-xs">
                  {[s.eobi_covered && "EOBI", s.pessi_covered && "PESSI", s.pf_member && `PF ${Number(s.pf_pct)}%`, Number(s.vps_employee_pct) > 0 && "VPS"].filter(Boolean).join(" · ") || "—"}
                </Td>
              </tr>
            ))}
          </Table>
          <h3 className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wide text-gray-500">Loans & advances</h3>
          <div className="pt-5">
            <Table head={["Type", "Amount", "Installment", "Balance", "Status"]} empty="None.">
              {(loans.data ?? []).map((l) => (
                <tr key={l.id}>
                  <Td>{l.loan_type === "advance" ? "Advance" : "Loan"}</Td>
                  <Td className="tabular-nums">{money(l.principal)}</Td>
                  <Td className="tabular-nums">{money(l.installment_amount)}</Td>
                  <Td className="tabular-nums font-medium">{money(l.balance)}</Td>
                  <Td>{l.status === "active" ? `from ${monthLabel(l.start_month)}` : "Closed"}</Td>
                </tr>
              ))}
            </Table>
          </div>
          <h3 className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wide text-gray-500">Recent payslips</h3>
          <div className="pt-5">
            <Table head={["Month", "Gross", "Net", ""]} empty="None yet.">
              {(slips.data ?? []).map((p) => (
                <tr key={p.id}>
                  <Td>{monthLabel(p.period_month)}</Td>
                  <Td className="tabular-nums">{money(p.gross_pay)}</Td>
                  <Td className="tabular-nums font-medium">{money(p.net_pay)}</Td>
                  <Td>
                    <Link href={`/payroll/payslips/${p.id}`} className="text-xs text-indigo-600 hover:underline">
                      View
                    </Link>
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
        {canEdit && (
          <div className="space-y-8">
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{current ? "Revise salary" : "Set salary"}</h3>
              <SalaryForm
                employeeId={employeeId}
                structures={(structures.data ?? []).map((s) => ({ id: s.id, label: s.name }))}
                components={(components.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
                current={defaults}
              />
            </div>
            <div className="border-t border-gray-100 pt-6">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">New loan / advance</h3>
              <LoanForm employeeId={employeeId} />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

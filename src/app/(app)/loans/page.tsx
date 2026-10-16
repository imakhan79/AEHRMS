import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Notice, PageHeader, Table, Td, statusTone } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { money, monthLabel } from "@/lib/payroll";
import { DecideForm, LoanApplicationForm } from "../workflow-forms";
import { cancelRequest } from "../workflow-actions";

export const metadata: Metadata = { title: "Loans & advances" };

type Emp = { id: string; full_name: string; manager_id: string | null; department_id: string | null };
function canDecide(s: Session, e: Emp | null, stage: string) {
  if (!e || e.id === s.employee?.id) return false;
  if (stage === "finance") return s.isFinance;
  return s.isHR || (!!s.employee && e.manager_id === s.employee.id) || (!!e.department_id && s.hodDepartments.includes(e.department_id));
}

export default async function LoansPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const [{ data: mine }, { data: loans }, { data: pending }] = await Promise.all([
    session.employee
      ? supabase.from("loan_applications").select("*").eq("employee_id", session.employee.id).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    session.employee
      ? supabase.from("loans").select("*").eq("employee_id", session.employee.id).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("loan_applications")
      .select("*, employees!loan_applications_employee_id_fkey(id, full_name, manager_id, department_id)")
      .eq("status", "pending")
      .order("created_at"),
  ]);
  const queue = (pending ?? []).filter((a) => canDecide(session, a.employees as Emp, a.stage));

  return (
    <>
      <PageHeader title="Loans & advances" description="Apply online; your manager and Finance approve. Installments are deducted from salary automatically." />
      {queue.length > 0 && (
        <div id="approvals" className="mb-6">
          <Card title={`Awaiting your decision (${queue.length})`}>
            <Table head={["Employee", "Type", "Amount", "Months", "Purpose", "Stage", ""]}>
              {queue.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium text-gray-900">{a.employees?.full_name}</Td>
                  <Td>{a.loan_type === "advance" ? "Advance" : "Loan"}</Td>
                  <Td className="tabular-nums">{money(a.amount)}</Td>
                  <Td>{a.installments}</Td>
                  <Td className="max-w-48 truncate whitespace-normal">{a.purpose}</Td>
                  <Td>{a.stage === "finance" ? "Finance" : "Manager"}</Td>
                  <Td>
                    <DecideForm kind="loan" id={a.id} loanStart={a.stage === "finance"} />
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
      {!session.employee ? (
        <Notice tone="blue">Your account isn&apos;t linked to an employee record, so you can only approve here.</Notice>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card title="My applications">
              <Table head={["Applied", "Type", "Amount", "Months", "Status", ""]} empty="No applications.">
                {(mine ?? []).map((a) => (
                  <tr key={a.id}>
                    <Td>{fmtDate(a.created_at)}</Td>
                    <Td>{a.loan_type === "advance" ? "Advance" : "Loan"}</Td>
                    <Td className="tabular-nums">{money(a.amount)}</Td>
                    <Td>{a.installments}</Td>
                    <Td>
                      <Badge tone={statusTone(a.status)}>{a.status === "pending" ? `With ${a.stage}` : titleCase(a.status)}</Badge>
                      {a.decision_comment && <div className="text-xs text-gray-500">{a.decision_comment}</div>}
                    </Td>
                    <Td>
                      {a.status === "pending" && (
                        <form action={cancelRequest.bind(null, "loan_applications", a.id)}>
                          <button className="text-xs text-gray-500 underline">Cancel</button>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="My loans" actions={<Link href="/payslips" className="text-xs text-indigo-600">Payslips →</Link>}>
              <Table head={["Type", "Amount", "Installment", "Balance", "From", "Status"]} empty="No loans.">
                {(loans ?? []).map((l) => (
                  <tr key={l.id}>
                    <Td>{l.loan_type === "advance" ? "Advance" : "Loan"}</Td>
                    <Td className="tabular-nums">{money(l.principal)}</Td>
                    <Td className="tabular-nums">{money(l.installment_amount)}</Td>
                    <Td className="tabular-nums font-semibold">{money(l.balance)}</Td>
                    <Td>{monthLabel(l.start_month)}</Td>
                    <Td>{l.status === "active" ? "Active" : "Closed"}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
          <Card title="Apply">
            <LoanApplicationForm />
          </Card>
        </div>
      )}
    </>
  );
}

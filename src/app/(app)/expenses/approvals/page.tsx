import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { money } from "@/lib/payroll";
import { DecideForm, PayClaimForm } from "../../workflow-forms";

export const metadata: Metadata = { title: "Expense approvals" };

type Emp = { id: string; full_name: string; employee_code: string; manager_id: string | null; department_id: string | null };

/** Same decision rights as the database: manager/HOD/HR at manager stage, Finance at finance stage. */
function canDecide(s: Session, e: Emp | null, stage: string) {
  if (!e || e.id === s.employee?.id) return false;
  if (stage === "finance") return s.isFinance;
  return s.isHR || (!!s.employee && e.manager_id === s.employee.id) || (!!e.department_id && s.hodDepartments.includes(e.department_id));
}

export default async function ExpenseApprovalsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const emp = "id, full_name, employee_code, manager_id, department_id";
  const [{ data: claims }, { data: trips }, { data: payable }, { data: banks }] = await Promise.all([
    supabase.from("expense_claims").select(`*, employees!expense_claims_employee_id_fkey(${emp})`).eq("status", "submitted").order("submitted_at"),
    supabase.from("travel_requests").select(`*, employees!travel_requests_employee_id_fkey(${emp})`).eq("status", "pending").order("created_at"),
    session.isFinance ? supabase.from("expense_claims").select(`*, employees!expense_claims_employee_id_fkey(${emp})`).eq("status", "approved").order("finance_decided_at") : Promise.resolve({ data: [] }),
    supabase.from("bank_accounts").select("id, name").eq("is_active", true),
  ]);
  const bankOpts = (banks ?? []).map((b) => ({ id: b.id, label: b.name }));
  const myClaims = (claims ?? []).filter((c) => canDecide(session, c.employees as Emp, c.stage));
  const myTrips = (trips ?? []).filter((t) => canDecide(session, t.employees as Emp, t.stage));

  return (
    <>
      <PageHeader title="Expense & travel approvals" />
      <div className="space-y-6">
        <Card title={`Expense claims (${myClaims.length})`}>
          <Table head={["Employee", "Claim", "Total", "Advance adj.", "Stage", ""]} empty="Nothing awaiting you.">
            {myClaims.map((c) => (
              <tr key={c.id}>
                <Td>
                  <div className="font-medium text-gray-900">{c.employees?.full_name}</div>
                  <div className="text-xs text-gray-500">{c.employees?.employee_code}</div>
                </Td>
                <Td>
                  <Link href={`/expenses/${c.id}`} className="text-indigo-700 hover:underline">
                    {c.claim_no}
                  </Link>
                  <div className="text-xs text-gray-500">{c.title}</div>
                </Td>
                <Td className="tabular-nums">{money(c.total)}</Td>
                <Td className="tabular-nums">{money(c.advance_adjusted)}</Td>
                <Td>{c.stage === "finance" ? "Finance verification" : "Manager"}</Td>
                <Td>
                  <DecideForm kind="claim" id={c.id} />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={`Travel requests (${myTrips.length})`}>
          <Table head={["Employee", "Trip", "Dates", "Advance", "Stage", ""]} empty="Nothing awaiting you.">
            {myTrips.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium text-gray-900">{t.employees?.full_name}</Td>
                <Td>
                  {t.destination}
                  <div className="text-xs text-gray-500">{t.purpose}</div>
                </Td>
                <Td>
                  {fmtDate(t.start_date)} – {fmtDate(t.end_date)}
                </Td>
                <Td className="tabular-nums">{money(t.advance_requested)}</Td>
                <Td>{t.stage === "finance" ? "Finance (advance)" : "Manager"}</Td>
                <Td>
                  <DecideForm kind="travel" id={t.id} banks={bankOpts} needsBank={t.stage === "finance" && Number(t.advance_requested) > 0} />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        {session.isFinance && (
          <Card title={`Approved — awaiting reimbursement (${payable?.length ?? 0})`}>
            <Table head={["Employee", "Claim", "Payable", ""]} empty="Nothing to pay.">
              {(payable ?? []).map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium text-gray-900">{c.employees?.full_name}</Td>
                  <Td>
                    <Link href={`/expenses/${c.id}`} className="text-indigo-700 hover:underline">
                      {c.claim_no}
                    </Link>
                  </Td>
                  <Td className="tabular-nums font-semibold">{money(c.net_payable)}</Td>
                  <Td>
                    <PayClaimForm claimId={c.id} banks={bankOpts} />
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}

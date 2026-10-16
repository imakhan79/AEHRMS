import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Notice, PageHeader, Stat, buttonClass } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { money } from "@/lib/payroll";
import { ApproveSettlementButton, SettlementForm, type SettlementValues } from "../../forms";

export const metadata: Metadata = { title: "Settlement" };

export default async function FnfPage({ params }: PageProps<"/payroll/fnf/[employeeId]">) {
  const { employeeId } = await params;
  if (!z.uuid().safeParse(employeeId).success) notFound();
  const session = await requireSession();
  if (!session.canReadPayroll) redirect("/dashboard");
  const supabase = await createClient();

  const { data: emp } = await supabase.from("employees").select("id, full_name, employee_code, exit_date, status").eq("id", employeeId).maybeSingle();
  if (!emp) notFound();
  const { data: existing } = await supabase.from("fnf_settlements").select("*").eq("employee_id", employeeId).maybeSingle();
  const { data: suggestion, error: sugErr } =
    !existing && session.isPayroll && emp.exit_date ? await supabase.rpc("fnf_suggest", { p_employee: employeeId }) : { data: null, error: null };

  const s = suggestion as { basic_salary: number; leave_days: number; leave_encashment: number; loan_balance: number } | null;
  const values: SettlementValues = existing ?? {
    exit_date: emp.exit_date ?? "",
    basic_salary: s?.basic_salary ?? 0,
    leave_days_encashed: s?.leave_days ?? 0,
    leave_encashment: s?.leave_encashment ?? 0,
    gratuity: 0,
    other_additions: 0,
    loan_recovery: s?.loan_balance ?? 0,
    other_deductions: 0,
    notes: null,
  };
  const approved = existing?.status === "approved";
  const preparedByMe = existing?.prepared_by === session.userId;

  return (
    <>
      <PageHeader
        title={`Full & final — ${emp.full_name}`}
        description={`${emp.employee_code} · exit ${fmtDate(emp.exit_date)}`}
        actions={
          <Link href="/payroll/fnf" className={buttonClass("secondary")}>
            ← All settlements
          </Link>
        }
      />
      {!emp.exit_date && <Notice>Set the exit date on the employee record first.</Notice>}
      {sugErr && <Notice tone="red">{sugErr.message}</Notice>}

      {emp.exit_date && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Settlement" className="lg:col-span-2" description="Final salary for the exit month comes from the regular payroll run (prorated, tax settled, loans fully recovered).">
            <SettlementForm employeeId={employeeId} values={values} locked={approved || !session.isPayroll} />
          </Card>
          <div className="space-y-6">
            <Stat label="Net settlement" value={`PKR ${money(existing?.net_amount ?? Number(values.leave_encashment) + Number(values.gratuity) + Number(values.other_additions) - Number(values.loan_recovery) - Number(values.other_deductions))}`} hint={existing ? undefined : "Unsaved suggestion"} />
            <Card title="Status">
              {existing ? (
                <div className="space-y-3 text-sm">
                  <Badge tone={approved ? "green" : "amber"}>{approved ? "Approved & posted" : "Draft"}</Badge>
                  {approved && <p className="text-gray-600">Approved {fmtDateTime(existing.approved_at)}.</p>}
                  {!approved && session.isFinance && !preparedByMe && <ApproveSettlementButton id={existing.id} />}
                  {!approved && preparedByMe && <p className="text-amber-800">You prepared this settlement — another Finance user approves it.</p>}
                  {!approved && !session.isFinance && <p className="text-gray-600">Awaiting Finance approval.</p>}
                </div>
              ) : (
                <p className="text-sm text-gray-600">Not saved yet. Review the suggested figures and save the draft.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

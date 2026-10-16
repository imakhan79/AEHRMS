import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Notice, PageHeader, Stat, Table, Td, buttonClass, cn } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { PAYROLL_STEPS, money, monthLabel, taxYearLabel, type PayrollRun, type Payslip } from "@/lib/payroll";
import { ProcessButton, TransitionForm } from "../../forms";

export const metadata: Metadata = { title: "Payroll run" };

export default async function PayrollRunPage({ params }: PageProps<"/payroll/runs/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireSession();
  if (!session.canReadPayroll) redirect("/dashboard");
  const supabase = await createClient();

  const { data } = await supabase.from("payroll_runs").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const run = data as PayrollRun;
  const [{ data: slips }, journal, people] = await Promise.all([
    supabase.from("payslips").select("*").eq("payroll_run_id", id).order("employee_code"),
    run.journal_entry_id
      ? supabase
          .from("journal_entry_lines")
          .select("debit, credit, description, chart_of_accounts(code, name), cost_centers(code)")
          .eq("journal_entry_id", run.journal_entry_id)
      : Promise.resolve({ data: [] }),
    supabase.from("employees").select("user_id, full_name").not("user_id", "is", null),
  ]);
  const payslips = (slips ?? []) as Payslip[];
  const who = new Map((people.data ?? []).map((p) => [p.user_id, p.full_name]));
  const name = (uid: string | null) => (uid ? (who.get(uid) ?? "—") : "—");
  const step = PAYROLL_STEPS.findIndex((s) => s.status === run.status);
  const warnings = payslips.filter((p) => p.warnings.length);
  const sum = (k: keyof Payslip) => payslips.reduce((s, p) => s + Number(p[k] ?? 0), 0);
  const isSubmitter = run.submitted_by === session.userId;

  type JL = { debit: number; credit: number; description: string; chart_of_accounts: { code: string; name: string } | null; cost_centers: { code: string } | null };

  return (
    <>
      <PageHeader
        title={`Payroll — ${monthLabel(run.period_month)}${run.is_parallel ? " (parallel run)" : ""}`}
        description={`${taxYearLabel(run.tax_year)} · ${run.employee_count} employees`}
        actions={
          <Link href="/payroll" className={buttonClass("secondary")}>
            ← All runs
          </Link>
        }
      />

      {/* Status stepper */}
      <ol className="mb-6 grid grid-cols-5 gap-2 text-xs">
        {PAYROLL_STEPS.map((s, i) => (
          <li
            key={s.status}
            className={cn(
              "rounded-lg border px-3 py-2 font-medium",
              i < step && "border-emerald-200 bg-emerald-50 text-emerald-800",
              i === step && "border-indigo-300 bg-indigo-50 text-indigo-800",
              i > step && "border-gray-200 bg-white text-gray-400",
            )}
          >
            {s.label}
          </li>
        ))}
      </ol>

      {run.is_parallel && (
        <div className="mb-6">
          <Notice tone="blue">Parallel run: compare these figures with the legacy payroll. It can be reviewed but never approved or posted.</Notice>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Gross" value={money(run.total_gross)} />
        <Stat label="Deductions" value={money(run.total_deductions)} />
        <Stat label="Net pay" value={money(run.total_net)} />
        <Stat label="Income tax" value={money(run.total_tax)} />
        <Stat label="Employer cost" value={money(run.total_employer)} hint="EOBI, PESSI, PF, VPS" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="Actions" className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            {run.status === "draft" && session.isPayroll && (
              <>
                <ProcessButton runId={run.id} />
                <TransitionForm runId={run.id} to="review" label="Submit for review" withNote />
              </>
            )}
            {run.status === "review" && session.isPayroll && (
              <TransitionForm runId={run.id} to="draft" label="Return to draft" variant="secondary" withNote />
            )}
            {run.status === "review" && session.isFinance && !run.is_parallel && (
              isSubmitter ? (
                <span className="text-sm text-amber-800">You submitted this run — another Finance user must approve it.</span>
              ) : (
                <TransitionForm runId={run.id} to="approved" label="Approve payroll" variant="success" />
              )
            )}
            {run.status === "approved" && session.isFinance && <TransitionForm runId={run.id} to="posted" label="Post to general ledger" />}
            {run.status === "posted" && session.isFinance && (
              <TransitionForm runId={run.id} to="paid" label="Mark as paid (bank transfer done)" variant="success" />
            )}
            {!session.isPayroll && <span className="text-sm text-gray-500">Read-only access.</span>}
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
            {[
              ["register", "Payroll register"],
              ["bank", "Bank transfer file"],
              ["tax", "Income tax statement"],
              ["eobi", "EOBI"],
              ["pessi", "PESSI"],
              ["pf", "Provident fund"],
              ["vps", "VPS"],
            ].map(([k, label]) => (
              <a key={k} href={`/payroll/runs/${run.id}/export?kind=${k}`} className={buttonClass("secondary", "sm")}>
                {label} (CSV)
              </a>
            ))}
          </div>
        </Card>
        <Card title="History">
          <dl className="space-y-2 text-sm">
            {[
              ["Calculated", run.processed_at, null],
              ["Submitted", run.submitted_at, run.submitted_by],
              ["Approved", run.approved_at, run.approved_by],
              ["Posted", run.posted_at, null],
              ["Paid", run.paid_at, null],
            ].map(([k, at, by]) => (
              <div key={k as string} className="flex justify-between gap-3">
                <dt className="text-gray-500">{k}</dt>
                <dd className="text-right text-gray-900">
                  {fmtDateTime(at as string | null)}
                  {by ? <div className="text-xs text-gray-500">{name(by as string)}</div> : null}
                </dd>
              </div>
            ))}
          </dl>
          {run.notes && <p className="mt-3 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">{run.notes}</p>}
        </Card>
      </div>

      {warnings.length > 0 && (
        <div className="mb-6">
          <Notice>
            <strong>{warnings.length} payslip(s) need a look:</strong>
            <ul className="mt-1 list-disc pl-5">
              {warnings.slice(0, 8).map((p) => (
                <li key={p.id}>
                  {p.employee_name}: {p.warnings.join("; ")}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      <Card title="Payslips">
        <Table head={["Employee", "Days", "Gross", "Tax", "EOBI", "PF", "Loans", "Other", "Net", ""]} empty="No payslips — set salaries on employee records, then recalculate.">
          {payslips.map((p) => (
            <tr key={p.id}>
              <Td>
                <div className="font-medium text-gray-900">{p.employee_name}</div>
                <div className="text-xs text-gray-500">
                  {p.employee_code}
                  {p.department_name ? ` · ${p.department_name}` : ""}
                </div>
              </Td>
              <Td className="tabular-nums">
                {p.payable_days}/{p.days_in_month}
              </Td>
              <Td className="tabular-nums">{money(p.gross_pay)}</Td>
              <Td className="tabular-nums">{money(p.income_tax)}</Td>
              <Td className="tabular-nums">{money(p.eobi_employee)}</Td>
              <Td className="tabular-nums">{money(p.pf_employee)}</Td>
              <Td className="tabular-nums">{money(p.loan_deduction)}</Td>
              <Td className="tabular-nums">{money(p.other_deductions + p.vps_employee)}</Td>
              <Td className={cn("tabular-nums font-semibold", p.net_pay < 0 ? "text-red-700" : "text-gray-900")}>{money(p.net_pay)}</Td>
              <Td>
                <Link href={`/payroll/payslips/${p.id}`} className="text-xs text-indigo-600 hover:underline">
                  Payslip
                </Link>
              </Td>
            </tr>
          ))}
          {payslips.length > 0 && (
            <tr className="bg-gray-50 font-semibold">
              <Td>Total</Td>
              <Td />
              <Td className="tabular-nums">{money(sum("gross_pay"))}</Td>
              <Td className="tabular-nums">{money(sum("income_tax"))}</Td>
              <Td className="tabular-nums">{money(sum("eobi_employee"))}</Td>
              <Td className="tabular-nums">{money(sum("pf_employee"))}</Td>
              <Td className="tabular-nums">{money(sum("loan_deduction"))}</Td>
              <Td className="tabular-nums">{money(sum("other_deductions") + sum("vps_employee"))}</Td>
              <Td className="tabular-nums">{money(sum("net_pay"))}</Td>
              <Td />
            </tr>
          )}
        </Table>
      </Card>

      {run.journal_entry_id && (
        <div className="mt-6">
          <Card
            title="General ledger posting"
            actions={
              <Link href="/finance/ledger" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
                Ledger →
              </Link>
            }
          >
            <Table head={["Account", "Cost center", "Description", "Debit", "Credit"]}>
              {((journal.data ?? []) as unknown as JL[]).map((l, i) => (
                <tr key={i}>
                  <Td>
                    <span className="font-mono text-xs text-gray-500">{l.chart_of_accounts?.code}</span> {l.chart_of_accounts?.name}
                  </Td>
                  <Td className="text-xs">{l.cost_centers?.code ?? "—"}</Td>
                  <Td className="text-xs">{l.description}</Td>
                  <Td className="tabular-nums">{Number(l.debit) ? money(l.debit) : ""}</Td>
                  <Td className="tabular-nums">{Number(l.credit) ? money(l.credit) : ""}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}

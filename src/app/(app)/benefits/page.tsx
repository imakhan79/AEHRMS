import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Stat, Table, Td, buttonClass } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";
import { EnrollForm, PlanForm } from "../lifecycle-forms";
import { cancelEnrollment } from "../lifecycle-actions";

export const metadata: Metadata = { title: "Benefits" };

export default async function BenefitsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const me = session.employee?.id;
  const [{ data: plans }, { data: enrollments }, { data: deps }, { data: people }] = await Promise.all([
    supabase.from("benefit_plans").select("*").eq("is_active", true).order("name"),
    supabase.from("benefit_enrollments").select("*, benefit_plans(name, employee_contribution, employer_contribution), employees!benefit_enrollments_employee_id_fkey(full_name, employee_code)").order("created_at", { ascending: false }),
    me ? supabase.from("employee_dependents").select("id, name, relationship").eq("employee_id", me) : Promise.resolve({ data: [] }),
    session.isHR ? supabase.from("employees").select("id, full_name").is("deleted_at", null).not("status", "in", "(exited,draft)").order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const all = enrollments ?? [];
  const mine = all.filter((e) => e.employee_id === me);
  const activeMine = new Set(mine.filter((e) => e.status === "active").map((e) => e.plan_id));
  const reasons = new Map<string, string | null>();
  if (me) {
    await Promise.all(
      (plans ?? []).map(async (p) => {
        const { data } = await supabase.rpc("benefit_ineligibility", { p_plan: p.id, p_employee: me });
        reasons.set(p.id, (data as string | null) ?? null);
      }),
    );
  }
  const active = all.filter((e) => e.status === "active");
  const depOpts = (deps ?? []).map((d) => ({ id: d.id, label: `${d.name} (${d.relationship})` }));

  return (
    <>
      <PageHeader title="Benefits" description="Plans with eligibility rules; your contribution is deducted in payroll automatically." />
      {(session.isHR || session.canReadPayroll) && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Active enrolments" value={active.length} />
          <Stat label="Employee contributions / month" value={`PKR ${money(active.reduce((s, e) => s + Number(e.benefit_plans?.employee_contribution ?? 0), 0))}`} />
          <Stat label="Company cost / month" value={`PKR ${money(active.reduce((s, e) => s + Number(e.benefit_plans?.employer_contribution ?? 0), 0))}`} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            {(plans ?? []).map((p) => {
              const reason = reasons.get(p.id);
              const enrolled = activeMine.has(p.id);
              return (
                <Card key={p.id} title={p.name} description={`${titleCase(p.plan_type)}${p.provider ? ` · ${p.provider}` : ""}`}>
                  <p className="text-sm text-gray-600">{p.description}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-gray-500">You pay / month</dt>
                      <dd className="font-semibold tabular-nums">PKR {money(p.employee_contribution)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Company pays / month</dt>
                      <dd className="font-semibold tabular-nums">PKR {money(p.employer_contribution)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Dependents</dt>
                      <dd>{p.covers_dependents ? `Up to ${p.max_dependents}` : "Employee only"}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Eligibility</dt>
                      <dd>
                        {p.min_tenure_months ? `${p.min_tenure_months}+ months` : "From joining"}
                        {p.eligible_grades ? ` · grades ${p.eligible_grades.join(", ")}` : ""}
                      </dd>
                    </div>
                  </dl>
                  {me && (
                    <div className="mt-4 border-t border-gray-100 pt-3">
                      {enrolled ? (
                        <Badge tone="green">You&apos;re enrolled</Badge>
                      ) : reason ? (
                        <p className="text-xs text-amber-800">{reason}</p>
                      ) : (
                        <EnrollForm planId={p.id} employeeId={me} dependents={depOpts} maxDependents={p.covers_dependents ? p.max_dependents : 0} />
                      )}
                    </div>
                  )}
                  {session.isHR && (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer text-indigo-700">Enrol an employee</summary>
                      <div className="mt-2">
                        <EnrollForm planId={p.id} employeeId={null} dependents={[]} maxDependents={0} people={(people ?? []).map((x) => ({ id: x.id, label: x.full_name }))} />
                      </div>
                    </details>
                  )}
                </Card>
              );
            })}
          </div>
          <Card title={session.isHR || session.canReadPayroll ? "Enrolments" : "My enrolments"}>
            <Table head={["Employee", "Plan", "From", "Dependents", "Status", ""]} empty="No enrolments.">
              {(session.isHR || session.canReadPayroll ? all : mine).map((e) => (
                <tr key={e.id}>
                  <Td>{e.employees?.full_name}</Td>
                  <Td>{e.benefit_plans?.name}</Td>
                  <Td>{fmtDate(e.start_date)}</Td>
                  <Td>{e.dependent_ids.length}</Td>
                  <Td>
                    <Badge tone={e.status === "active" ? "green" : "gray"}>{e.status}</Badge>
                    {e.end_date && <div className="text-xs text-gray-500">until {fmtDate(e.end_date)}</div>}
                  </Td>
                  <Td>
                    {e.status === "active" && (session.isHR || e.employee_id === me) && (
                      <form action={cancelEnrollment.bind(null, e.id)}>
                        <button className={buttonClass("danger", "sm")}>Cancel</button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        {session.isHR && (
          <Card title="Add plan">
            <PlanForm />
          </Card>
        )}
      </div>
    </>
  );
}

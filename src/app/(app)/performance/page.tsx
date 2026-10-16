import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { CycleForm, GiveFeedbackForm } from "../talent-forms";
import { cycleAction } from "../talent-actions";

export const metadata: Metadata = { title: "Performance" };

const STATUS_TONE: Record<string, "gray" | "amber" | "blue" | "green"> = { goal_setting: "blue", self_review: "amber", manager_review: "amber", completed: "green", acknowledged: "green" };

export default async function PerformancePage() {
  const session = await requireSession();
  const supabase = await createClient();
  const me = session.employee?.id;
  const [{ data: cycles }, { data: appraisals }, { data: requests }] = await Promise.all([
    supabase.from("appraisal_cycles").select("*").order("period_start", { ascending: false }),
    supabase
      .from("appraisals")
      .select("*, appraisal_cycles(name), employee:employees!appraisals_employee_id_fkey(full_name, employee_code), goals(weight)")
      .order("created_at", { ascending: false })
      .limit(300),
    me
      ? supabase
          .from("feedback_requests")
          .select("*, appraisals(employee:employees!appraisals_employee_id_fkey(full_name))")
          .eq("reviewer_id", me)
          .is("submitted_at", null)
      : Promise.resolve({ data: [] }),
  ]);
  const all = appraisals ?? [];
  const mine = all.filter((a) => a.employee_id === me);
  const team = all.filter((a) => a.employee_id !== me);

  const row = (a: (typeof all)[number], showName: boolean) => (
    <tr key={a.id}>
      {showName && (
        <Td>
          <div className="font-medium text-gray-900">{a.employee?.full_name}</div>
          <div className="text-xs text-gray-500">{a.employee?.employee_code}</div>
        </Td>
      )}
      <Td>
        <Link href={`/performance/${a.id}`} className="text-indigo-700 hover:underline">
          {a.appraisal_cycles?.name}
        </Link>
      </Td>
      <Td>{(a.goals ?? []).length} goals · {(a.goals ?? []).reduce((s: number, g: { weight: number }) => s + Number(g.weight), 0)}%</Td>
      <Td>
        <Badge tone={STATUS_TONE[a.status] ?? "gray"}>{titleCase(a.status)}</Badge>
      </Td>
      <Td className="tabular-nums">{a.overall_score ? `${Number(a.overall_score).toFixed(2)} · ${a.rating}` : "—"}</Td>
    </tr>
  );

  return (
    <>
      <PageHeader title="Performance" description="Weighted goals → self review → manager review → acknowledgement, with 360° feedback." />
      <div className="space-y-6">
        {(requests?.length ?? 0) > 0 && (
          <Card title="360° feedback requested from you">
            <div className="grid gap-4 md:grid-cols-2">
              {(requests ?? []).map((r) => (
                <div key={r.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-900">
                    {(r.appraisals as unknown as { employee: { full_name: string } | null } | null)?.employee?.full_name} <span className="font-normal text-gray-500">· {titleCase(r.relationship)}</span>
                  </div>
                  <GiveFeedbackForm id={r.id} />
                </div>
              ))}
            </div>
          </Card>
        )}
        {session.employee && (
          <Card title="My appraisals">
            <Table head={["Cycle", "Goals", "Status", "Score"]} empty="No appraisal yet — HR opens cycles.">
              {mine.map((a) => row(a, false))}
            </Table>
          </Card>
        )}
        {team.length > 0 && (
          <Card title={session.isHR ? "All appraisals" : "My team"}>
            <Table head={["Employee", "Cycle", "Goals", "Status", "Score"]}>{team.map((a) => row(a, true))}</Table>
          </Card>
        )}
        {session.isHR && (
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Cycles" className="lg:col-span-2">
              <Table head={["Cycle", "Period", "Status", ""]} empty="No cycles yet.">
                {(cycles ?? []).map((cy) => (
                  <tr key={cy.id}>
                    <Td className="font-medium text-gray-900">{cy.name}</Td>
                    <Td>
                      {fmtDate(cy.period_start)} – {fmtDate(cy.period_end)}
                    </Td>
                    <Td>
                      <Badge tone={cy.status === "closed" ? "gray" : cy.status === "draft" ? "blue" : "amber"}>{titleCase(cy.status)}</Badge>
                    </Td>
                    <Td>
                      {cy.status === "draft" && (
                        <form action={cycleAction.bind(null, cy.id, "start")}>
                          <button className={buttonClass("primary", "sm")}>Start goal setting</button>
                        </form>
                      )}
                      {cy.status === "goal_setting" && (
                        <form action={cycleAction.bind(null, cy.id, "review")}>
                          <button className={buttonClass("primary", "sm")}>Open reviews</button>
                        </form>
                      )}
                      {cy.status === "review" && (
                        <form action={cycleAction.bind(null, cy.id, "close")}>
                          <button className={buttonClass("secondary", "sm")}>Close cycle</button>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="New cycle">
              <CycleForm />
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, DescList, Notice, PageHeader, Stat, Table, Td, buttonClass } from "@/components/ui";
import { fmtDateTime, titleCase } from "@/lib/format";
import { FeedbackRequestForm, GoalForm, ScoreForm } from "../../talent-forms";
import { acknowledgeAppraisal, removeGoal } from "../../talent-actions";

export const metadata: Metadata = { title: "Appraisal" };

export default async function AppraisalPage({ params }: PageProps<"/performance/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireSession();
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("appraisals")
    .select("*, appraisal_cycles(name, period_start, period_end), employee:employees!appraisals_employee_id_fkey(full_name, employee_code), manager:employees!appraisals_manager_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!a) notFound();
  const isSelf = a.employee_id === session.employee?.id;
  const isMgr = !isSelf && (session.isHR || a.manager_id === session.employee?.id || session.hodDepartments.length > 0 || session.hasReports);
  const [{ data: goals }, { data: feedback }, { data: people }] = await Promise.all([
    supabase.from("goals").select("*").eq("appraisal_id", id).order("created_at"),
    isMgr ? supabase.from("feedback_requests").select("*, reviewer:employees!feedback_requests_reviewer_id_fkey(full_name)").eq("appraisal_id", id) : Promise.resolve({ data: [] }),
    isMgr ? supabase.from("employees").select("id, full_name").is("deleted_at", null).neq("status", "exited").neq("id", a.employee_id).order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const gs = goals ?? [];
  const total = gs.reduce((s, g) => s + Number(g.weight), 0);
  const canEditGoals = a.status === "goal_setting" && (isSelf || isMgr);

  return (
    <>
      <PageHeader
        title={`${a.employee?.full_name} — ${a.appraisal_cycles?.name}`}
        description={`Manager: ${a.manager?.full_name ?? "—"} · ${titleCase(a.status)}`}
        actions={
          <Link href="/performance" className={buttonClass("secondary")}>
            ← Performance
          </Link>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Goals" value={gs.length} hint={`${total}% weight`} />
        <Stat label="Overall score" value={a.overall_score ? `${Number(a.overall_score).toFixed(2)} / 5` : "—"} />
        <Stat label="Rating" value={a.rating ?? "—"} />
        <Stat label="Recommendation" value={a.recommendation ? titleCase(a.recommendation) : "—"} hint={a.increment_pct ? `${Number(a.increment_pct)}% increment` : undefined} />
      </div>
      {total !== 100 && a.status === "goal_setting" && (
        <div className="mb-6">
          <Notice>Goal weights total {total}%. They must add up to exactly 100% before the self review can be submitted.</Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {a.status === "self_review" && isSelf ? (
            <Card title="Self review">
              <ScoreForm appraisalId={id} who="self" goals={gs} />
            </Card>
          ) : a.status === "manager_review" && isMgr ? (
            <Card title="Manager review">
              <ScoreForm appraisalId={id} who="manager" goals={gs} />
            </Card>
          ) : (
            <Card title="Goals">
              <Table head={["Goal", "Weight", "Target", "Self", "Manager", ""]} empty="No goals yet.">
                {gs.map((g) => (
                  <tr key={g.id}>
                    <Td>
                      <div className="font-medium text-gray-900">{g.title}</div>
                      <div className="text-xs uppercase text-gray-500">{g.kind}</div>
                    </Td>
                    <Td className="tabular-nums">{Number(g.weight)}%</Td>
                    <Td className="max-w-48 whitespace-normal text-xs">{g.target ?? "—"}</Td>
                    <Td>{g.self_score ?? "—"}</Td>
                    <Td>{g.manager_score ?? "—"}</Td>
                    <Td>
                      {canEditGoals && (
                        <form action={removeGoal.bind(null, id, g.id)}>
                          <button className="text-xs text-gray-400 hover:text-red-600">Remove</button>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
              {canEditGoals && (
                <div className="mt-8 border-t border-gray-100 pt-4">
                  <GoalForm appraisalId={id} remaining={Math.max(0, 100 - total)} />
                </div>
              )}
            </Card>
          )}
          {isMgr && (
            <Card title="360° feedback" description="Visible to the manager and HR only.">
              <ul className="space-y-3 text-sm">
                {(feedback ?? []).map((f) => (
                  <li key={f.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-900">
                        {f.reviewer?.full_name} <span className="font-normal text-gray-500">· {titleCase(f.relationship)}</span>
                      </span>
                      {f.submitted_at ? <Badge tone="green">{f.score}/5</Badge> : <Badge tone="amber">Waiting</Badge>}
                    </div>
                    {f.strengths && <p className="mt-1 text-gray-700">+ {f.strengths}</p>}
                    {f.improvements && <p className="text-gray-700">△ {f.improvements}</p>}
                  </li>
                ))}
                {!feedback?.length && <li className="text-gray-500">No feedback requested.</li>}
              </ul>
              {a.status !== "completed" && a.status !== "acknowledged" && (
                <div className="mt-6 border-t border-gray-100 pt-4">
                  <FeedbackRequestForm appraisalId={id} people={(people ?? []).map((p) => ({ id: p.id, label: p.full_name }))} />
                </div>
              )}
            </Card>
          )}
        </div>
        <Card title="Summary">
          <DescList
            items={[
              ["Self-assessment", a.self_comment],
              ["Self submitted", fmtDateTime(a.submitted_self_at)],
              ["Manager's summary", a.manager_comment],
              ["Completed", fmtDateTime(a.completed_at)],
              ["Acknowledged", fmtDateTime(a.acknowledged_at)],
            ]}
          />
          {isSelf && a.status === "completed" && (
            <form action={acknowledgeAppraisal.bind(null, id)} className="mt-6 border-t border-gray-100 pt-4">
              <button className={buttonClass("success")}>Acknowledge appraisal</button>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}

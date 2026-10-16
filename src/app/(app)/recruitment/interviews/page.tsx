import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { InterviewFeedbackForm } from "../../talent-forms";

export const metadata: Metadata = { title: "Interviews" };

export default async function InterviewsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const recruiter = session.isHR || session.roles.has("recruiter");
  let q = supabase
    .from("interviews")
    .select("*, candidates(id, full_name, requisitions(title)), interviewer:employees!interviews_interviewer_id_fkey(full_name)")
    .order("scheduled_at");
  if (!recruiter && session.employee) q = q.eq("interviewer_id", session.employee.id);
  const { data } = await q;
  const mine = (data ?? []).filter((i) => i.interviewer_id === session.employee?.id && i.status === "scheduled");
  const rest = (data ?? []).filter((i) => !mine.includes(i));

  return (
    <>
      <PageHeader title="Interviews" description="Interviewers record a score, recommendation and assessment after each interview." />
      <div className="space-y-6">
        <Card title={`Awaiting your feedback (${mine.length})`}>
          {mine.length === 0 ? (
            <Notice tone="blue">No interviews waiting on you.</Notice>
          ) : (
            <div className="space-y-6">
              {mine.map((i) => (
                <div key={i.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="mb-3 text-sm">
                    <span className="font-semibold text-gray-900">{i.candidates?.full_name}</span> · {i.candidates?.requisitions?.title} · {i.round} · {fmtDateTime(i.scheduled_at)}
                  </div>
                  <InterviewFeedbackForm id={i.id} />
                </div>
              ))}
            </div>
          )}
        </Card>
        {recruiter && (
          <Card title="All interviews">
            <ul className="divide-y divide-gray-100 text-sm">
              {rest.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <Link href={`/recruitment/candidates/${i.candidates?.id}`} className="font-medium text-indigo-700 hover:underline">
                      {i.candidates?.full_name}
                    </Link>{" "}
                    · {i.round} · {i.interviewer?.full_name}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-gray-500">
                    {fmtDateTime(i.scheduled_at)}
                    <Badge tone={i.status === "completed" ? "green" : i.status === "cancelled" ? "gray" : "amber"}>{i.status}</Badge>
                  </span>
                </li>
              ))}
              {!rest.length && <li className="py-3 text-gray-500">None.</li>}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

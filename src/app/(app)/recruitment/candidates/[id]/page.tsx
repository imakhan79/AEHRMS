import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, DescList, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";
import { CandidateNotesForm, HireForm, InterviewForm, OfferForm } from "../../../talent-forms";
import { moveCandidate, setOfferStatus } from "../../../talent-actions";

export const metadata: Metadata = { title: "Candidate" };

const NEXT: Record<string, string[]> = {
  applied: ["screening", "rejected"],
  screening: ["interview", "rejected"],
  interview: ["selected", "rejected"],
  selected: ["rejected"],
  offered: [],
  hired: [],
  rejected: ["screening"],
};

export default async function CandidatePage({ params }: PageProps<"/recruitment/candidates/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireSession();
  const supabase = await createClient();
  const { data: c } = await supabase.from("candidates").select("*, requisitions(id, title, req_no)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const recruiter = session.isHR || session.roles.has("recruiter");
  const [{ data: interviews }, { data: offer }, { data: people }, cv] = await Promise.all([
    supabase.from("interviews").select("*, interviewer:employees!interviews_interviewer_id_fkey(full_name)").eq("candidate_id", id).order("scheduled_at"),
    supabase.from("offers").select("*").eq("candidate_id", id).maybeSingle(),
    recruiter ? supabase.from("employees").select("id, full_name").is("deleted_at", null).neq("status", "exited").order("full_name") : Promise.resolve({ data: [] }),
    c.cv_path ? supabase.storage.from("candidate-cvs").createSignedUrl(c.cv_path, 600) : Promise.resolve({ data: null }),
  ]);

  return (
    <>
      <PageHeader
        title={c.full_name}
        description={`${c.requisitions?.title} · ${c.requisitions?.req_no}`}
        actions={
          <Link href={`/recruitment/${c.requisition_id}`} className={buttonClass("secondary")}>
            ← Pipeline
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Profile">
            <DescList
              items={[
                ["Stage", <Badge key="s" tone={c.stage === "hired" ? "green" : c.stage === "rejected" ? "red" : "amber"}>{titleCase(c.stage)}</Badge>],
                ["Email", c.email],
                ["Phone", c.phone],
                ["CNIC", c.cnic],
                ["Current company", c.current_company],
                ["Experience", c.experience_years != null ? `${Number(c.experience_years)} years` : null],
                ["Expected salary", c.expected_salary ? `PKR ${money(c.expected_salary)}` : null],
                ["Source", titleCase(c.source)],
                ["CV", cv.data?.signedUrl ? <a key="cv" href={cv.data.signedUrl} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">Open CV</a> : "—"],
              ]}
            />
            {recruiter && NEXT[c.stage]?.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                {NEXT[c.stage].map((s) => (
                  <form key={s} action={moveCandidate.bind(null, id, c.requisition_id, s)}>
                    <button className={buttonClass(s === "rejected" ? "danger" : "secondary", "sm")}>Move to {titleCase(s)}</button>
                  </form>
                ))}
              </div>
            )}
          </Card>
          <Card title="Interviews">
            <Table head={["When", "Round", "Interviewer", "Score", "Recommendation", "Feedback"]} empty="No interviews yet.">
              {(interviews ?? []).map((i) => (
                <tr key={i.id}>
                  <Td>{fmtDateTime(i.scheduled_at)}</Td>
                  <Td>{i.round}</Td>
                  <Td>{i.interviewer?.full_name}</Td>
                  <Td>{i.score ? "★".repeat(i.score) : "—"}</Td>
                  <Td>{i.recommendation ? <Badge tone={i.recommendation === "hire" ? "green" : i.recommendation === "reject" ? "red" : "amber"}>{i.recommendation}</Badge> : <span className="text-xs text-gray-400">{i.status}</span>}</Td>
                  <Td className="max-w-64 whitespace-normal text-xs">{i.feedback ?? "—"}</Td>
                </tr>
              ))}
            </Table>
            {recruiter && !["hired", "rejected"].includes(c.stage) && (
              <div className="mt-8 border-t border-gray-100 pt-4">
                <InterviewForm candidateId={id} interviewers={(people ?? []).map((p) => ({ id: p.id, label: p.full_name }))} />
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          {recruiter && (
            <Card title="Offer">
              {offer && (
                <div className="mb-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>
                      PKR <strong>{money(offer.offered_salary)}</strong> / month · joins {fmtDate(offer.joining_date)}
                    </span>
                    <Badge tone={offer.status === "accepted" ? "green" : offer.status === "declined" || offer.status === "withdrawn" ? "red" : "amber"}>{offer.status}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/recruitment/offer-letter/${id}`} className={buttonClass("secondary", "sm")}>
                      Offer letter
                    </Link>
                    {offer.status === "draft" && (
                      <form action={setOfferStatus.bind(null, id, "sent")}>
                        <button className={buttonClass("secondary", "sm")}>Mark sent</button>
                      </form>
                    )}
                    {["draft", "sent"].includes(offer.status) && (
                      <>
                        <form action={setOfferStatus.bind(null, id, "accepted")}>
                          <button className={buttonClass("success", "sm")}>Accepted</button>
                        </form>
                        <form action={setOfferStatus.bind(null, id, "declined")}>
                          <button className={buttonClass("danger", "sm")}>Declined</button>
                        </form>
                      </>
                    )}
                  </div>
                </div>
              )}
              {c.stage !== "hired" && (!offer || ["draft"].includes(offer.status)) && (
                <OfferForm candidateId={id} defaults={offer ?? undefined} />
              )}
              {offer?.status === "accepted" && c.stage !== "hired" && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <HireForm candidateId={id} />
                </div>
              )}
              {c.stage === "hired" && c.employee_id && (
                <Link href={`/employees/${c.employee_id}`} className="text-sm text-indigo-700 hover:underline">
                  View employee record →
                </Link>
              )}
            </Card>
          )}
          {recruiter && (
            <Card title="Assessment">
              <CandidateNotesForm id={id} rating={c.rating} notes={c.notes} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

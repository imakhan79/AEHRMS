import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, buttonClass, cn } from "@/components/ui";
import { money } from "@/lib/payroll";
import { CandidateForm, CloseRequisition } from "../../talent-forms";

export const metadata: Metadata = { title: "Pipeline" };

const STAGES = ["applied", "screening", "interview", "selected", "offered", "hired", "rejected"] as const;
const LABEL: Record<string, string> = { applied: "Applied", screening: "Screening", interview: "Interview", selected: "Selected", offered: "Offered", hired: "Hired", rejected: "Rejected" };

export default async function PipelinePage({ params }: PageProps<"/recruitment/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireSession();
  const supabase = await createClient();
  const { data: req } = await supabase.from("requisitions").select("*, departments(name)").eq("id", id).maybeSingle();
  if (!req) notFound();
  const { data: cands } = await supabase.from("candidates").select("*").eq("requisition_id", id).order("created_at");
  const recruiter = session.isHR || session.roles.has("recruiter");

  return (
    <>
      <PageHeader
        title={req.title}
        description={`${req.req_no} · ${req.departments?.name} · ${req.headcount} opening(s)${req.salary_min ? ` · PKR ${money(req.salary_min)}–${money(req.salary_max)}` : ""}`}
        actions={
          <div className="flex gap-2">
            {recruiter && req.status === "approved" && <CloseRequisition id={id} />}
            <Link href="/recruitment" className={buttonClass("secondary")}>
              ← Requisitions
            </Link>
          </div>
        }
      />
      <div className="mb-6 overflow-x-auto">
        <div className="grid min-w-[980px] grid-cols-7 gap-3">
          {STAGES.map((s) => {
            const cs = (cands ?? []).filter((c) => c.stage === s);
            return (
              <div key={s} className={cn("rounded-xl border p-3", s === "hired" ? "border-emerald-200 bg-emerald-50/40" : s === "rejected" ? "border-gray-200 bg-gray-50" : "border-gray-200 bg-white")}>
                <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {LABEL[s]} <Badge>{cs.length}</Badge>
                </div>
                <ul className="space-y-2">
                  {cs.map((c) => (
                    <li key={c.id}>
                      <Link href={`/recruitment/candidates/${c.id}`} className="block rounded-lg border border-gray-200 bg-white p-2.5 text-sm shadow-sm transition hover:border-indigo-300">
                        <div className="font-semibold text-gray-900">{c.full_name}</div>
                        <div className="text-xs text-gray-500">
                          {c.experience_years != null ? `${Number(c.experience_years)} yrs` : ""}
                          {c.rating ? ` · ${"★".repeat(c.rating)}` : ""}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
      {recruiter && req.status === "approved" && (
        <Card title="Add candidate" className="max-w-2xl">
          <CandidateForm reqId={id} />
        </Card>
      )}
    </>
  );
}

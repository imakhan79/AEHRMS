import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Stat, Table, Td, buttonClass } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";
import { RequisitionDecision, RequisitionForm } from "../talent-forms";

export const metadata: Metadata = { title: "Recruitment" };

const TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "gray", closed: "blue" } as const;

export default async function RecruitmentPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const recruiter = session.isHR || session.roles.has("recruiter");
  const [{ data: reqs }, { data: depts }, { data: positions }, { data: locations }, { data: cands }] = await Promise.all([
    supabase
      .from("requisitions")
      .select("*, departments(name), requester:employees!requisitions_requested_by_fkey(full_name)")
      .order("created_at", { ascending: false }),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("positions").select("id, title").order("title"),
    supabase.from("locations").select("id, name").order("name"),
    recruiter ? supabase.from("candidates").select("requisition_id, stage") : Promise.resolve({ data: [] }),
  ]);
  const list = reqs ?? [];
  const byReq = new Map<string, { total: number; hired: number }>();
  for (const c of cands ?? []) {
    const v = byReq.get(c.requisition_id) ?? { total: 0, hired: 0 };
    v.total++;
    if (c.stage === "hired") v.hired++;
    byReq.set(c.requisition_id, v);
  }
  const canRaise = recruiter || session.hasReports || session.roles.has("hod");

  return (
    <>
      <PageHeader
        title="Recruitment"
        description="Requisitions → candidates → interviews → offer → hire → onboarding."
        actions={
          recruiter && (
            <div className="flex gap-2">
              <Link href="/recruitment/interviews" className={buttonClass("secondary")}>
                Interviews
              </Link>
              <Link href="/recruitment/onboarding" className={buttonClass("secondary")}>
                Onboarding
              </Link>
            </div>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Open requisitions" value={list.filter((r) => r.status === "approved").length} />
        <Stat label="Awaiting approval" value={list.filter((r) => r.status === "pending").length} />
        <Stat label="Candidates in pipeline" value={(cands ?? []).filter((c) => !["hired", "rejected"].includes(c.stage)).length} />
        <Stat label="Hired" value={(cands ?? []).filter((c) => c.stage === "hired").length} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Requisitions" className="lg:col-span-2">
          <Table head={["Requisition", "Department", "Openings", "Budget", "Status", ""]} empty="No requisitions yet.">
            {list.map((r) => {
              const s = byReq.get(r.id);
              return (
                <tr key={r.id}>
                  <Td>
                    {recruiter && r.status !== "pending" ? (
                      <Link href={`/recruitment/${r.id}`} className="font-medium text-indigo-700 hover:underline">
                        {r.title}
                      </Link>
                    ) : (
                      <span className="font-medium text-gray-900">{r.title}</span>
                    )}
                    <div className="text-xs text-gray-500">
                      {r.req_no} · {r.requester?.full_name ?? "—"} · {fmtDate(r.created_at)}
                    </div>
                  </Td>
                  <Td>{r.departments?.name}</Td>
                  <Td className="tabular-nums">
                    {s?.hired ?? 0}/{r.headcount}
                    {s && <div className="text-xs text-gray-500">{s.total} candidates</div>}
                  </Td>
                  <Td className="text-xs">{r.salary_min ? `${money(r.salary_min)}–${money(r.salary_max)}` : "—"}</Td>
                  <Td>
                    <Badge tone={TONE[r.status as keyof typeof TONE]}>{titleCase(r.status)}</Badge>
                  </Td>
                  <Td>{session.isHR && r.status === "pending" && r.requested_by !== session.employee?.id && <RequisitionDecision id={r.id} />}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
        {canRaise && (
          <Card title="Raise a requisition">
            <RequisitionForm
              departments={(depts ?? []).map((d) => ({ id: d.id, label: d.name }))}
              positions={(positions ?? []).map((p) => ({ id: p.id, label: p.title }))}
              locations={(locations ?? []).map((l) => ({ id: l.id, label: l.name }))}
            />
          </Card>
        )}
      </div>
    </>
  );
}

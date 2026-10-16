import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, DescList, PageHeader, buttonClass, cn } from "@/components/ui";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import { ClearForm, CompleteExitForm, SeparationDecision } from "../../lifecycle-forms";
import { withdrawSeparation } from "../../lifecycle-actions";

export const metadata: Metadata = { title: "Separation" };

const OWNER: Record<string, string> = { department: "Line manager / HOD", assets: "HR / Admin", finance: "Finance", it: "IT (HR/Admin)", hr: "HR" };

export default async function SeparationPage({ params }: PageProps<"/exit/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireSession();
  const supabase = await createClient();
  const { data: s } = await supabase
    .from("separations")
    .select("*, employees!separations_employee_id_fkey(id, full_name, employee_code, manager_id, department_id)")
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();
  const [{ data: items }, { data: assets }] = await Promise.all([
    supabase.from("clearance_items").select("*, cleared:employees!clearance_items_cleared_by_fkey(full_name)").eq("separation_id", id).order("sort_order"),
    supabase.from("asset_assignments").select("id, assets(asset_tag, name)").eq("employee_id", s.employee_id).is("returned_on", null),
  ]);
  const me = session.employee?.id;
  const isSelf = s.employee_id === me;
  const isMgr = !isSelf && (s.employees?.manager_id === me || (!!s.employees?.department_id && session.hodDepartments.includes(s.employees.department_id)));
  const canClear = (area: string) => (area === "department" ? session.isHR || isMgr : area === "finance" ? session.isFinance : session.isHR);
  const pending = (items ?? []).filter((i) => i.status !== "cleared").length;

  return (
    <>
      <PageHeader
        title={`${s.employees?.full_name} — ${titleCase(s.separation_type)}`}
        description={`${s.employees?.employee_code} · last working day ${fmtDate(s.last_working_day)}`}
        actions={
          <div className="flex gap-2">
            {session.canReadPayroll && s.status === "completed" && (
              <Link href={`/payroll/fnf/${s.employee_id}`} className={buttonClass()}>
                Full &amp; final settlement →
              </Link>
            )}
            <Link href="/exit" className={buttonClass("secondary")}>
              ← Exit
            </Link>
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Clearance checklist" className="lg:col-span-2">
          {s.status === "submitted" ? (
            <p className="text-sm text-gray-600">Clearance starts once the separation is approved.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {(items ?? []).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold", i.status === "cleared" ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-400")} aria-hidden="true">
                      {i.status === "cleared" ? "✓" : "•"}
                    </span>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{i.title}</div>
                      <div className="text-xs text-gray-500">
                        {OWNER[i.area]}
                        {i.status === "cleared" ? ` · cleared ${fmtDateTime(i.cleared_at)}${i.cleared?.full_name ? ` by ${i.cleared.full_name}` : ""}` : ""}
                        {i.notes ? ` · ${i.notes}` : ""}
                      </div>
                    </div>
                  </div>
                  {i.status !== "cleared" && s.status === "approved" && canClear(i.area) && i.area !== "assets" && <ClearForm itemId={i.id} sepId={id} />}
                  {i.status !== "cleared" && i.area === "assets" && (
                    <Link href="/assets" className="text-xs text-indigo-700 hover:underline">
                      Receive in Assets →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(assets?.length ?? 0) > 0 && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Still issued: {(assets ?? []).map((a) => `${(a.assets as unknown as { name: string; asset_tag: string } | null)?.name} (${(a.assets as unknown as { asset_tag: string } | null)?.asset_tag})`).join(", ")}
            </div>
          )}
          {session.isHR && s.status === "approved" && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              {pending > 0 ? <p className="text-sm text-gray-600">{pending} item(s) pending before the exit can be completed.</p> : <CompleteExitForm id={id} />}
            </div>
          )}
        </Card>
        <Card title="Details">
          <DescList
            items={[
              ["Status", <Badge key="s" tone={s.status === "completed" ? "green" : s.status === "rejected" || s.status === "withdrawn" ? "red" : "amber"}>{titleCase(s.status)}</Badge>],
              ["Notice given", fmtDate(s.notice_date)],
              ["Last working day", fmtDate(s.last_working_day)],
              ["Reason", s.reason],
              ["Decision", s.decision_comment ?? (s.decided_at ? fmtDateTime(s.decided_at) : "—")],
              ["Exit interview", s.exit_interview ?? "—"],
            ]}
          />
          {s.status === "submitted" && !isSelf && (session.isHR || isMgr) && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <SeparationDecision id={id} />
            </div>
          )}
          {((isSelf && s.status === "submitted") || (session.isHR && ["submitted", "approved"].includes(s.status))) && (
            <form action={withdrawSeparation.bind(null, id)} className="mt-4">
              <button className={buttonClass("secondary", "sm")}>Withdraw</button>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}

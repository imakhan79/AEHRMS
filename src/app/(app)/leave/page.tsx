import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getApprovalQueue } from "@/lib/leave";
import { Badge, Card, Notice, PageHeader, Table, Td, statusTone } from "@/components/ui";
import { buttonClass } from "@/components/ui";
import { fmtDate, fmtDays, titleCase } from "@/lib/format";
import type { LeaveBalance, LeaveRequest } from "@/lib/types";
import { ApplyForm } from "./apply-form";
import { DecideForm } from "./decide-form";
import { cancelLeave } from "./actions";

export const metadata: Metadata = { title: "Leave" };

export default async function LeavePage() {
  const session = await requireSession();
  const supabase = await createClient();
  const emp = session.employee;
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  const [types, balances, mine, queue, holidays] = await Promise.all([
    supabase.from("leave_types").select("id, name").eq("is_active", true).order("name"),
    emp
      ? supabase.from("leave_balance_summary").select("*").eq("employee_id", emp.id).in("year", [year, year + 1]).order("year")
      : Promise.resolve({ data: [] as LeaveBalance[] }),
    emp
      ? supabase
          .from("leave_requests")
          .select("*, leave_types(name)")
          .eq("employee_id", emp.id)
          .order("start_date", { ascending: false })
      : Promise.resolve({ data: [] }),
    getApprovalQueue(session),
    supabase.from("holidays").select("holiday_date, name, locations(name)").gte("holiday_date", today).order("holiday_date").limit(8),
  ]);

  return (
    <>
      <PageHeader title="Leave" description="Apply for leave, track requests and approve your team's requests." />

      {queue.length > 0 && (
        <div id="approvals" className="mb-6">
          <Card title={`Awaiting your decision (${queue.length})`}>
            <Table head={["Employee", "Type", "Dates", "Days", "Stage", "Reason", ""]}>
              {queue.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <div className="font-medium text-gray-900">{r.employees?.full_name}</div>
                    <div className="text-xs text-gray-500">{r.employees?.employee_code}</div>
                  </Td>
                  <Td>{r.leave_types?.name}</Td>
                  <Td>
                    {fmtDate(r.start_date)}
                    {r.end_date !== r.start_date && ` – ${fmtDate(r.end_date)}`}
                  </Td>
                  <Td>{r.half_day ? "½" : r.days}</Td>
                  <Td>
                    <Badge tone="amber">{r.stage === "hr" ? "HR approval" : "Manager approval"}</Badge>
                  </Td>
                  <Td className="max-w-48 truncate whitespace-normal">{r.reason ?? "—"}</Td>
                  <Td>
                    <DecideForm id={r.id} />
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}

      {!emp ? (
        <Notice tone="blue">Your account isn&apos;t linked to an employee record, so you can only approve requests here.</Notice>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card title="My balances">
              <Table head={["Year", "Type", "Entitled", "Used", "Pending", "Available"]} empty="No leave allocated yet — HR allocates balances each year.">
                {(balances.data as LeaveBalance[] | null)?.map((b) => (
                  <tr key={b.id}>
                    <Td>{b.year}</Td>
                    <Td className="font-medium text-gray-900">{b.leave_type}</Td>
                    <Td>{b.entitled}</Td>
                    <Td>{b.used}</Td>
                    <Td>{b.pending}</Td>
                    <Td className="font-semibold text-gray-900">{fmtDays(b.available)}</Td>
                  </tr>
                )) ?? []}
              </Table>
            </Card>

            <Card title="My requests">
              <Table head={["Type", "Dates", "Days", "Status", "Comment", ""]} empty="You haven't applied for leave yet.">
                {(mine.data as (LeaveRequest & { leave_types: { name: string } })[] | null)?.map((r) => {
                  const canCancel = r.status === "pending" || (r.status === "approved" && r.start_date > today);
                  return (
                    <tr key={r.id}>
                      <Td>{r.leave_types?.name}</Td>
                      <Td>
                        {fmtDate(r.start_date)}
                        {r.end_date !== r.start_date && ` – ${fmtDate(r.end_date)}`}
                      </Td>
                      <Td>{r.half_day ? "½" : r.days}</Td>
                      <Td>
                        <Badge tone={statusTone(r.status)}>
                          {r.status === "pending" ? `Pending ${r.stage === "hr" ? "HR" : "manager"}` : titleCase(r.status)}
                        </Badge>
                      </Td>
                      <Td className="max-w-48 truncate">{r.decision_comment ?? "—"}</Td>
                      <Td>
                        {canCancel && (
                          <form action={cancelLeave.bind(null, r.id)}>
                            <button className={buttonClass("secondary", "sm")}>Cancel</button>
                          </form>
                        )}
                      </Td>
                    </tr>
                  );
                }) ?? []}
              </Table>
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Apply for leave">
              <ApplyForm types={types.data ?? []} />
            </Card>
            <Card title="Upcoming holidays">
              <ul className="space-y-2 text-sm">
                {(holidays.data ?? []).map((h) => (
                  <li key={`${h.holiday_date}-${h.name}`} className="flex justify-between gap-3">
                    <span className="text-gray-900">{h.name}</span>
                    <span className="whitespace-nowrap text-gray-500">{fmtDate(h.holiday_date)}</span>
                  </li>
                ))}
                {!holidays.data?.length && <li className="text-gray-500">None scheduled.</li>}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

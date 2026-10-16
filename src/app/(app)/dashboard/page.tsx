import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, hasAnyRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Notice, PageHeader, Stat, Table, Td, statusTone } from "@/components/ui";
import { fmtDate, fmtDays, fmtTime, titleCase } from "@/lib/format";
import { getApprovalQueue } from "@/lib/leave";
import { getAttendanceQueue, pkToday } from "@/lib/attendance";
import type { LeaveBalance, LeaveRequest } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const year = new Date().getFullYear();
  const emp = session.employee;
  const seesOrg = hasAnyRole(session, ["hr_admin", "system_admin", "executive", "finance", "auditor"]);

  const today = pkToday();
  const [balances, myRequests, pendingApprovals, headcount, todayPunches, attQueue, presentToday] = await Promise.all([
    emp
      ? supabase.from("leave_balance_summary").select("*").eq("employee_id", emp.id).eq("year", year).order("leave_type")
      : Promise.resolve({ data: [] as LeaveBalance[] }),
    emp
      ? supabase
          .from("leave_requests")
          .select("id, start_date, end_date, days, status, stage, leave_types(name)")
          .eq("employee_id", emp.id)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    getApprovalQueue(session),
    seesOrg
      ? supabase.from("employees").select("status, department_id, department:departments!employees_department_id_fkey(name)").is("deleted_at", null)
      : Promise.resolve({ data: null }),
    emp
      ? supabase.from("attendance_punches").select("punch_type, punch_time, verification").eq("employee_id", emp.id).eq("work_date", today).neq("verification", "rejected").order("punch_time")
      : Promise.resolve({ data: [] }),
    getAttendanceQueue(session),
    seesOrg
      ? supabase.from("attendance_punches").select("employee_id").eq("work_date", today).eq("punch_type", "in").neq("verification", "rejected")
      : Promise.resolve({ data: null }),
  ]);
  const punches = (todayPunches.data ?? []) as { punch_type: "in" | "out"; punch_time: string }[];
  const firstIn = punches.find((p) => p.punch_type === "in");
  const lastPunch = punches.at(-1);
  const attPending = attQueue.punches.length + attQueue.regularizations.length;
  const presentCount = new Set((presentToday.data ?? []).map((p) => p.employee_id)).size;

  const active = (headcount.data ?? []).filter((e) => e.status !== "exited" && e.status !== "draft");
  const byDept = new Map<string, number>();
  for (const e of active) {
    const name = (e.department as unknown as { name: string } | null)?.name ?? "Unassigned";
    byDept.set(name, (byDept.get(name) ?? 0) + 1);
  }

  const noAccess = !emp && session.roles.size === 0;

  return (
    <>
      <PageHeader
        title={`Welcome${emp ? `, ${emp.full_name.split(" ")[0]}` : ""}`}
        description={new Intl.DateTimeFormat("en-PK", { dateStyle: "full", timeZone: "Asia/Karachi" }).format(new Date())}
      />

      {noAccess && (
        <div className="mb-6">
          <Notice>
            Your account (<strong>{session.email}</strong>) isn&apos;t linked to an employee record yet. HR links accounts
            by work email — ask HR to add you, or to check that your work email matches this address.
          </Notice>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {emp && (
          <Link href="/attendance" className="block">
            <Stat
              label="Today"
              value={firstIn ? (lastPunch?.punch_type === "out" ? "Checked out" : "Checked in") : "Not checked in"}
              hint={firstIn ? `In at ${fmtTime(firstIn.punch_time)}${lastPunch?.punch_type === "out" ? ` · out ${fmtTime(lastPunch.punch_time)}` : ""}` : "Mark attendance →"}
            />
          </Link>
        )}
        {attPending > 0 && (
          <Link href="/attendance/approvals" className="block">
            <Stat label="Attendance to approve" value={attPending} hint="Field punches & corrections →" />
          </Link>
        )}
        {seesOrg && <Stat label="Checked in today" value={presentCount} hint={`of ${active.length} active`} />}
        {(balances.data as LeaveBalance[] | null)?.slice(0, 2).map((b) => (
          <Stat key={b.id} label={b.leave_type} value={fmtDays(b.available)} hint={`of ${b.entitled} · ${b.pending} pending`} />
        ))}
        {pendingApprovals.length > 0 && (
          <Link href="/leave#approvals" className="block">
            <Stat label="Awaiting your decision" value={pendingApprovals.length} hint="Leave requests →" />
          </Link>
        )}
        {seesOrg && <Stat label="Active headcount" value={active.length} hint={`${byDept.size} departments`} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {emp && (
          <Card
            title="My recent leave"
            actions={
              <Link href="/leave" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
                Apply / view all →
              </Link>
            }
          >
            <Table head={["Type", "Dates", "Days", "Status"]} empty="No leave requests yet.">
              {(myRequests.data as (LeaveRequest & { leave_types: { name: string } })[] | null)?.map((r) => (
                <tr key={r.id}>
                  <Td>{r.leave_types?.name}</Td>
                  <Td>
                    {fmtDate(r.start_date)}
                    {r.end_date !== r.start_date && ` – ${fmtDate(r.end_date)}`}
                  </Td>
                  <Td>{r.days}</Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>
                      {r.status === "pending" ? `Pending ${r.stage === "hr" ? "HR" : "manager"}` : titleCase(r.status)}
                    </Badge>
                  </Td>
                </tr>
              )) ?? []}
            </Table>
          </Card>
        )}

        {seesOrg && (
          <Card title="Headcount by department">
            <Table head={["Department", "Employees"]} empty="No active employees yet.">
              {[...byDept.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => (
                  <tr key={name}>
                    <Td>{name}</Td>
                    <Td className="tabular-nums">{n}</Td>
                  </tr>
                ))}
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}

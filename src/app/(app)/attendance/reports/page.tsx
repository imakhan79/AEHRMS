import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasAnyRole, requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { pkToday, type AttendanceDay } from "@/lib/attendance";
import { Badge, Card, Input, PageHeader, Select, Stat, Table, Td, buttonClass, statusTone } from "@/components/ui";
import { fmtMinutes, fmtTime, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Attendance reports" };

const EXCEPTIONS = ["late", "absent", "missing_punch", "half_day"];

type Summary = {
  employee_id: string;
  employee_code: string;
  full_name: string;
  department: string | null;
  present: number;
  late: number;
  half_day: number;
  absent: number;
  on_leave: number;
  holiday: number;
  weekly_off: number;
  missing_punch: number;
  worked_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
};

export default async function AttendanceReportsPage({ searchParams }: PageProps<"/attendance/reports">) {
  const session = await requireSession();
  if (!hasAnyRole(session, ["hr_admin", "system_admin", "executive", "finance", "auditor", "hod"]) && !session.hasReports) {
    redirect("/attendance");
  }
  const sp = await searchParams;
  const today = pkToday();
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const filter = typeof sp.filter === "string" ? sp.filter : "";

  const supabase = await createClient();
  const [emps, days, summary] = await Promise.all([
    supabase
      .from("employees")
      .select("id, employee_code, full_name, department:departments!employees_department_id_fkey(name)")
      .is("deleted_at", null)
      .not("status", "in", "(draft,exited)")
      .order("employee_code")
      .limit(1000),
    supabase.from("attendance").select("*").eq("work_date", date).limit(1000),
    supabase.rpc("attendance_monthly_summary", { p_month: `${month}-01` }),
  ]);

  const byEmp = new Map(((days.data ?? []) as AttendanceDay[]).map((d) => [d.employee_id, d]));
  type E = { id: string; employee_code: string; full_name: string; department: { name: string } | null };
  const daily = ((emps.data ?? []) as unknown as E[])
    .map((e) => ({ e, a: byEmp.get(e.id) }))
    .filter(({ a }) => !filter || (filter === "exceptions" ? a && EXCEPTIONS.includes(a.status) : a?.status === filter));
  const counts = new Map<string, number>();
  for (const a of byEmp.values()) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  const notMarked = (emps.data?.length ?? 0) - byEmp.size;

  return (
    <>
      <PageHeader title="Attendance reports" description="Daily status, exceptions and monthly summary for the employees you can see." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Present" value={(counts.get("present") ?? 0) + (counts.get("late") ?? 0)} hint={`${counts.get("late") ?? 0} late`} />
        <Stat label="Absent" value={counts.get("absent") ?? 0} />
        <Stat label="Missing punch" value={counts.get("missing_punch") ?? 0} />
        <Stat label="On leave" value={counts.get("leave") ?? 0} />
        <Stat label="Half day" value={counts.get("half_day") ?? 0} />
        <Stat label="Not yet marked" value={notMarked} hint={date === today ? "day in progress" : undefined} />
      </div>

      <div className="space-y-6">
        <Card
          title="Daily attendance"
          actions={
            <Link className={buttonClass("secondary", "sm")} href={`/attendance/export?kind=daily&from=${date}&to=${date}`}>
              Export CSV
            </Link>
          }
        >
          <form className="-mt-1 mb-5 flex flex-wrap gap-2">
            <input type="hidden" name="month" value={month} />
            <Input type="date" name="date" defaultValue={date} max={today} className="max-w-44" />
            <Select name="filter" defaultValue={filter} className="max-w-44">
              <option value="">Everyone</option>
              <option value="exceptions">Exceptions only</option>
              {["present", "late", "absent", "missing_punch", "half_day", "leave"].map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
            <button className={buttonClass("secondary")}>Show</button>
          </form>
          <div className="pt-5">
            <Table head={["Employee", "Department", "Status", "In", "Out", "Worked", "Late", "OT"]} empty="No matching employees.">
              {daily.map(({ e, a }) => (
                <tr key={e.id}>
                  <Td>
                    <Link href={`/employees/${e.id}`} className="font-medium text-indigo-700 hover:underline">
                      {e.full_name}
                    </Link>
                    <div className="text-xs text-gray-500">{e.employee_code}</div>
                  </Td>
                  <Td>{e.department?.name ?? "—"}</Td>
                  <Td>
                    {a ? <Badge tone={statusTone(a.status)}>{titleCase(a.status)}</Badge> : <span className="text-xs text-gray-400">Not marked</span>}
                    {a?.pending_punches ? <span className="ml-1 text-xs text-amber-700">{a.pending_punches} unverified</span> : null}
                  </Td>
                  <Td>{fmtTime(a?.first_in)}</Td>
                  <Td>{fmtTime(a?.last_out)}</Td>
                  <Td>{fmtMinutes(a?.worked_minutes)}</Td>
                  <Td>{fmtMinutes(a?.late_minutes)}</Td>
                  <Td>{fmtMinutes(a?.overtime_minutes)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>

        <Card
          title="Monthly summary"
          actions={
            <div className="flex gap-2">
              <form className="flex gap-2">
                <input type="hidden" name="date" value={date} />
                <Input type="month" name="month" defaultValue={month} className="max-w-40 py-1.5 text-xs" />
                <button className={buttonClass("secondary", "sm")}>Go</button>
              </form>
              <Link className={buttonClass("secondary", "sm")} href={`/attendance/export?kind=summary&month=${month}`}>
                Export CSV
              </Link>
            </div>
          }
        >
          <Table
            head={["Employee", "Present", "Late", "Half", "Absent", "Leave", "Missing", "Worked", "Late (total)", "Overtime"]}
            empty={summary.error ? summary.error.message : "No data for this month."}
          >
            {((summary.data ?? []) as Summary[]).map((s) => (
              <tr key={s.employee_id}>
                <Td>
                  <div className="font-medium text-gray-900">{s.full_name}</div>
                  <div className="text-xs text-gray-500">
                    {s.employee_code}
                    {s.department ? ` · ${s.department}` : ""}
                  </div>
                </Td>
                <Td className="tabular-nums">{s.present}</Td>
                <Td className="tabular-nums">{s.late}</Td>
                <Td className="tabular-nums">{s.half_day}</Td>
                <Td className={`tabular-nums ${s.absent ? "font-semibold text-red-700" : ""}`}>{s.absent}</Td>
                <Td className="tabular-nums">{s.on_leave}</Td>
                <Td className="tabular-nums">{s.missing_punch}</Td>
                <Td>{fmtMinutes(s.worked_minutes)}</Td>
                <Td>{fmtMinutes(s.late_minutes)}</Td>
                <Td>{fmtMinutes(s.overtime_minutes)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

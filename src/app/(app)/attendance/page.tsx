import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { pkToday, type AttendanceDay, type Punch } from "@/lib/attendance";
import { Badge, Card, Notice, PageHeader, Table, Td, buttonClass, statusTone } from "@/components/ui";
import { fmtDate, fmtMinutes, fmtTime, titleCase } from "@/lib/format";
import { MarkAttendance } from "./mark-attendance";
import { RegularizationForm } from "./forms";
import { cancelRegularization } from "./actions";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const session = await requireSession();
  const emp = session.employee;
  if (!emp) {
    return (
      <>
        <PageHeader title="Attendance" />
        <Notice>Your account isn&apos;t linked to an employee record, so you can&apos;t mark attendance.</Notice>
      </>
    );
  }
  const sp = await searchParams;
  const today = pkToday();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const monthStart = `${month}-01`;
  const next = new Date(`${monthStart}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const monthEnd = next.toISOString().slice(0, 10);
  const prevMonth = new Date(`${monthStart}T00:00:00Z`);
  prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);

  const supabase = await createClient();
  const [todayPunches, days, regs, me] = await Promise.all([
    supabase.from("attendance_punches").select("*").eq("employee_id", emp.id).eq("work_date", today).order("punch_time"),
    supabase
      .from("attendance")
      .select("*")
      .eq("employee_id", emp.id)
      .gte("work_date", monthStart)
      .lt("work_date", monthEnd)
      .order("work_date", { ascending: false }),
    supabase
      .from("attendance_regularizations")
      .select("*")
      .eq("employee_id", emp.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("employees").select("locations(name, latitude)").eq("id", emp.id).single(),
  ]);

  const punches = (todayPunches.data ?? []) as Punch[];
  const valid = punches.filter((p) => p.verification !== "rejected");
  const nextType = valid.at(-1)?.punch_type === "in" ? "out" : "in";
  const loc = (me.data?.locations as unknown as { name: string; latitude: number | null } | null) ?? null;
  const rows = (days.data ?? []) as AttendanceDay[];
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <PageHeader title="Attendance" description={`${loc?.name ?? "No office assigned"} · ${fmtDate(today)}`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Today">
            <MarkAttendance employeeId={emp.id} nextType={nextType} locationHasGeofence={loc?.latitude != null} />
            {punches.length > 0 && (
              <ul className="mt-5 space-y-1.5 border-t border-gray-100 pt-4 text-sm">
                {punches.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-14 font-medium tabular-nums">{fmtTime(p.punch_time)}</span>
                    <span className="w-20">{p.punch_type === "in" ? "Check in" : "Check out"}</span>
                    <Badge tone={statusTone(p.verification)}>{p.verification === "auto" ? "Recorded" : titleCase(p.verification)}</Badge>
                    <span className="text-xs text-gray-500">
                      {titleCase(p.source)}
                      {p.distance_m != null && ` · ${Math.round(Number(p.distance_m))} m from office`}
                      {p.captured_offline && " · captured offline"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title={`My attendance — ${new Intl.DateTimeFormat("en-PK", { month: "long", year: "numeric" }).format(new Date(`${monthStart}T00:00:00`))}`}
            description={`Present ${count("present")} · Late ${count("late")} · Half day ${count("half_day")} · Absent ${count("absent")} · Leave ${count("leave")} · Missing punch ${count("missing_punch")}`}
            actions={
              <div className="flex gap-1">
                <Link className={buttonClass("secondary", "sm")} href={`/attendance?month=${prevMonth.toISOString().slice(0, 7)}`}>
                  ←
                </Link>
                {month < today.slice(0, 7) && (
                  <Link className={buttonClass("secondary", "sm")} href={`/attendance?month=${monthEnd.slice(0, 7)}`}>
                    →
                  </Link>
                )}
              </div>
            }
          >
            <Table head={["Date", "Status", "In", "Out", "Worked", "Late", "OT", ""]} empty="No attendance recorded this month.">
              {rows.map((d) => (
                <tr key={d.id}>
                  <Td>{fmtDate(d.work_date)}</Td>
                  <Td>
                    <Badge tone={statusTone(d.status)}>{titleCase(d.status)}</Badge>
                    {d.is_regularized && <span className="ml-1 text-xs text-gray-500">corrected</span>}
                    {d.pending_punches > 0 && <span className="ml-1 text-xs text-amber-700">{d.pending_punches} unverified</span>}
                  </Td>
                  <Td>{fmtTime(d.first_in)}</Td>
                  <Td>{fmtTime(d.last_out)}</Td>
                  <Td>{fmtMinutes(d.worked_minutes)}</Td>
                  <Td>{fmtMinutes(d.late_minutes)}</Td>
                  <Td>{fmtMinutes(d.overtime_minutes)}</Td>
                  <Td>
                    {["late", "absent", "missing_punch", "half_day"].includes(d.status) && (
                      <Link href={`/attendance?month=${month}&fix=${d.work_date}#correction`} className="text-xs text-indigo-600 hover:underline">
                        Request correction
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Request a correction" description="Forgot to punch, or the device missed you? Your manager approves.">
            <div id="correction">
              {/* key remounts the form so a "Request correction" link pre-fills its date */}
              <RegularizationForm key={String(sp.fix ?? "")} defaultDate={typeof sp.fix === "string" ? sp.fix : undefined} />
            </div>
          </Card>
          <Card title="My correction requests">
            <ul className="space-y-3 text-sm">
              {(regs.data ?? []).map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-gray-900">{fmtDate(r.work_date)}</div>
                    <div className="text-xs text-gray-500">
                      {fmtTime(r.requested_in)}–{fmtTime(r.requested_out)} · {r.reason}
                    </div>
                    {r.decision_comment && <div className="text-xs text-gray-500">“{r.decision_comment}”</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={statusTone(r.status)}>{titleCase(r.status)}</Badge>
                    {r.status === "pending" && (
                      <form action={cancelRegularization.bind(null, r.id)}>
                        <button className="text-xs text-gray-500 underline">Cancel</button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
              {!regs.data?.length && <li className="text-gray-500">None yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

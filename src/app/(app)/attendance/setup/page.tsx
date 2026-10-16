import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { fmtDateTime, fmtMinutes, titleCase } from "@/lib/format";
import { AssignShiftForm, DeviceForm, ManualPunchForm, RecomputeForm, ShiftForm } from "../forms";
import { setDefaultShift } from "../actions";

export const metadata: Metadata = { title: "Attendance setup" };

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function AttendanceSetupPage() {
  const session = await requireSession();
  if (!session.isHR) redirect("/attendance");
  const supabase = await createClient();

  const [shifts, devices, emps, depts, locs] = await Promise.all([
    supabase.from("shifts").select("*").order("code"),
    supabase.from("biometric_devices").select("id, code, name, serial_number, is_active, last_seen_at, locations(name)").order("code"),
    supabase.from("employees").select("id, full_name, employee_code").is("deleted_at", null).not("status", "in", "(draft,exited)").order("full_name"),
    supabase.from("departments").select("id, name, code").order("name"),
    supabase.from("locations").select("id, name").order("name"),
  ]);
  const shiftOpts = (shifts.data ?? []).filter((s) => s.is_active).map((s) => ({ id: s.id, label: `${s.name} (${s.code})` }));
  const empOpts = (emps.data ?? []).map((e) => ({ id: e.id, label: `${e.full_name} · ${e.employee_code}` }));

  return (
    <>
      <PageHeader title="Attendance setup" description="Shifts, rosters, biometric devices and corrections (HR)." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Shifts" description="Employees without an assignment use the default shift.">
            <Table head={["Shift", "Hours", "Grace", "Full / half day", "Overtime", "Weekly off", ""]}>
              {(shifts.data ?? []).map((s) => (
                <tr key={s.id}>
                  <Td>
                    <div className="font-medium text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-500">
                      {s.code} · {titleCase(s.shift_type)}
                    </div>
                  </Td>
                  <Td>
                    {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                  </Td>
                  <Td>{s.grace_minutes}m</Td>
                  <Td>
                    {fmtMinutes(s.full_day_minutes)} / {fmtMinutes(s.half_day_minutes)}
                  </Td>
                  <Td>{s.overtime_enabled ? `after +${s.overtime_after_minutes}m` : "Off"}</Td>
                  <Td>{(s.weekly_off_days as number[]).map((d) => DAY[d]).join(", ") || "None"}</Td>
                  <Td>
                    {s.is_default ? (
                      <Badge tone="green">Default</Badge>
                    ) : (
                      <form action={setDefaultShift.bind(null, s.id)}>
                        <button className={buttonClass("secondary", "sm")}>Make default</button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Assign shift / roster" description="Rotating rosters: add consecutive assignments with end dates.">
            <AssignShiftForm
              shifts={shiftOpts}
              employees={empOpts}
              departments={(depts.data ?? []).map((d) => ({ id: d.id, label: `${d.name} (${d.code})` }))}
            />
          </Card>

          <Card title="Biometric devices" description="Devices post punches to the ingestion endpoint with their API key.">
            <Table head={["Device", "Location", "Serial", "Last seen", "Status"]} empty="No devices registered.">
              {(devices.data ?? []).map((d) => (
                <tr key={d.id}>
                  <Td>
                    <div className="font-medium text-gray-900">{d.name}</div>
                    <div className="font-mono text-xs text-gray-500">{d.code}</div>
                  </Td>
                  <Td>{(d.locations as unknown as { name: string } | null)?.name ?? "—"}</Td>
                  <Td>{d.serial_number ?? "—"}</Td>
                  <Td>{d.last_seen_at ? fmtDateTime(d.last_seen_at) : <span className="text-amber-700">Never</span>}</Td>
                  <Td>
                    <Badge tone={d.is_active ? "green" : "gray"}>{d.is_active ? "Active" : "Disabled"}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
            <details className="mt-6 rounded-lg bg-gray-50 p-4 text-xs text-gray-700">
              <summary className="cursor-pointer font-medium">Integration details for IT</summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap">{`POST https://ae-hrms.vercel.app/api/attendance/biometric
Headers:  x-device-code: <DEVICE CODE>
          x-device-key:  <API KEY>
Body:     {"events": [{"user_id": "1003", "timestamp": "2026-10-16T09:02:00+05:00", "type": "in"}]}

"user_id" = the employee's Biometric ID (set on the employee record).
"type" is optional — first punch of the day becomes "in", later ones "out".
Re-sending the same events is safe (duplicates are ignored).`}</pre>
            </details>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Add shift">
            <ShiftForm />
          </Card>
          <Card title="Register device">
            <DeviceForm locations={(locs.data ?? []).map((l) => ({ id: l.id, label: l.name }))} />
          </Card>
          <Card title="Manual punch" description="For device outages. Every entry is audited.">
            <ManualPunchForm employees={empOpts} />
          </Card>
          <Card title="Recompute attendance" description="After changing shifts, holidays or leave for past dates (max 62 days).">
            <RecomputeForm />
          </Card>
        </div>
      </div>
    </>
  );
}

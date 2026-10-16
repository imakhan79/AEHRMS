import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceDay } from "@/lib/attendance";
import { Badge, Card, Table, Td, statusTone } from "@/components/ui";
import { fmtDate, fmtMinutes, fmtTime, titleCase } from "@/lib/format";
import { AssignShiftForm } from "./forms";

/** Shift roster + recent attendance, shown on the employee record. */
export async function EmployeeAttendanceCard({
  employeeId,
  biometricId,
  canEdit,
}: {
  employeeId: string;
  biometricId: string | null;
  canEdit: boolean;
}) {
  const supabase = await createClient();
  const [assignments, recent, shifts] = await Promise.all([
    supabase
      .from("employee_shifts")
      .select("id, effective_from, effective_to, shifts(name, start_time, end_time)")
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false })
      .limit(10),
    supabase.from("attendance").select("*").eq("employee_id", employeeId).order("work_date", { ascending: false }).limit(14),
    canEdit ? supabase.from("shifts").select("id, name, code, is_default").eq("is_active", true).order("name") : Promise.resolve({ data: [] }),
  ]);
  const defaultShift = (shifts.data ?? []).find((s) => s.is_default);

  type A = { id: string; effective_from: string; effective_to: string | null; shifts: { name: string; start_time: string; end_time: string } | null };

  return (
    <Card
      title="Shift & attendance"
      description={`Biometric ID: ${biometricId ?? "not set"}`}
      actions={
        <Link href="/attendance/reports" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
          Reports →
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Roster</h3>
          <ul className="space-y-1.5 text-sm">
            {((assignments.data ?? []) as unknown as A[]).map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span className="text-gray-900">
                  {a.shifts?.name} <span className="text-xs text-gray-500">{a.shifts?.start_time.slice(0, 5)}–{a.shifts?.end_time.slice(0, 5)}</span>
                </span>
                <span className="whitespace-nowrap text-xs text-gray-500">
                  {fmtDate(a.effective_from)} → {a.effective_to ? fmtDate(a.effective_to) : "ongoing"}
                </span>
              </li>
            ))}
            {!assignments.data?.length && <li className="text-gray-500">Default shift{defaultShift ? ` (${defaultShift.name})` : ""}.</li>}
          </ul>
          {canEdit && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <AssignShiftForm
                fixedEmployeeId={employeeId}
                shifts={(shifts.data ?? []).map((s) => ({ id: s.id, label: `${s.name} (${s.code})` }))}
              />
            </div>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Last 14 days</h3>
          <div className="pt-5">
            <Table head={["Date", "Status", "In", "Out", "Worked"]} empty="No attendance yet.">
              {((recent.data ?? []) as AttendanceDay[]).map((d) => (
                <tr key={d.id}>
                  <Td>{fmtDate(d.work_date)}</Td>
                  <Td>
                    <Badge tone={statusTone(d.status)}>{titleCase(d.status)}</Badge>
                  </Td>
                  <Td>{fmtTime(d.first_in)}</Td>
                  <Td>{fmtTime(d.last_out)}</Td>
                  <Td>{fmtMinutes(d.worked_minutes)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      </div>
    </Card>
  );
}

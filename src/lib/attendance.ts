import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth";

export type AttendanceStatus =
  | "present"
  | "late"
  | "half_day"
  | "absent"
  | "leave"
  | "holiday"
  | "weekly_off"
  | "missing_punch";

export interface AttendanceDay {
  id: string;
  employee_id: string;
  work_date: string;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  status: AttendanceStatus;
  is_regularized: boolean;
  pending_punches: number;
}

export interface Punch {
  id: string;
  employee_id: string;
  punch_time: string;
  work_date: string;
  punch_type: "in" | "out";
  source: "biometric" | "mobile" | "manual" | "web";
  distance_m: number | null;
  within_geofence: boolean | null;
  accuracy_m: number | null;
  selfie_path: string | null;
  captured_offline: boolean;
  verification: "auto" | "pending" | "verified" | "rejected";
  verification_note: string | null;
}

/** Today's date in Pakistan (all current locations use Asia/Karachi). */
export function pkToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
}

type Who = { id: string; full_name: string; employee_code: string; manager_id: string | null; department_id: string | null };

function canDecide(session: Session, e: Who | null, stage?: string): boolean {
  if (!e || e.id === session.employee?.id) return false;
  if (session.isHR) return true;
  if (stage && stage !== "manager") return false;
  return (
    (!!session.employee && e.manager_id === session.employee.id) ||
    (!!e.department_id && session.hodDepartments.includes(e.department_id))
  );
}

/** Field punches and corrections the current user may decide (7.3, 7.4). */
export async function getAttendanceQueue(session: Session) {
  const supabase = await createClient();
  const who = "employees!attendance_punches_employee_id_fkey(id, full_name, employee_code, manager_id, department_id)";
  const [punches, regs] = await Promise.all([
    supabase
      .from("attendance_punches")
      .select(`*, ${who}`)
      .eq("verification", "pending")
      .order("punch_time")
      .limit(200),
    supabase
      .from("attendance_regularizations")
      .select("*, employees!attendance_regularizations_employee_id_fkey(id, full_name, employee_code, manager_id, department_id)")
      .eq("status", "pending")
      .order("created_at")
      .limit(200),
  ]);
  type P = Punch & { employees: Who | null };
  type R = {
    id: string;
    work_date: string;
    requested_in: string;
    requested_out: string;
    reason: string;
    stage: string;
    employees: Who | null;
  };
  return {
    punches: ((punches.data ?? []) as unknown as P[]).filter((p) => canDecide(session, p.employees)),
    regularizations: ((regs.data ?? []) as unknown as R[]).filter((r) => canDecide(session, r.employees, r.stage)),
  };
}

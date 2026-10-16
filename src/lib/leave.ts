import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth";

export interface QueueItem {
  id: string;
  start_date: string;
  end_date: string;
  half_day: boolean;
  days: number;
  reason: string | null;
  stage: "manager" | "hr";
  created_at: string;
  leave_types: { name: string } | null;
  employees: {
    id: string;
    full_name: string;
    employee_code: string;
    manager_id: string | null;
    department_id: string | null;
  } | null;
}

/**
 * Pending leave the current user can actually decide (7.2): HR sees both stages;
 * managers/HODs see the manager stage for their team. Never their own requests.
 * Read access (e.g. Executive, Finance) is not decision rights, hence the filter.
 */
export async function getApprovalQueue(session: Session): Promise<QueueItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leave_requests")
    .select(
      "id, start_date, end_date, half_day, days, reason, stage, created_at, leave_types(name), employees!leave_requests_employee_id_fkey(id, full_name, employee_code, manager_id, department_id)",
    )
    .eq("status", "pending")
    .order("created_at");

  const me = session.employee?.id;
  return ((data ?? []) as unknown as QueueItem[]).filter((r) => {
    const e = r.employees;
    if (!e || e.id === me) return false;
    if (session.isHR) return true;
    if (r.stage !== "manager") return false;
    return (me && e.manager_id === me) || (e.department_id && session.hodDepartments.includes(e.department_id));
  });
}

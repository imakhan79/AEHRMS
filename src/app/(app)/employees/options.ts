import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeOptions } from "./employee-form";

export async function loadEmployeeOptions(): Promise<EmployeeOptions> {
  const supabase = await createClient();
  const [d, p, l, m] = await Promise.all([
    supabase.from("departments").select("id, name, code").eq("is_active", true).order("name"),
    supabase.from("positions").select("id, title, code").eq("is_active", true).order("title"),
    supabase.from("locations").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("employees")
      .select("id, full_name, employee_code")
      .is("deleted_at", null)
      .neq("status", "exited")
      .order("full_name"),
  ]);
  return {
    departments: (d.data ?? []).map((x) => ({ id: x.id, label: `${x.name} (${x.code})` })),
    positions: (p.data ?? []).map((x) => ({ id: x.id, label: `${x.title} (${x.code})` })),
    locations: (l.data ?? []).map((x) => ({ id: x.id, label: x.name })),
    managers: (m.data ?? []).map((x) => ({ id: x.id, label: `${x.full_name} · ${x.employee_code}` })),
  };
}

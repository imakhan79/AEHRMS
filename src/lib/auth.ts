import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Employee } from "@/lib/types";

export interface Session {
  userId: string;
  email: string;
  roles: Set<AppRole>;
  /** Department IDs where the user holds a scoped HOD role. */
  hodDepartments: string[];
  employee: Pick<Employee, "id" | "full_name" | "employee_code" | "department_id" | "manager_id"> | null;
  isHR: boolean;
  isAdmin: boolean;
}

/**
 * Data Access Layer: verifies the JWT (getClaims) and loads roles once per request.
 * UI checks here are for navigation only — the database RLS policies are the real gate.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const [{ data: roleRows }, { data: employee }] = await Promise.all([
    supabase.from("user_roles").select("role, department_id").eq("user_id", claims.sub),
    supabase
      .from("employees")
      .select("id, full_name, employee_code, department_id, manager_id")
      .eq("user_id", claims.sub)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  const roles = new Set<AppRole>((roleRows ?? []).map((r) => r.role as AppRole));
  if (employee) roles.add("employee");

  return {
    userId: claims.sub,
    email: (claims.email as string) ?? "",
    roles,
    hodDepartments: (roleRows ?? [])
      .filter((r) => r.role === "hod" && r.department_id)
      .map((r) => r.department_id as string),
    employee,
    isHR: roles.has("hr_admin") || roles.has("system_admin"),
    isAdmin: roles.has("system_admin"),
  };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export function hasAnyRole(session: Session, roles: AppRole[]): boolean {
  return roles.some((r) => session.roles.has(r));
}

/** Roles that may browse the employee list (others only see themselves / their team). */
export const DIRECTORY_ROLES: AppRole[] = [
  "hr_admin",
  "system_admin",
  "executive",
  "finance",
  "recruiter",
  "auditor",
  "hod",
];

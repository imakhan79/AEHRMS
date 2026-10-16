import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { removeRole } from "../actions";
import { AssignForm } from "./assign-form";

export const metadata: Metadata = { title: "Users & roles" };

export default async function RolesPage() {
  const session = await requireSession();
  if (!session.isAdmin) redirect("/dashboard");
  const supabase = await createClient();

  const [roles, linked, depts] = await Promise.all([
    supabase.from("user_roles").select("id, user_id, role, created_at, departments(name)").order("created_at"),
    supabase.from("employees").select("user_id, full_name, employee_code, work_email").not("user_id", "is", null).order("full_name"),
    supabase.from("departments").select("id, name, code").order("name"),
  ]);

  const nameFor = new Map(
    (linked.data ?? []).map((e) => [e.user_id as string, `${e.full_name} · ${e.employee_code}`]),
  );
  const label = (userId: string) =>
    nameFor.get(userId) ?? (userId === session.userId ? `${session.email} (you)` : `Account ${userId.slice(0, 8)}…`);

  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Everyone with an employee record is an Employee automatically. Assign extra roles here (BRD 5.2)."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Role assignments">
            <Table head={["User", "Role", "Scope", "Since", ""]} empty="No roles assigned yet.">
              {(roles.data ?? []).map((r) => {
                const row = r as unknown as { id: string; user_id: string; role: AppRole; created_at: string; departments: { name: string } | null };
                return (
                  <tr key={row.id}>
                    <Td className="font-medium text-gray-900">{label(row.user_id)}</Td>
                    <Td>
                      <Badge tone={row.role === "system_admin" ? "red" : row.role === "hr_admin" ? "blue" : "gray"}>
                        {ROLE_LABELS[row.role]}
                      </Badge>
                    </Td>
                    <Td>{row.departments?.name ?? "All"}</Td>
                    <Td>{fmtDate(row.created_at)}</Td>
                    <Td>
                      {!(row.user_id === session.userId && row.role === "system_admin") && (
                        <form action={removeRole.bind(null, row.id)}>
                          <button className={buttonClass("danger", "sm")}>Remove</button>
                        </form>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
        <Card title="Assign a role">
          <AssignForm
            users={(linked.data ?? []).map((e) => ({ id: e.user_id as string, label: `${e.full_name} · ${e.work_email ?? e.employee_code}` }))}
            departments={(depts.data ?? []).map((d) => ({ id: d.id, label: `${d.name} (${d.code})` }))}
          />
        </Card>
      </div>
    </>
  );
}

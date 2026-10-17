import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Notice, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { setUserDisabled } from "../actions";
import { InviteForm, ResetPasswordForm } from "../forms";

export const metadata: Metadata = { title: "User accounts" };

type Account = {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed: boolean;
  disabled: boolean;
  employee_id: string | null;
  employee_name: string | null;
  employee_code: string | null;
  roles: string[];
};

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const session = await requireSession();
  if (!session.isAdmin) redirect("/dashboard");
  const sp = await searchParams;
  const filter = sp.show === "disabled" || sp.show === "unlinked" ? sp.show : "";
  const supabase = await createClient();
  const [{ data, error }, { data: noLogin }] = await Promise.all([
    supabase.rpc("admin_list_users"),
    supabase
      .from("employees")
      .select("id, full_name, employee_code, work_email")
      .is("user_id", null)
      .is("deleted_at", null)
      .neq("status", "exited")
      .not("work_email", "is", null)
      .order("full_name"),
  ]);
  const all = (data ?? []) as Account[];
  const accounts = all.filter((a) => (filter === "disabled" ? a.disabled : filter === "unlinked" ? !a.employee_id : true));
  const tab = (key: string, label: string, n: number) => (
    <Link
      href={key ? `/admin/users?show=${key}` : "/admin/users"}
      aria-current={filter === key ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === key ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-gray-50"}`}
    >
      {label} <span className="tabular-nums text-gray-400">{n}</span>
    </Link>
  );

  return (
    <>
      <PageHeader
        title="User accounts"
        description="Invite employees, disable access and send password resets (ADM-01). Assign roles under Users & roles."
        actions={
          <Link href="/admin/roles" className={buttonClass("secondary")}>
            Users & roles
          </Link>
        }
      />
      {error && (
        <div className="mb-6">
          <Notice tone="red">{error.message}</Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="-mt-1 mb-5 flex flex-wrap gap-1">
              {tab("", "All", all.length)}
              {tab("disabled", "Disabled", all.filter((a) => a.disabled).length)}
              {tab("unlinked", "No employee record", all.filter((a) => !a.employee_id).length)}
            </div>
            <div className="pt-5">
              <Table head={["Account", "Roles", "Last sign-in", "Status", ""]} empty="No accounts match.">
                {accounts.map((a) => {
                  const self = a.user_id === session.userId;
                  return (
                    <tr key={a.user_id}>
                      <Td>
                        <div className="font-medium text-gray-900">
                          {a.employee_id ? (
                            <Link href={`/employees/${a.employee_id}`} className="hover:underline">
                              {a.employee_name}
                            </Link>
                          ) : (
                            a.email
                          )}
                          {self && <span className="ml-1 text-xs font-normal text-gray-500">(you)</span>}
                        </div>
                        <div className="text-xs text-gray-500">
                          {a.employee_id ? `${a.employee_code} · ${a.email}` : `No employee record · since ${fmtDate(a.created_at)}`}
                        </div>
                      </Td>
                      <Td className="text-xs">
                        {a.roles.length ? a.roles.map((r) => ROLE_LABELS[r as AppRole] ?? r).join(", ") : a.employee_id ? "Employee" : "—"}
                      </Td>
                      <Td className="text-xs">{a.last_sign_in_at ? fmtDateTime(a.last_sign_in_at) : "Never"}</Td>
                      <Td>
                        {a.disabled ? <Badge tone="red">Disabled</Badge> : a.confirmed ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Invited</Badge>}
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-2">
                          {!a.disabled && <ResetPasswordForm email={a.email} />}
                          {!self && (
                            <form action={setUserDisabled.bind(null, a.user_id, !a.disabled)}>
                              <button className={buttonClass(a.disabled ? "secondary" : "danger", "sm")}>{a.disabled ? "Enable" : "Disable"}</button>
                            </form>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Invite an employee" description="Sends a sign-in link to their work email. The login links to their employee record automatically.">
            <InviteForm employees={(noLogin ?? []).map((e) => ({ id: e.id, label: `${e.full_name} · ${e.work_email}` }))} />
          </Card>
          <Card title="How access works">
            <ul className="list-disc space-y-1.5 pl-4 text-xs text-gray-600">
              <li>Disabling signs the user out everywhere and blocks new sign-ins. Their records and history stay.</li>
              <li>A reset link opens a page where the user chooses a new password.</li>
              <li>An exited employee keeps their account until you disable it. Disable it on their last working day.</li>
              <li>Every disable and enable is written to the audit log.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

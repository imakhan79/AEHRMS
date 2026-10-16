import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui";
import { Badge, Card, Input, PageHeader, Select, Table, Td, statusTone } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { EMPLOYEE_STATUSES } from "@/lib/types";

export const metadata: Metadata = { title: "Employees" };

type Row = {
  id: string;
  employee_code: string;
  full_name: string;
  work_email: string | null;
  status: string;
  joining_date: string | null;
  department: { name: string } | null;
  positions: { title: string } | null;
  locations: { name: string } | null;
};

export default async function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const status = typeof sp.status === "string" && (EMPLOYEE_STATUSES as string[]).includes(sp.status) ? sp.status : "";

  const supabase = await createClient();
  // RLS decides who appears: HR/Exec/Finance see all, managers their team, employees themselves.
  let query = supabase
    .from("employees")
    .select("id, employee_code, full_name, work_email, status, joining_date, department:departments!employees_department_id_fkey(name), positions(title), locations(name)")
    .is("deleted_at", null)
    .order("employee_code")
    .limit(500);
  if (q) {
    const term = q.replace(/[%_,()]/g, " ");
    query = query.or(`full_name.ilike.%${term}%,employee_code.ilike.%${term}%,work_email.ilike.%${term}%`);
  }
  if (status) query = query.eq("status", status);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader
        title="Employees"
        description={`${rows.length} record${rows.length === 1 ? "" : "s"} visible to you`}
        actions={
          session.isHR && (
            <Link href="/employees/new" className={buttonClass()}>
              + New employee
            </Link>
          )
        }
      />
      <Card>
        <form className="-mt-1 mb-5 flex flex-wrap gap-2">
          <Input name="q" defaultValue={q} placeholder="Search name, code or email…" className="max-w-xs" />
          <Select name="status" defaultValue={status} className="max-w-40">
            <option value="">All statuses</option>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
        <div className="pt-5">
          <Table head={["Code", "Name", "Department", "Position", "Location", "Joined", "Status"]} empty="No employees match.">
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <Td className="font-mono text-xs">{e.employee_code}</Td>
                <Td>
                  <Link href={`/employees/${e.id}`} className="font-medium text-indigo-700 hover:underline">
                    {e.full_name}
                  </Link>
                  {e.work_email && <div className="text-xs text-gray-500">{e.work_email}</div>}
                </Td>
                <Td>{e.department?.name ?? "—"}</Td>
                <Td>{e.positions?.title ?? "—"}</Td>
                <Td>{e.locations?.name ?? "—"}</Td>
                <Td>{fmtDate(e.joining_date)}</Td>
                <Td>
                  <Badge tone={statusTone(e.status)}>{titleCase(e.status)}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
    </>
  );
}

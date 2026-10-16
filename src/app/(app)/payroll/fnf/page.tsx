import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";

export const metadata: Metadata = { title: "Full & final settlements" };

export default async function FnfListPage() {
  const session = await requireSession();
  if (!session.canReadPayroll) redirect("/dashboard");
  const supabase = await createClient();
  const [{ data: leavers }, { data: settlements }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, employee_code, full_name, status, exit_date")
      .not("exit_date", "is", null)
      .is("deleted_at", null)
      .order("exit_date", { ascending: false }),
    supabase.from("fnf_settlements").select("employee_id, status, net_amount"),
  ]);
  const byEmp = new Map((settlements ?? []).map((s) => [s.employee_id, s]));

  return (
    <>
      <PageHeader
        title="Full & final settlements"
        description="Employees with an exit date. The final month's salary is paid through the regular payroll run; this covers leave encashment, gratuity and recoveries."
      />
      <Card>
        <Table head={["Employee", "Status", "Exit date", "Settlement", "Net", ""]} empty="No employees with an exit date. Set one on the employee record (Edit employee → Exit date).">
          {(leavers ?? []).map((e) => {
            const s = byEmp.get(e.id);
            return (
              <tr key={e.id}>
                <Td>
                  <div className="font-medium text-gray-900">{e.full_name}</div>
                  <div className="text-xs text-gray-500">{e.employee_code}</div>
                </Td>
                <Td>{titleCase(e.status)}</Td>
                <Td>{fmtDate(e.exit_date)}</Td>
                <Td>{s ? <Badge tone={s.status === "approved" ? "green" : "amber"}>{titleCase(s.status)}</Badge> : <span className="text-xs text-gray-400">Not started</span>}</Td>
                <Td className="tabular-nums">{s ? money(s.net_amount) : "—"}</Td>
                <Td>
                  <Link href={`/payroll/fnf/${e.id}`} className="text-xs text-indigo-600 hover:underline">
                    {s ? "Open" : "Prepare"}
                  </Link>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

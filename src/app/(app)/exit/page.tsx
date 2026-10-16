import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { SeparationDecision, SeparationForm } from "../lifecycle-forms";

export const metadata: Metadata = { title: "Exit & clearance" };

const TONE = { submitted: "amber", approved: "blue", completed: "green", rejected: "red", withdrawn: "gray" } as const;

export default async function ExitPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const me = session.employee?.id;
  const [{ data: seps }, { data: people }] = await Promise.all([
    supabase
      .from("separations")
      .select("*, employees!separations_employee_id_fkey(full_name, employee_code, manager_id, department_id), clearance_items(status)")
      .order("created_at", { ascending: false }),
    session.isHR ? supabase.from("employees").select("id, full_name, employee_code").is("deleted_at", null).not("status", "in", "(exited,draft)").order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const all = seps ?? [];
  const mine = all.find((s) => s.employee_id === me && ["submitted", "approved"].includes(s.status));
  const others = all.filter((s) => s.employee_id !== me);
  const canDecide = (s: (typeof all)[number]) =>
    s.status === "submitted" &&
    s.employee_id !== me &&
    (session.isHR || s.employees?.manager_id === me || (!!s.employees?.department_id && session.hodDepartments.includes(s.employees.department_id)));

  return (
    <>
      <PageHeader title="Exit & clearance" description="Resignation → approval → notice period → department, assets, finance, IT and HR clearance → final settlement." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {others.length > 0 && (
            <Card title="Separations">
              <Table head={["Employee", "Type", "Last day", "Clearance", "Status", ""]}>
                {others.map((s) => {
                  const items = s.clearance_items ?? [];
                  const done = items.filter((i: { status: string }) => i.status === "cleared").length;
                  return (
                    <tr key={s.id}>
                      <Td>
                        <Link href={`/exit/${s.id}`} className="font-medium text-indigo-700 hover:underline">
                          {s.employees?.full_name}
                        </Link>
                        <div className="text-xs text-gray-500">{s.employees?.employee_code}</div>
                      </Td>
                      <Td>{titleCase(s.separation_type)}</Td>
                      <Td>{fmtDate(s.last_working_day)}</Td>
                      <Td className="tabular-nums">{items.length ? `${done}/${items.length}` : "—"}</Td>
                      <Td>
                        <Badge tone={TONE[s.status as keyof typeof TONE]}>{titleCase(s.status)}</Badge>
                      </Td>
                      <Td>{canDecide(s) && <SeparationDecision id={s.id} />}</Td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          )}
          {session.employee && (
            <Card title="My resignation">
              {mine ? (
                <p className="text-sm">
                  Your {titleCase(mine.separation_type).toLowerCase()} is <strong>{mine.status}</strong> · last working day {fmtDate(mine.last_working_day)}.{" "}
                  <Link href={`/exit/${mine.id}`} className="text-indigo-700 hover:underline">
                    View progress →
                  </Link>
                </p>
              ) : (
                <SeparationForm />
              )}
            </Card>
          )}
        </div>
        {session.isHR && (
          <Card title="Initiate a separation" description="Termination, retirement or contract end — or record a resignation for an employee.">
            <SeparationForm people={(people ?? []).map((p) => ({ id: p.id, label: `${p.full_name} · ${p.employee_code}` }))} />
          </Card>
        )}
      </div>
    </>
  );
}

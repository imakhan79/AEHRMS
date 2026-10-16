import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui";
import { Badge, Card, DescList, PageHeader, Table, Td, statusTone } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import type { Employee, LeaveBalance } from "@/lib/types";
import { EmployeeForm } from "../employee-form";
import { loadEmployeeOptions } from "../options";
import { AllocateForm, DependentForm, EmergencyForm, HistoryForm, PrivateForm, UploadForm } from "../section-forms";
import { DocumentsTable, EmergencyTable, mask } from "../shared";
import { allocateDefaultLeave } from "../actions";
import { EmployeeAttendanceCard } from "../../attendance/employee-card";

export const metadata: Metadata = { title: "Employee" };

type Full = Employee & {
  department: { name: string } | null;
  positions: { title: string; grade: string | null } | null;
  locations: { name: string } | null;
  manager: { id: string; full_name: string } | null;
};

export default async function EmployeePage({ params }: PageProps<"/employees/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireSession();
  const supabase = await createClient();

  const { data } = await supabase
    .from("employees")
    .select("*, department:departments!employees_department_id_fkey(name), positions(title, grade), locations(name), manager:manager_id(id, full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound(); // also what RLS returns when you may not see this person
  const e = data as unknown as Full;
  const hr = session.isHR;
  const isSelf = session.employee?.id === e.id;

  const [priv, balances, history, dependents, leaveTypes, options] = await Promise.all([
    supabase.from("employee_private").select("*").eq("employee_id", id).maybeSingle(),
    supabase.from("leave_balance_summary").select("*").eq("employee_id", id).order("year", { ascending: false }),
    supabase
      .from("employment_history")
      .select("id, change_type, effective_date, notes, to_department:departments!employment_history_to_department_id_fkey(name), to_position:positions!employment_history_to_position_id_fkey(title)")
      .eq("employee_id", id)
      .order("effective_date", { ascending: false }),
    supabase.from("employee_dependents").select("*").eq("employee_id", id).order("created_at"),
    hr ? supabase.from("leave_types").select("id, name, days_per_year").eq("is_active", true).order("name") : Promise.resolve({ data: [] }),
    hr ? loadEmployeeOptions() : Promise.resolve(null),
  ]);
  const p = priv.data as Record<string, string | null> | null;
  const canSeePrivate = Boolean(p) || hr;

  return (
    <>
      <PageHeader
        title={e.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{e.employee_code}</span>·<span>{e.positions?.title ?? "No position"}</span>·
            <span>{e.department?.name ?? "No department"}</span>
            <Badge tone={statusTone(e.status)}>{titleCase(e.status)}</Badge>
            {!e.user_id && <Badge tone="amber">No login linked</Badge>}
          </span>
        }
        actions={
          <Link href="/employees" className={buttonClass("secondary")}>
            ← All employees
          </Link>
        }
      />

      <div className="space-y-6">
        <Card title="Employment & personal">
          <DescList
            items={[
              ["Work email", e.work_email],
              ["Phone", e.phone],
              ["Personal email", e.personal_email],
              ["Line manager", e.manager ? <Link className="text-indigo-700 hover:underline" href={`/employees/${e.manager.id}`}>{e.manager.full_name}</Link> : null],
              ["Location", e.locations?.name],
              ["Employment type", titleCase(e.employment_type)],
              ["Grade", e.positions?.grade],
              ["Joined", fmtDate(e.joining_date)],
              ["Probation ends", fmtDate(e.probation_end_date)],
              ["Confirmed", fmtDate(e.confirmation_date)],
              ["Contract ends", fmtDate(e.contract_end_date)],
              ["Date of birth", fmtDate(e.date_of_birth)],
              ["Gender", titleCase(e.gender)],
              ["Marital status", titleCase(e.marital_status)],
              ["Father's name", e.father_name],
              ["Address", [e.address, e.city].filter(Boolean).join(", ")],
            ]}
          />
          {hr && options && (
            <details className="mt-6 rounded-lg border border-gray-200 p-4">
              <summary className="cursor-pointer text-sm font-medium text-indigo-700">Edit employee</summary>
              <div className="mt-4">
                <EmployeeForm employee={e} options={options} />
              </div>
            </details>
          )}
        </Card>

        {canSeePrivate && (
          <Card title="CNIC, bank & statutory" description="Restricted data — visible to HR, Finance, Auditors and the employee.">
            {hr ? (
              <PrivateForm employeeId={id} values={p ?? {}} />
            ) : (
              <DescList
                items={[
                  ["CNIC", isSelf ? mask(p?.cnic, 5) : p?.cnic],
                  ["NTN", p?.ntn],
                  ["EOBI no.", p?.eobi_number],
                  ["PESSI no.", p?.pessi_number],
                  ["PF no.", p?.pf_number],
                  ["Bank", [p?.bank_name, p?.bank_branch].filter(Boolean).join(" — ")],
                  ["Account title", p?.account_title],
                  ["IBAN", isSelf ? mask(p?.iban, 4) : p?.iban],
                ]}
              />
            )}
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card
            title="Leave balances"
            actions={
              hr && (
                <form action={allocateDefaultLeave.bind(null, id)}>
                  <button className={buttonClass("secondary", "sm")}>Allocate {new Date().getFullYear()} defaults</button>
                </form>
              )
            }
          >
            <Table head={["Year", "Type", "Entitled", "Used", "Pending", "Available"]} empty="No leave allocated.">
              {((balances.data ?? []) as LeaveBalance[]).map((b) => (
                <tr key={b.id}>
                  <Td>{b.year}</Td>
                  <Td>{b.leave_type}</Td>
                  <Td>{b.entitled}</Td>
                  <Td>{b.used}</Td>
                  <Td>{b.pending}</Td>
                  <Td className="font-semibold">{b.available}</Td>
                </tr>
              ))}
            </Table>
            {hr && (
              <div className="mt-8 border-t border-gray-100 pt-4">
                <AllocateForm
                  employeeId={id}
                  types={(leaveTypes.data ?? []).map((t) => ({ id: t.id, label: t.name, days: t.days_per_year }))}
                />
              </div>
            )}
          </Card>

          <Card title="Employment history">
            <Table head={["Date", "Change", "To", "Notes"]} empty="No history recorded.">
              {(history.data ?? []).map((h) => {
                const row = h as unknown as {
                  id: string;
                  change_type: string;
                  effective_date: string;
                  notes: string | null;
                  to_department: { name: string } | null;
                  to_position: { title: string } | null;
                };
                return (
                  <tr key={row.id}>
                    <Td>{fmtDate(row.effective_date)}</Td>
                    <Td>{titleCase(row.change_type)}</Td>
                    <Td>{[row.to_position?.title, row.to_department?.name].filter(Boolean).join(", ") || "—"}</Td>
                    <Td className="max-w-48 truncate">{row.notes ?? "—"}</Td>
                  </tr>
                );
              })}
            </Table>
            {hr && options && (
              <div className="mt-8 border-t border-gray-100 pt-4">
                <HistoryForm employeeId={id} departments={options.departments} positions={options.positions} />
              </div>
            )}
          </Card>

          <Card title="Emergency contacts">
            <EmergencyTable employeeId={id} canEdit={hr || isSelf} />
            {(hr || isSelf) && (
              <div className="mt-8 border-t border-gray-100 pt-4">
                <EmergencyForm employeeId={id} />
              </div>
            )}
          </Card>

          <Card title="Dependents & nominees">
            <Table head={["Name", "Relationship", "Date of birth", "Nominee"]} empty="No dependents recorded.">
              {(dependents.data ?? []).map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium text-gray-900">{d.name}</Td>
                  <Td>{titleCase(d.relationship)}</Td>
                  <Td>{fmtDate(d.date_of_birth)}</Td>
                  <Td>{d.is_nominee ? `Yes${d.nominee_share != null ? ` (${d.nominee_share}%)` : ""}` : "—"}</Td>
                </tr>
              ))}
            </Table>
            {hr && (
              <div className="mt-8 border-t border-gray-100 pt-4">
                <DependentForm employeeId={id} />
              </div>
            )}
          </Card>
        </div>

        <EmployeeAttendanceCard employeeId={id} biometricId={e.biometric_user_id} canEdit={hr} />

        {(hr || isSelf || session.roles.has("auditor")) && (
          <Card title="Personnel file">
            <DocumentsTable employeeId={id} canDelete={hr} />
            {(hr || isSelf) && (
              <div className="mt-8 border-t border-gray-100 pt-4">
                <UploadForm employeeId={id} />
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

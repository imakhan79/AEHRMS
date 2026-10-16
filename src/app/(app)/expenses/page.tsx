import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Notice, PageHeader, Table, Td, statusTone } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";
import { NewClaimForm, TravelForm } from "../workflow-forms";
import { cancelRequest } from "../workflow-actions";

export const metadata: Metadata = { title: "Expenses & travel" };

export default async function ExpensesPage() {
  const session = await requireSession();
  if (!session.employee) {
    return (
      <>
        <PageHeader title="Expenses & travel" />
        <Notice>Your account isn&apos;t linked to an employee record.</Notice>
      </>
    );
  }
  const supabase = await createClient();
  const [{ data: trips }, { data: claims }] = await Promise.all([
    supabase.from("travel_requests").select("*").eq("employee_id", session.employee.id).order("created_at", { ascending: false }),
    supabase.from("expense_claims").select("*").eq("employee_id", session.employee.id).order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <PageHeader title="Expenses & travel" description="Request travel (with an advance if needed), then claim expenses with receipts. Manager approves, Finance verifies and reimburses." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="My expense claims">
            <Table head={["Claim", "Title", "Total", "Advance adj.", "Payable", "Status"]} empty="No claims yet.">
              {(claims ?? []).map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/expenses/${c.id}`} className="font-mono text-xs text-indigo-700 hover:underline">
                      {c.claim_no}
                    </Link>
                  </Td>
                  <Td>{c.title}</Td>
                  <Td className="tabular-nums">{money(c.total)}</Td>
                  <Td className="tabular-nums">{money(c.advance_adjusted)}</Td>
                  <Td className="tabular-nums font-medium">{money(c.net_payable)}</Td>
                  <Td>
                    <Badge tone={c.status === "paid" ? "green" : statusTone(c.status === "submitted" ? "pending" : c.status)}>
                      {c.status === "submitted" ? `With ${c.stage}` : titleCase(c.status)}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="My travel requests">
            <Table head={["Destination", "Dates", "Estimate", "Advance", "Status", ""]} empty="No travel requests.">
              {(trips ?? []).map((t) => (
                <tr key={t.id}>
                  <Td>
                    <div className="font-medium text-gray-900">{t.destination}</div>
                    <div className="text-xs text-gray-500">{t.purpose}</div>
                  </Td>
                  <Td>
                    {fmtDate(t.start_date)} – {fmtDate(t.end_date)}
                  </Td>
                  <Td className="tabular-nums">{money(t.estimated_cost)}</Td>
                  <Td className="tabular-nums">
                    {money(t.advance_paid || t.advance_requested)}
                    {Number(t.advance_paid) > 0 && <div className="text-xs text-gray-500">paid · {money(t.advance_settled)} settled</div>}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(t.status)}>{t.status === "pending" ? `With ${t.stage}` : titleCase(t.status)}</Badge>
                  </Td>
                  <Td>
                    {t.status === "pending" && (
                      <form action={cancelRequest.bind(null, "travel_requests", t.id)}>
                        <button className="text-xs text-gray-500 underline">Cancel</button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="New expense claim">
            <NewClaimForm trips={(trips ?? []).filter((t) => t.status === "approved").map((t) => ({ id: t.id, label: `${t.destination} (${fmtDate(t.start_date)})` }))} />
          </Card>
          <Card title="Request travel">
            <TravelForm />
          </Card>
        </div>
      </div>
    </>
  );
}

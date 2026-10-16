import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, DescList, PageHeader, Stat, Table, Td, buttonClass } from "@/components/ui";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";
import { ExpenseItemForm, SubmitClaimButton } from "../../workflow-forms";
import { removeExpenseItem } from "../../workflow-actions";

export const metadata: Metadata = { title: "Expense claim" };

export default async function ClaimPage({ params }: PageProps<"/expenses/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireSession();
  const supabase = await createClient();
  const { data: c } = await supabase.from("expense_claims").select("*, employees!expense_claims_employee_id_fkey(full_name, employee_code)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: items }, { data: cats }] = await Promise.all([
    supabase.from("expense_items").select("*, expense_categories(name, requires_receipt)").eq("claim_id", id).order("expense_date"),
    supabase.from("expense_categories").select("id, name, per_item_limit, requires_receipt").eq("is_active", true).order("name"),
  ]);
  const paths = (items ?? []).map((i) => i.receipt_path).filter(Boolean) as string[];
  const { data: signed } = paths.length ? await supabase.storage.from("expense-receipts").createSignedUrls(paths, 600) : { data: [] };
  const url = new Map<string, string>();
  for (const s of signed ?? []) if (s.path && s.signedUrl) url.set(s.path, s.signedUrl);
  const mine = c.employee_id === session.employee?.id;
  const draft = c.status === "draft" && mine;

  return (
    <>
      <PageHeader
        title={`${c.claim_no} — ${c.title}`}
        description={c.employees?.full_name}
        actions={
          <Link href={mine ? "/expenses" : "/expenses/approvals"} className={buttonClass("secondary")}>
            ← Back
          </Link>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Total" value={money(c.total)} />
        <Stat label="Advance adjusted" value={money(c.advance_adjusted)} />
        <Stat label="Payable to employee" value={money(c.net_payable)} />
        <Stat label="Status" value={c.status === "submitted" ? `With ${c.stage}` : titleCase(c.status)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Expenses" className="lg:col-span-2">
          <Table head={["Date", "Category", "Description", "Amount", "Receipt", ""]} empty="No expenses added yet.">
            {(items ?? []).map((i) => (
              <tr key={i.id}>
                <Td>{fmtDate(i.expense_date)}</Td>
                <Td>{i.expense_categories?.name}</Td>
                <Td>{i.description}</Td>
                <Td className="tabular-nums">{money(i.amount)}</Td>
                <Td>
                  {i.receipt_path && url.get(i.receipt_path) ? (
                    <a href={url.get(i.receipt_path)} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">
                      View
                    </a>
                  ) : i.expense_categories?.requires_receipt ? (
                    <Badge tone="red">Missing</Badge>
                  ) : (
                    <span className="text-xs text-gray-400">Not required</span>
                  )}
                </Td>
                <Td>
                  {draft && (
                    <form action={removeExpenseItem.bind(null, id, i.id)}>
                      <button className="text-xs text-gray-400 hover:text-red-600">Remove</button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          {draft && (
            <div className="mt-8 border-t border-gray-100 pt-4">
              <ExpenseItemForm
                claimId={id}
                categories={(cats ?? []).map((k) => ({ id: k.id, label: `${k.name}${k.per_item_limit ? ` (max ${money(k.per_item_limit)})` : ""}${k.requires_receipt ? "" : " · no receipt"}` }))}
              />
            </div>
          )}
        </Card>
        <Card title="Progress">
          <DescList
            items={[
              ["Status", <Badge key="s" tone={c.status === "paid" || c.status === "approved" ? "green" : c.status === "rejected" ? "red" : "amber"}>{c.status === "submitted" ? `With ${c.stage}` : titleCase(c.status)}</Badge>],
              ["Submitted", fmtDateTime(c.submitted_at)],
              ["Manager decision", fmtDateTime(c.manager_decided_at)],
              ["Finance decision", fmtDateTime(c.finance_decided_at)],
              ["Paid", fmtDateTime(c.paid_at)],
              ["Comment", c.decision_comment ?? "—"],
            ]}
          />
          {draft && (c.total ?? 0) > 0 && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <SubmitClaimButton claimId={id} />
            </div>
          )}
          {c.journal_entry_id && session.canReadPayroll && (
            <Link href={`/finance/journals/${c.journal_entry_id}`} className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
              View journal entry →
            </Link>
          )}
        </Card>
      </div>
    </>
  );
}

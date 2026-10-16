import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/finance";
import { Badge, Card, DescList, Notice, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";
import { PostJournalButton, ReverseJournalForm } from "../../forms";
import { deleteDraftJournal } from "../../actions";
import { requireFinanceReader } from "../../shared";

export const metadata: Metadata = { title: "Journal entry" };

const SOURCE_LINK: Record<string, string> = {
  payroll: "/payroll/runs/",
  payroll_payment: "/payroll/runs/",
  ap_bill: "/finance/payables/bills/",
  ap_payment: "/finance/payables/payments/",
  ar_invoice: "/finance/receivables/invoices/",
  ar_receipt: "/finance/receivables/receipts/",
  reversal: "/finance/journals/",
  expense: "/expenses/",
  expense_payment: "/expenses/",
};

export default async function JournalPage({ params }: PageProps<"/finance/journals/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireFinanceReader();
  const supabase = await createClient();
  const { data: j } = await supabase.from("journal_entries").select("*").eq("id", id).maybeSingle();
  if (!j) notFound();
  const [{ data: lines }, { data: people }] = await Promise.all([
    supabase.from("journal_entry_lines").select("*, chart_of_accounts(code, name), cost_centers(code)").eq("journal_entry_id", id),
    supabase.from("employees").select("user_id, full_name").not("user_id", "is", null),
  ]);
  const who = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  type L = { id: string; debit: number; credit: number; description: string | null; chart_of_accounts: { code: string; name: string } | null; cost_centers: { code: string } | null };
  const ls = (lines ?? []) as unknown as L[];
  const dr = ls.reduce((s, l) => s + Number(l.debit), 0);
  const cr = ls.reduce((s, l) => s + Number(l.credit), 0);
  const isMaker = j.created_by === session.userId;

  return (
    <>
      <PageHeader
        title={`Journal ${j.entry_no}`}
        description={j.description}
        actions={
          <Link href="/finance/journals" className={buttonClass("secondary")}>
            ← Journals
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Lines" className="lg:col-span-2">
          <Table head={["Account", "Cost center", "Narration", "Debit", "Credit"]}>
            {ls.map((l) => (
              <tr key={l.id}>
                <Td>
                  <span className="font-mono text-xs text-gray-500">{l.chart_of_accounts?.code}</span> {l.chart_of_accounts?.name}
                </Td>
                <Td className="text-xs">{l.cost_centers?.code ?? "—"}</Td>
                <Td className="text-xs">{l.description ?? ""}</Td>
                <Td className="tabular-nums">{Number(l.debit) ? money(l.debit) : ""}</Td>
                <Td className="tabular-nums">{Number(l.credit) ? money(l.credit) : ""}</Td>
              </tr>
            ))}
            <tr className={`font-semibold ${dr === cr ? "bg-emerald-50" : "bg-red-50"}`}>
              <Td>{dr === cr ? "Balanced" : "Out of balance"}</Td>
              <Td />
              <Td />
              <Td className="tabular-nums">{money(dr)}</Td>
              <Td className="tabular-nums">{money(cr)}</Td>
            </tr>
          </Table>
        </Card>
        <Card title="Details">
          <DescList
            items={[
              ["Status", <Badge key="s" tone={j.status === "posted" ? "green" : j.status === "draft" ? "amber" : "gray"}>{titleCase(j.status)}</Badge>],
              ["Date", fmtDate(j.entry_date)],
              ["Source", SOURCE_LINK[j.source] && j.source_id ? <Link key="l" href={`${SOURCE_LINK[j.source]}${j.source_id}`} className="text-indigo-700 hover:underline">{titleCase(j.source)} →</Link> : titleCase(j.source)],
              ["Prepared by", j.created_by ? (who.get(j.created_by) ?? "System") : "System"],
              ["Posted", j.posted_at ? `${fmtDateTime(j.posted_at)}${j.posted_by ? ` · ${who.get(j.posted_by) ?? ""}` : ""}` : "—"],
              ["Reversed by", j.reversed_by_entry ? <Link key="r" href={`/finance/journals/${j.reversed_by_entry}`} className="text-indigo-700 hover:underline">View reversal →</Link> : "—"],
            ]}
          />
          {session.isFinance && j.status === "draft" && (
            <div className="mt-6 space-y-3 border-t border-gray-100 pt-4">
              {isMaker ? <Notice>You prepared this journal — another Finance user must post it.</Notice> : <PostJournalButton id={id} />}
              <form action={deleteDraftJournal.bind(null, id)}>
                <button className={buttonClass("danger", "sm")}>Delete draft</button>
              </form>
            </div>
          )}
          {session.isFinance && j.status === "posted" && ["manual", "reversal"].includes(j.source) && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <ReverseJournalForm id={id} defaultDate={today()} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

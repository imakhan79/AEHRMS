import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { financeOptions, today } from "@/lib/finance";
import { Badge, Card, Input, PageHeader, Select, Table, Td, buttonClass } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";
import { JournalForm } from "../forms";
import { requireFinanceReader } from "../shared";

export const metadata: Metadata = { title: "Journals" };

const SOURCES = ["manual", "payroll", "payroll_payment", "loan", "fnf", "ap_bill", "ap_payment", "ar_invoice", "ar_receipt", "reversal"];

export default async function JournalsPage({ searchParams }: PageProps<"/finance/journals">) {
  const session = await requireFinanceReader();
  const sp = await searchParams;
  const source = typeof sp.source === "string" && SOURCES.includes(sp.source) ? sp.source : "";
  const status = typeof sp.status === "string" && ["draft", "posted", "reversed"].includes(sp.status) ? sp.status : "";
  const qText = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const supabase = await createClient();
  let query = supabase
    .from("journal_entries")
    .select("id, entry_no, entry_date, description, source, status, journal_entry_lines(debit)")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (source) query = query.eq("source", source);
  if (status) query = query.eq("status", status);
  if (qText) query = query.or(`description.ilike.%${qText.replace(/[%_,()]/g, " ")}%,entry_no.ilike.%${qText.replace(/[%_,()]/g, " ")}%`);
  const [{ data }, opts] = await Promise.all([query, session.isFinance ? financeOptions() : Promise.resolve(null)]);
  type J = { id: string; entry_no: string; entry_date: string; description: string; source: string; status: string; journal_entry_lines: { debit: number }[] };

  return (
    <>
      <PageHeader title="Journals" description="Every posting in the ledger. Manual journals use maker-checker: one Finance user prepares, another posts." />
      <div className="space-y-6">
        <Card>
          <form className="-mt-1 mb-5 flex flex-wrap gap-2">
            <Input name="q" defaultValue={qText} placeholder="Search no. or description…" className="max-w-xs" />
            <Select name="source" defaultValue={source} className="max-w-44">
              <option value="">All sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
            <Select name="status" defaultValue={status} className="max-w-36">
              <option value="">Any status</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="reversed">Reversed</option>
            </Select>
            <button className={buttonClass("secondary")}>Filter</button>
          </form>
          <div className="pt-5">
            <Table head={["No.", "Date", "Description", "Source", "Amount", "Status"]} empty="No journals.">
              {((data ?? []) as unknown as J[]).map((j) => (
                <tr key={j.id}>
                  <Td>
                    <Link href={`/finance/journals/${j.id}`} className="font-mono text-xs text-indigo-700 hover:underline">
                      {j.entry_no}
                    </Link>
                  </Td>
                  <Td>{fmtDate(j.entry_date)}</Td>
                  <Td className="max-w-md truncate">{j.description}</Td>
                  <Td className="text-xs">{titleCase(j.source)}</Td>
                  <Td className="tabular-nums">{money(j.journal_entry_lines.reduce((s, l) => s + Number(l.debit), 0))}</Td>
                  <Td>
                    <Badge tone={j.status === "posted" ? "green" : j.status === "draft" ? "amber" : "gray"}>{titleCase(j.status)}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
        {opts && (
          <Card title="New manual journal">
            <JournalForm accounts={opts.accounts} costCenters={opts.costCenters} defaultDate={today()} />
          </Card>
        )}
      </div>
    </>
  );
}

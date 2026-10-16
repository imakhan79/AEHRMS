import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { financeOptions, today } from "@/lib/finance";
import { REPORTS, runReport, type ReportKey } from "@/lib/finance-reports";
import { Card, Input, Notice, PageHeader, Select, Table, Td, buttonClass, cn } from "@/components/ui";
import { money } from "@/lib/payroll";
import { requireFinanceReader } from "../shared";

export const metadata: Metadata = { title: "Financial reports" };

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ReportsPage({ searchParams }: PageProps<"/finance/reports">) {
  await requireFinanceReader();
  const sp = await searchParams;
  const key = (REPORTS.find((r) => r.key === sp.r)?.key ?? "pl") as ReportKey;
  const t = today();
  const fyStart = `${Number(t.slice(5, 7)) >= 7 ? t.slice(0, 4) : Number(t.slice(0, 4)) - 1}-07-01`;
  const params = {
    from: isDate(sp.from) ? sp.from : fyStart,
    to: isDate(sp.to) ? sp.to : t,
    costCenter: typeof sp.cc === "string" ? sp.cc : "",
    account: typeof sp.account === "string" ? sp.account : "",
    budget: typeof sp.budget === "string" ? sp.budget : "",
  };
  const supabase = await createClient();
  const [opts, { data: budgets }] = await Promise.all([financeOptions(), supabase.from("budgets").select("id, name, fiscal_year").order("fiscal_year", { ascending: false })]);
  let result;
  let error: string | null = null;
  try {
    result = await runReport(key, params);
  } catch (e) {
    error = (e as Error).message;
  }
  const qs = new URLSearchParams({ r: key, from: params.from, to: params.to, cc: params.costCenter, account: params.account, budget: params.budget }).toString();
  const usesRange = ["pl", "cf", "ledger", "bva"].includes(key);

  return (
    <>
      <PageHeader title="Financial reports" description="All figures come straight from posted ledger entries (FIN-07)." />
      <div className="mb-4 flex flex-wrap gap-2">
        {REPORTS.map((r) => (
          <Link
            key={r.key}
            href={`/finance/reports?r=${r.key}&from=${params.from}&to=${params.to}`}
            className={cn("rounded-lg px-3 py-1.5 text-sm ring-1", r.key === key ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50")}
          >
            {r.label}
          </Link>
        ))}
      </div>
      <Card>
        <form className="-mt-1 mb-5 flex flex-wrap items-end gap-2">
          <input type="hidden" name="r" value={key} />
          {usesRange && <Input type="date" name="from" defaultValue={params.from} className="max-w-40" aria-label="From" />}
          <Input type="date" name="to" defaultValue={params.to} className="max-w-40" aria-label={usesRange ? "To" : "As of"} />
          {key === "pl" && (
            <Select name="cc" defaultValue={params.costCenter} className="max-w-56">
              <option value="">All cost centers</option>
              {opts.costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
          {key === "ledger" && (
            <Select name="account" defaultValue={params.account} className="max-w-72">
              <option value="">Choose account…</option>
              {opts.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          )}
          {key === "bva" && (
            <Select name="budget" defaultValue={params.budget} className="max-w-64">
              <option value="">Choose budget…</option>
              {(budgets ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  FY{b.fiscal_year} — {b.name}
                </option>
              ))}
            </Select>
          )}
          <button className={buttonClass("secondary")}>Run</button>
          <a href={`/finance/reports/export?${qs}`} className={buttonClass("secondary")}>
            Export CSV
          </a>
        </form>
        {error && <Notice tone="red">{error}</Notice>}
        {result && (
          <div className="pt-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">
              {result.title}
              {usesRange && <span className="ml-2 font-normal text-gray-500">{params.from} → {params.to}</span>}
            </h2>
            {result.note && <p className="mb-3 text-xs text-gray-500">{result.note}</p>}
            {result.head.length > 0 && (
              <div className="pt-5">
                <Table head={result.head} empty="No activity in this range.">
                  {result.rows.map((row, i) => (
                    <tr key={i} className={result.totals?.includes(i) ? "bg-gray-50 font-semibold" : ""}>
                      {row.map((cell, j) => (
                        <Td key={j} className={typeof cell === "number" ? cn("tabular-nums", cell < 0 && "text-red-700") : ""}>
                          {typeof cell === "number" ? (result.head[j]?.includes("%") ? `${cell}%` : money(cell)) : (cell ?? "")}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

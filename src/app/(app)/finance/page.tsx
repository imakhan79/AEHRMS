import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { outstanding, today } from "@/lib/finance";
import { Card, PageHeader, Stat } from "@/components/ui";
import { money } from "@/lib/payroll";
import { requireFinanceReader } from "./shared";

export const metadata: Metadata = { title: "Finance" };

export default async function FinanceHome() {
  await requireFinanceReader();
  const supabase = await createClient();
  const t = today();
  const monthStart = `${t.slice(0, 7)}-01`;
  const [tb, pl, bills, invoices, drafts, pendingPays] = await Promise.all([
    supabase.rpc("trial_balance", { p_as_of: t }),
    supabase.rpc("fin_profit_and_loss", { p_from: monthStart, p_to: t }),
    supabase.from("bills").select("total, amount_paid, due_date").eq("status", "posted"),
    supabase.from("invoices").select("total, amount_received, due_date").eq("status", "posted"),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("status", "draft").eq("source", "manual"),
    supabase.from("vendor_payments").select("id", { count: "exact", head: true }).eq("status", "draft"),
  ]);
  const { data: banks } = await supabase.from("bank_accounts").select("gl_account_id");
  const bankIds = new Set((banks ?? []).map((b) => b.gl_account_id));
  const cash = (tb.data ?? []).filter((r: { account_id: string }) => bankIds.has(r.account_id)).reduce((s: number, r: { balance: number }) => s + Number(r.balance), 0);
  const plRows = (pl.data ?? []) as { account_type: string; amount: number }[];
  const revenue = plRows.filter((r) => r.account_type === "revenue").reduce((s, r) => s + Number(r.amount), 0);
  const expense = plRows.filter((r) => r.account_type === "expense").reduce((s, r) => s + Number(r.amount), 0);
  const ap = (bills.data ?? []).reduce((s, b) => s + outstanding(b.total, b.amount_paid), 0);
  const ar = (invoices.data ?? []).reduce((s, i) => s + outstanding(i.total, i.amount_received), 0);
  const apOver = (bills.data ?? []).filter((b) => outstanding(b.total, b.amount_paid) > 0 && b.due_date < t).length;
  const arOver = (invoices.data ?? []).filter((i) => outstanding(i.total, i.amount_received) > 0 && i.due_date < t).length;

  const links = [
    ["/finance/payables", "Accounts payable", "Vendors, bills, payments, withholding tax"],
    ["/finance/receivables", "Accounts receivable", "Customers, invoices, receipts"],
    ["/finance/journals", "Journals", "Manual entries, reversals, every posting"],
    ["/finance/bank", "Bank reconciliation", "Import statements, match, reconcile"],
    ["/finance/reports", "Financial reports", "P&L, balance sheet, cash flow, ledger, aging, budget vs actual"],
    ["/finance/budgets", "Budgets", "Annual budgets by account and cost center"],
    ["/finance/ledger", "Trial balance", "All accounts as of any date"],
    ["/finance/accounts", "Chart of accounts", "Account structure"],
    ["/finance/settings", "Periods & taxes", "Close months, fiscal years, GST and WHT rates"],
  ];

  return (
    <>
      <PageHeader title="Finance" description="Native accounting on the same database as HR — payroll, loans and settlements post here automatically." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Cash at bank" value={`PKR ${money(cash)}`} />
        <Stat label="This month — revenue" value={money(revenue)} />
        <Stat label="This month — expenses" value={money(expense)} hint={`Net ${money(revenue - expense)}`} />
        <Stat label="Payables" value={money(ap)} hint={`${apOver} overdue`} />
        <Stat label="Receivables" value={money(ar)} hint={`${arOver} overdue`} />
      </div>
      {((drafts.count ?? 0) > 0 || (pendingPays.count ?? 0) > 0) && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          {(drafts.count ?? 0) > 0 && (
            <Link href="/finance/journals" className="block">
              <Stat label="Journals awaiting posting" value={drafts.count} hint="Checker review →" />
            </Link>
          )}
          {(pendingPays.count ?? 0) > 0 && (
            <Link href="/finance/payables" className="block">
              <Stat label="Payments awaiting release" value={pendingPays.count} hint="Checker review →" />
            </Link>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map(([href, title, text]) => (
          <Link key={href} href={href} className="block">
            <Card className="h-full transition hover:border-indigo-300">
              <div className="font-semibold text-gray-900">{title}</div>
              <p className="mt-1 text-sm text-gray-600">{text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

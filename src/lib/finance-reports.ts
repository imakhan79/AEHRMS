import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ReportKey = "pl" | "bs" | "cf" | "ledger" | "ap" | "ar" | "bva";

export const REPORTS: { key: ReportKey; label: string }[] = [
  { key: "pl", label: "Profit & Loss" },
  { key: "bs", label: "Balance Sheet" },
  { key: "cf", label: "Cash Flow" },
  { key: "ledger", label: "General Ledger detail" },
  { key: "ap", label: "AP aging" },
  { key: "ar", label: "AR aging" },
  { key: "bva", label: "Budget vs Actual" },
];

export interface ReportParams {
  from: string;
  to: string;
  costCenter?: string;
  account?: string;
  budget?: string;
}

export interface ReportResult {
  title: string;
  head: string[];
  rows: (string | number | null)[][];
  /** Rows to render bold (subtotals). */
  totals?: number[];
  note?: string;
}

const n = (v: unknown) => Number(v ?? 0);

/** Runs a report via the database functions (RLS-scoped) and shapes it for screen + CSV. */
export async function runReport(key: ReportKey, p: ReportParams): Promise<ReportResult> {
  const supabase = await createClient();
  switch (key) {
    case "pl": {
      const { data, error } = await supabase.rpc("fin_profit_and_loss", { p_from: p.from, p_to: p.to, p_cost_center: p.costCenter || null });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { account_type: string; code: string; name: string; amount: number }[];
      const rev = rows.filter((r) => r.account_type === "revenue" && n(r.amount) !== 0);
      const exp = rows.filter((r) => r.account_type === "expense" && n(r.amount) !== 0);
      const tr = rev.reduce((s, r) => s + n(r.amount), 0);
      const te = exp.reduce((s, r) => s + n(r.amount), 0);
      const out: (string | number)[][] = [["", "Revenue", ""], ...rev.map((r) => [r.code, r.name, n(r.amount)])];
      out.push(["", "Total revenue", tr], ["", "Expenses", ""], ...exp.map((r) => [r.code, r.name, n(r.amount)]));
      out.push(["", "Total expenses", te], ["", "Net profit / (loss)", tr - te]);
      const t1 = 1 + rev.length;
      return {
        title: "Profit & Loss",
        head: ["Code", "Account", "Amount (PKR)"],
        rows: out,
        totals: [0, t1, t1 + 1, out.length - 2, out.length - 1],
      };
    }
    case "bs": {
      const { data, error } = await supabase.rpc("fin_balance_sheet", { p_as_of: p.to });
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as { section: string; code: string; name: string; balance: number }[]).filter((r) => n(r.balance) !== 0);
      const out: (string | number)[][] = [];
      const totals: number[] = [];
      const sum: Record<string, number> = {};
      for (const [section, label] of [["asset", "Assets"], ["liability", "Liabilities"], ["equity", "Equity"]] as const) {
        totals.push(out.length);
        out.push(["", label, ""]);
        const rs = rows.filter((r) => r.section === section);
        out.push(...rs.map((r) => [r.code, r.name, n(r.balance)]));
        sum[section] = rs.reduce((s, r) => s + n(r.balance), 0);
        totals.push(out.length);
        out.push(["", `Total ${label.toLowerCase()}`, sum[section]]);
      }
      totals.push(out.length);
      out.push(["", "Liabilities + equity", (sum.liability ?? 0) + (sum.equity ?? 0)]);
      const balanced = Math.abs((sum.asset ?? 0) - (sum.liability ?? 0) - (sum.equity ?? 0)) < 0.01;
      return {
        title: `Balance Sheet as of ${p.to}`,
        head: ["Code", "Account", "Balance (PKR)"],
        rows: out,
        totals,
        note: balanced ? "Balanced: assets = liabilities + equity." : "Not balanced — check for unposted or corrupt entries.",
      };
    }
    case "cf": {
      const { data, error } = await supabase.rpc("fin_cash_flow", { p_from: p.from, p_to: p.to });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { category: string; counter_account: string; inflow: number; outflow: number }[];
      const out: (string | number)[][] = [];
      const totals: number[] = [];
      let grand = 0;
      for (const cat of ["operating", "investing", "financing", "transfers"]) {
        const rs = rows.filter((r) => r.category === cat);
        if (!rs.length) continue;
        totals.push(out.length);
        out.push([`${cat[0].toUpperCase()}${cat.slice(1)} activities`, "", "", ""]);
        out.push(...rs.map((r) => [r.counter_account, n(r.inflow), n(r.outflow), n(r.inflow) - n(r.outflow)]));
        const net = rs.reduce((s, r) => s + n(r.inflow) - n(r.outflow), 0);
        grand += net;
        totals.push(out.length);
        out.push([`Net cash from ${cat}`, "", "", net]);
      }
      totals.push(out.length);
      out.push(["Net change in cash", "", "", grand]);
      return { title: "Cash Flow (direct method)", head: ["Counter-account", "Inflow", "Outflow", "Net"], rows: out, totals };
    }
    case "ledger": {
      if (!p.account) return { title: "General Ledger detail", head: [], rows: [], note: "Choose an account." };
      const { data, error } = await supabase.rpc("fin_account_ledger", { p_account: p.account, p_from: p.from, p_to: p.to });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { entry_date: string; entry_no: string | null; description: string; debit: number | null; credit: number | null; running_balance: number; opening: boolean }[];
      return {
        title: "General Ledger detail",
        head: ["Date", "Journal", "Description", "Debit", "Credit", "Balance"],
        rows: rows.map((r) => [r.entry_date, r.entry_no, r.description, r.debit == null ? null : n(r.debit), r.credit == null ? null : n(r.credit), n(r.running_balance)]),
        totals: [0],
      };
    }
    case "ap":
    case "ar": {
      const { data, error } = await supabase.rpc(key === "ap" ? "fin_ap_aging" : "fin_ar_aging", { p_as_of: p.to });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Record<string, number | string>[];
      const cols = ["current_due", "d1_30", "d31_60", "d61_90", "d90_plus", "total"];
      const sums = cols.map((c) => rows.reduce((s, r) => s + n(r[c]), 0));
      return {
        title: `${key === "ap" ? "Accounts payable" : "Accounts receivable"} aging as of ${p.to}`,
        head: [key === "ap" ? "Vendor" : "Customer", "Not due", "1–30", "31–60", "61–90", "90+", "Total"],
        rows: [...rows.map((r) => [String(r.vendor ?? r.customer), ...cols.map((c) => n(r[c]))]), ["Total", ...sums]],
        totals: [rows.length],
      };
    }
    case "bva": {
      if (!p.budget) return { title: "Budget vs Actual", head: [], rows: [], note: "Choose a budget." };
      const { data, error } = await supabase.rpc("fin_budget_vs_actual", { p_budget: p.budget, p_from: p.from, p_to: p.to });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { code: string; name: string; account_type: string; cost_center: string | null; budget: number; actual: number; variance: number }[];
      return {
        title: "Budget vs Actual",
        head: ["Code", "Account", "Cost center", "Budget", "Actual", "Variance (fav. +)", "Used %"],
        rows: rows.map((r) => [r.code, r.name, r.cost_center ?? "All", n(r.budget), n(r.actual), n(r.variance), n(r.budget) ? Math.round((n(r.actual) / n(r.budget)) * 100) : null]),
        note: "Positive variance is favourable (expense under budget, revenue over budget).",
      };
    }
  }
}

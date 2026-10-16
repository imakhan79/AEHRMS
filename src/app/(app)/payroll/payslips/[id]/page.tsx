import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money, monthLabel, type Payslip } from "@/lib/payroll";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Payslip" };

type Line = { code: string; name: string; kind: "earning" | "deduction"; amount: number; sort_order: number };

/** Printable payslip (PAY-06) — "Print / Save as PDF" from the browser. RLS decides who can open it. */
export default async function PayslipPage({ params }: PageProps<"/payroll/payslips/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireSession();
  const supabase = await createClient();
  const { data } = await supabase.from("payslips").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const p = data as Payslip & { period_month: string };
  // Payroll staff may open draft payslips; employees only ever get released ones (RLS).
  const { data: run } = session.canReadPayroll
    ? await supabase.from("payroll_runs").select("status").eq("id", p.payroll_run_id).maybeSingle()
    : { data: null };
  const isDraft = run ? !["approved", "posted", "paid"].includes(run.status) : false;
  const { data: lines } = await supabase.from("payslip_lines").select("code, name, kind, amount, sort_order").eq("payslip_id", id).order("sort_order");
  const all = (lines ?? []) as Line[];
  const earnings = all.filter((l) => l.kind === "earning");
  const deductions: [string, number][] = [
    ["Income tax", p.income_tax],
    ["EOBI (employee)", p.eobi_employee],
    ["Provident fund", p.pf_employee],
    ["VPS", p.vps_employee],
    ...all.filter((l) => l.kind === "deduction").map((l) => [l.name, l.amount] as [string, number]),
  ].filter(([, v]) => Number(v) > 0) as [string, number][];
  const period = monthLabel(p.period_month);
  const mask = (s: string | null) => (s ? `••••${s.slice(-4)}` : "—");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <PrintButton />
      </div>
      <article className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b border-gray-200 pb-5">
          <div>
            <div className="text-lg font-semibold text-gray-900">AE Global Group of Companies</div>
            <div className="text-sm text-gray-500">Payslip — {period}</div>
            {isDraft && <div className="mt-1 text-xs font-semibold uppercase text-amber-700">Draft — not final</div>}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">AE</div>
        </header>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 py-5 text-sm sm:grid-cols-3">
          {[
            ["Employee", p.employee_name],
            ["Code", p.employee_code],
            ["Department", p.department_name ?? "—"],
            ["Designation", p.position_title ?? "—"],
            ["CNIC", mask(p.cnic)],
            ["Bank / IBAN", p.payment_mode === "bank" ? `${p.bank_name ?? ""} ${mask(p.iban)}` : p.payment_mode],
            ["Days paid", `${p.payable_days} of ${p.days_in_month}`],
            ["Unpaid days", String(p.unpaid_days)],
            ["Overtime", `${p.overtime_hours} h`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-gray-500">{k}</dt>
              <dd className="font-medium text-gray-900">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-6 border-t border-gray-200 pt-5 sm:grid-cols-2">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Earnings</h2>
            <table className="w-full text-sm">
              <tbody>
                {earnings.map((l) => (
                  <tr key={l.code + l.name}>
                    <td className="py-1 text-gray-700">{l.name}</td>
                    <td className="py-1 text-right tabular-nums">{money(l.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 font-semibold">
                  <td className="py-1.5">Gross pay</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.gross_pay)}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Deductions</h2>
            <table className="w-full text-sm">
              <tbody>
                {deductions.map(([name, amt]) => (
                  <tr key={name}>
                    <td className="py-1 text-gray-700">{name}</td>
                    <td className="py-1 text-right tabular-nums">{money(amt)}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 font-semibold">
                  <td className="py-1.5">Total deductions</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.total_deductions)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        <div className="mt-6 flex items-center justify-between rounded-lg bg-indigo-50 px-5 py-4">
          <span className="text-sm font-semibold text-indigo-900">Net pay</span>
          <span className="text-2xl font-semibold tabular-nums text-indigo-900">PKR {money(p.net_pay)}</span>
        </div>

        <footer className="mt-6 grid gap-4 border-t border-gray-200 pt-4 text-xs text-gray-500 sm:grid-cols-2">
          <div>
            Employer contributions (not deducted from you): EOBI {money(p.eobi_employer)}
            {Number(p.pessi_employer) > 0 && ` · PESSI ${money(p.pessi_employer)}`}
            {Number(p.pf_employer) > 0 && ` · PF ${money(p.pf_employer)}`}
            {Number(p.vps_employer) > 0 && ` · VPS ${money(p.vps_employer)}`}
          </div>
          <div className="sm:text-right">
            Tax basis: projected annual taxable income PKR {money(p.projected_annual_taxable)} → annual tax PKR {money(p.projected_annual_tax)}
          </div>
        </footer>
        <p className="mt-4 text-center text-[11px] text-gray-400">This is a computer-generated payslip and does not require a signature.</p>
      </article>
    </div>
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Payroll register, bank transfer file and statutory statements (PAY-08, 9.3, 16.5).
// RLS restricts payslips to payroll readers.

function csv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // CSV formula injection
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

type Slip = Record<string, string | number | null>;

const KINDS: Record<string, { title: string; rows: (s: Slip[], period: string) => (string | number | null)[][] }> = {
  register: {
    title: "payroll-register",
    rows: (s) => [
      ["Code", "Name", "Department", "Position", "Payable days", "Basic", "Overtime", "Gross", "Taxable", "Income tax", "EOBI (EE)", "PF (EE)", "VPS (EE)", "Loans", "Other", "Total deductions", "Net pay", "EOBI (ER)", "PESSI (ER)", "PF (ER)", "VPS (ER)"],
      ...s.map((p) => [p.employee_code, p.employee_name, p.department_name, p.position_title, p.payable_days, p.basic_salary, p.overtime_amount, p.gross_pay, p.taxable_income, p.income_tax, p.eobi_employee, p.pf_employee, p.vps_employee, p.loan_deduction, p.other_deductions, p.total_deductions, p.net_pay, p.eobi_employer, p.pessi_employer, p.pf_employer, p.vps_employer]),
    ],
  },
  bank: {
    // Generic IBFT layout; bank-specific formats need each bank's spec (BRD 6.18 Q2).
    title: "bank-transfer",
    rows: (s, period) => [
      ["Beneficiary name", "IBAN", "Bank", "Amount (PKR)", "Reference", "Employee code"],
      ...s
        .filter((p) => p.payment_mode === "bank")
        .map((p) => [p.account_title ?? p.employee_name, p.iban, p.bank_name, Math.round(Number(p.net_pay)), `SALARY ${period}`, p.employee_code]),
    ],
  },
  tax: {
    title: "income-tax-statement",
    rows: (s) => [
      ["Code", "Name", "CNIC", "Taxable income (month)", "Tax deducted (month)", "Projected annual taxable", "Projected annual tax"],
      ...s.map((p) => [p.employee_code, p.employee_name, p.cnic, p.taxable_income, p.income_tax, p.projected_annual_taxable, p.projected_annual_tax]),
    ],
  },
  eobi: {
    title: "eobi-contributions",
    rows: (s) => [
      ["Code", "Name", "CNIC", "Employee share", "Employer share", "Total"],
      ...s.filter((p) => Number(p.eobi_employer) > 0).map((p) => [p.employee_code, p.employee_name, p.cnic, p.eobi_employee, p.eobi_employer, Number(p.eobi_employee) + Number(p.eobi_employer)]),
    ],
  },
  pessi: {
    title: "pessi-contributions",
    rows: (s) => [
      ["Code", "Name", "CNIC", "Employer contribution"],
      ...s.filter((p) => Number(p.pessi_employer) > 0).map((p) => [p.employee_code, p.employee_name, p.cnic, p.pessi_employer]),
    ],
  },
  pf: {
    title: "provident-fund",
    rows: (s) => [
      ["Code", "Name", "Basic", "Employee share", "Employer share", "Total"],
      ...s.filter((p) => Number(p.pf_employer) > 0).map((p) => [p.employee_code, p.employee_name, p.basic_salary, p.pf_employee, p.pf_employer, Number(p.pf_employee) + Number(p.pf_employer)]),
    ],
  },
  vps: {
    title: "vps-contributions",
    rows: (s) => [
      ["Code", "Name", "CNIC", "Employee contribution", "Employer contribution", "Total"],
      ...s.filter((p) => Number(p.vps_employee) + Number(p.vps_employer) > 0).map((p) => [p.employee_code, p.employee_name, p.cnic, p.vps_employee, p.vps_employer, Number(p.vps_employee) + Number(p.vps_employer)]),
    ],
  },
};

export async function GET(request: NextRequest, { params }: RouteContext<"/payroll/runs/[id]/export">) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (!session.canReadPayroll) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const kind = KINDS[request.nextUrl.searchParams.get("kind") ?? ""];
  if (!kind) return new NextResponse("Unknown export", { status: 400 });

  const supabase = await createClient();
  const { data: run } = await supabase.from("payroll_runs").select("period_month").eq("id", id).maybeSingle();
  if (!run) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await supabase.from("payslips").select("*").eq("payroll_run_id", id).order("employee_code");
  if (error) return new NextResponse(error.message, { status: 400 });

  const period = String(run.period_month).slice(0, 7);
  return new NextResponse(csv(kind.rows((data ?? []) as Slip[], period)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind.title}-${period}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}

export type PayrollStatus = "draft" | "review" | "approved" | "posted" | "paid";

export const PAYROLL_STEPS: { status: PayrollStatus; label: string }[] = [
  { status: "draft", label: "Draft" },
  { status: "review", label: "Review" },
  { status: "approved", label: "Approved" },
  { status: "posted", label: "Posted to GL" },
  { status: "paid", label: "Paid" },
];

export interface PayrollRun {
  id: string;
  period_month: string;
  tax_year: number;
  is_parallel: boolean;
  status: PayrollStatus;
  employee_count: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_tax: number;
  total_employer: number;
  processed_at: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  posted_at: string | null;
  paid_at: string | null;
  journal_entry_id: string | null;
  payment_entry_id: string | null;
  notes: string | null;
}

export interface Payslip {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  position_title: string | null;
  cnic: string | null;
  bank_name: string | null;
  account_title: string | null;
  iban: string | null;
  payment_mode: string;
  days_in_month: number;
  employed_days: number;
  unpaid_days: number;
  payable_days: number;
  overtime_hours: number;
  basic_salary: number;
  gross_pay: number;
  overtime_amount: number;
  taxable_income: number;
  income_tax: number;
  projected_annual_taxable: number;
  projected_annual_tax: number;
  eobi_employee: number;
  eobi_employer: number;
  pessi_employer: number;
  pf_employee: number;
  pf_employer: number;
  vps_employee: number;
  vps_employer: number;
  loan_deduction: number;
  other_deductions: number;
  total_deductions: number;
  net_pay: number;
  warnings: string[];
}

const pkr = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

/** 165000 → "165,000" (PKR, whole rupees). */
export function money(v: number | string | null | undefined): string {
  return v == null ? "—" : pkr.format(Math.round(Number(v)));
}

export function monthLabel(periodMonth: string): string {
  return new Intl.DateTimeFormat("en-PK", { month: "long", year: "numeric" }).format(new Date(`${periodMonth}T00:00:00`));
}

export function taxYearLabel(ty: number): string {
  return `TY${ty} (Jul ${ty - 1} – Jun ${ty})`;
}

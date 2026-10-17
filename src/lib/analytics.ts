import "server-only";
import { createClient } from "@/lib/supabase/server";
import { hasAnyRole, type Session } from "@/lib/auth";
import { pkToday } from "@/lib/attendance";
import { outstanding } from "@/lib/finance";
import { money, monthLabel } from "@/lib/payroll";
import type { AppRole } from "@/lib/types";

/**
 * Role-based analytics (BRD 6.16, 9.1). Every query runs through RLS, so a manager or HOD
 * automatically gets their team's numbers and HR / Executive get the whole company.
 */

export type ViewKey = "workforce" | "attendance" | "leave" | "payroll" | "finance" | "recruitment";

export type Cell = string | number | null | { text: string; href: string };
export interface Block {
  key: string;
  title: string;
  description?: string;
  head: string[];
  rows: Cell[][];
  /** Index of the last row when it is a total line. */
  totalRow?: boolean;
}
export interface Kpi {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}
export interface Trend {
  title: string;
  unit: string;
  points: { label: string; value: number; display: string; href?: string }[];
}
export interface ViewData {
  scope: string;
  kpis: Kpi[];
  trend?: Trend;
  blocks: Block[];
}

const HR_LIKE = ["hr_admin", "system_admin", "executive", "auditor"] as const;

export const VIEWS: { key: ViewKey; label: string; audience: string; can: (s: Session) => boolean }[] = [
  { key: "workforce", label: "Workforce", audience: "HR, Executive, HOD", can: (s) => hasAnyRole(s, [...HR_LIKE, "hod"]) || s.hasReports },
  { key: "attendance", label: "Attendance", audience: "HR, Executive, HOD", can: (s) => hasAnyRole(s, [...HR_LIKE, "hod", "finance"]) || s.hasReports },
  { key: "leave", label: "Leave", audience: "HR, Executive, HOD", can: (s) => hasAnyRole(s, [...HR_LIKE, "hod", "finance"]) || s.hasReports },
  { key: "payroll", label: "Payroll cost", audience: "Finance, HR, Executive", can: (s) => s.canReadPayroll },
  { key: "finance", label: "Finance", audience: "Finance, Executive", can: (s) => hasAnyRole(s, ["finance", "system_admin", "executive", "auditor"]) },
  { key: "recruitment", label: "Recruitment", audience: "HR, Recruiters, Executive", can: (s) => hasAnyRole(s, ["hr_admin", "system_admin", "executive", "recruiter", "auditor"]) },
];

/** Who may receive each company-wide scheduled digest. Mirrors private.report_allowed() in the database. */
const DIGEST_ROLES: Record<ViewKey, AppRole[]> = {
  workforce: ["hr_admin", "system_admin", "executive", "auditor"],
  attendance: ["hr_admin", "system_admin", "executive", "auditor"],
  leave: ["hr_admin", "system_admin", "executive", "auditor"],
  recruitment: ["hr_admin", "system_admin", "executive", "recruiter"],
  payroll: ["hr_admin", "system_admin", "executive", "auditor", "finance"],
  finance: ["system_admin", "executive", "auditor", "finance"],
};
export const canReceiveDigest = (s: Session, view: ViewKey) => hasAnyRole(s, DIGEST_ROLES[view]);

/** Default landing view per role (ANL-01). */
export function defaultView(s: Session): ViewKey | null {
  if (hasAnyRole(s, ["finance"]) && !hasAnyRole(s, ["hr_admin", "system_admin"])) return "finance";
  if (hasAnyRole(s, ["recruiter"]) && !hasAnyRole(s, [...HR_LIKE, "hod"])) return "recruitment";
  return VIEWS.find((v) => v.can(s))?.key ?? null;
}

const n = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");
const iso = (d: Date) => d.toISOString().slice(0, 10);
function addMonths(isoDate: string, k: number) {
  const d = new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + k);
  return iso(d);
}
function monthEnd(firstOfMonth: string) {
  const d = new Date(`${addMonths(firstOfMonth, 1)}T00:00:00Z`);
  d.setUTCDate(0);
  return iso(d);
}
const shortMonth = (m: string) => new Intl.DateTimeFormat("en-PK", { month: "short", timeZone: "UTC" }).format(new Date(`${m}T00:00:00Z`));

/** PostgREST returns at most 1,000 rows per request; page through larger sets. */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Emp = {
  id: string;
  status: string;
  employment_type: string;
  joining_date: string | null;
  exit_date: string | null;
  department_id: string | null;
  location_id: string | null;
  department: { name: string } | null;
  locations: { name: string } | null;
};

async function employees() {
  const supabase = await createClient();
  return all<Emp>((a, b) =>
    supabase
      .from("employees")
      .select("id, status, employment_type, joining_date, exit_date, department_id, location_id, department:departments!employees_department_id_fkey(name), locations(name)")
      .is("deleted_at", null)
      .order("id")
      .range(a, b) as unknown as PromiseLike<{ data: Emp[] | null; error: { message: string } | null }>,
  );
}

const isActive = (e: Emp) => e.status !== "exited" && e.status !== "draft";
function scopeLabel(s: Session) {
  if (hasAnyRole(s, ["hr_admin", "system_admin", "executive", "auditor", "finance"])) return "Whole company";
  if (s.roles.has("hod")) return "Your department(s)";
  return "Your team";
}

// ---------------------------------------------------------------- Workforce
async function workforce(s: Session): Promise<ViewData> {
  const emps = await employees();
  const t = pkToday();
  const yearAgo = addMonths(t, -12).slice(0, 8) + t.slice(8);
  const active = emps.filter(isActive);
  const joined = emps.filter((e) => e.status !== "draft" && e.joining_date && e.joining_date > yearAgo && e.joining_date <= t);
  const left = emps.filter((e) => e.status === "exited" && e.exit_date && e.exit_date > yearAgo && e.exit_date <= t);
  const headAt = (d: string) =>
    emps.filter((e) => e.status !== "draft" && e.joining_date && e.joining_date <= d && (e.status !== "exited" || (e.exit_date && e.exit_date > d))).length;
  const avgHead = (headAt(yearAgo) + active.length) / 2;

  const m0 = `${t.slice(0, 7)}-01`;
  const points = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(m0, i - 11);
    const end = i === 11 ? t : monthEnd(m);
    const v = headAt(end);
    return { label: shortMonth(m), value: v, display: `${v} employees at ${i === 11 ? "today" : `end of ${monthLabel(m)}`}` };
  });

  const group = (key: (e: Emp) => [string, string | null]) => {
    const g = new Map<string, { id: string | null; active: number; probation: number; notice: number; joined: number; left: number }>();
    const bump = (e: Emp, f: "active" | "probation" | "notice" | "joined" | "left") => {
      const [name, id] = key(e);
      const row = g.get(name) ?? { id, active: 0, probation: 0, notice: 0, joined: 0, left: 0 };
      row[f]++;
      g.set(name, row);
    };
    active.forEach((e) => {
      bump(e, "active");
      if (e.status === "probation") bump(e, "probation");
      if (e.status === "notice") bump(e, "notice");
    });
    joined.forEach((e) => bump(e, "joined"));
    left.forEach((e) => bump(e, "left"));
    return [...g.entries()].sort((a, b) => b[1].active - a[1].active);
  };

  const byDept = group((e) => [e.department?.name ?? "Unassigned", e.department_id]);
  const byLoc = group((e) => [e.locations?.name ?? "Unassigned", e.location_id]);
  const byType = group((e) => [e.employment_type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), e.employment_type]);
  const years = (e: Emp) => (e.joining_date ? (Date.parse(t) - Date.parse(e.joining_date)) / (365.25 * 86400000) : 0);
  const bands: [string, (y: number) => boolean][] = [
    ["Under 1 year", (y) => y < 1],
    ["1–3 years", (y) => y >= 1 && y < 3],
    ["3–5 years", (y) => y >= 3 && y < 5],
    ["5–10 years", (y) => y >= 5 && y < 10],
    ["10+ years", (y) => y >= 10],
  ];
  const rowsFor = (g: ReturnType<typeof group>, link?: (id: string | null) => string | null): Cell[][] => [
    ...g.map(([name, r]) => {
      const href = link?.(r.id);
      return [href ? { text: name, href } : name, r.active, r.probation, r.notice, r.joined, r.left, pct(r.left, r.active + r.left / 2)];
    }),
    ["Total", active.length, active.filter((e) => e.status === "probation").length, active.filter((e) => e.status === "notice").length, joined.length, left.length, pct(left.length, avgHead)],
  ];
  const head = ["", "Active", "Probation", "Notice", "Joined (12 mo)", "Left (12 mo)", "Attrition"];

  return {
    scope: scopeLabel(s),
    kpis: [
      { label: "Active headcount", value: active.length, hint: `${byDept.length} departments`, href: "/employees" },
      { label: "Joined, last 12 months", value: joined.length, hint: `${active.filter((e) => e.status === "probation").length} still on probation`, href: "/employees?status=probation" },
      { label: "Left, last 12 months", value: left.length, hint: `${active.filter((e) => e.status === "notice").length} serving notice`, href: "/exit" },
      { label: "Attrition, 12 months", value: pct(left.length, avgHead), hint: "Leavers ÷ average headcount" },
    ],
    trend: { title: "Headcount, month end", unit: "employees", points },
    blocks: [
      { key: "departments", title: "By department", head: ["Department", ...head.slice(1)], rows: rowsFor(byDept, (id) => (id ? `/employees?dept=${id}` : null)), totalRow: true },
      { key: "locations", title: "By location", head: ["Location", ...head.slice(1)], rows: rowsFor(byLoc, (id) => (id ? `/employees?loc=${id}` : null)), totalRow: true },
      { key: "employment-types", title: "By employment type", head: ["Type", ...head.slice(1)], rows: rowsFor(byType), totalRow: true },
      {
        key: "tenure",
        title: "Tenure of active staff",
        head: ["Tenure", "Employees", "Share"],
        rows: bands.map(([label, f]) => {
          const k = active.filter((e) => f(years(e))).length;
          return [label, k, pct(k, active.length)];
        }),
      },
    ],
  };
}

// ---------------------------------------------------------------- Attendance
async function attendance(s: Session): Promise<ViewData> {
  const supabase = await createClient();
  const t = pkToday();
  const m0 = `${t.slice(0, 7)}-01`;
  type Att = { employee_id: string; work_date: string; status: string; late_minutes: number | null; overtime_minutes: number | null };
  const [emps, rows, punches] = await Promise.all([
    employees(),
    all<Att>((a, b) =>
      supabase.from("attendance").select("employee_id, work_date, status, late_minutes, overtime_minutes").gte("work_date", m0).lte("work_date", t).order("id").range(a, b),
    ),
    supabase.from("attendance_punches").select("employee_id").eq("work_date", t).eq("punch_type", "in").neq("verification", "rejected"),
  ]);
  const dept = new Map(emps.map((e) => [e.id, e.department?.name ?? "Unassigned"]));
  const deptId = new Map(emps.map((e) => [e.department?.name ?? "Unassigned", e.department_id]));
  const active = emps.filter(isActive).length;
  const checkedIn = new Set((punches.data ?? []).map((p) => p.employee_id)).size;
  const WORK = new Set(["present", "late", "half_day", "absent", "missing_punch"]);
  const ATTENDED = new Set(["present", "late", "half_day"]);
  const work = rows.filter((r) => WORK.has(r.status));
  const attended = work.filter((r) => ATTENDED.has(r.status)).length;
  const late = rows.filter((r) => r.status === "late").length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const otHours = rows.reduce((sum, r) => sum + n(r.overtime_minutes), 0) / 60;

  const days = [...new Set(rows.map((r) => r.work_date))].sort();
  const points = days.map((d) => {
    const w = rows.filter((r) => r.work_date === d && WORK.has(r.status));
    const a = w.filter((r) => ATTENDED.has(r.status)).length;
    const v = w.length ? Math.round((a / w.length) * 100) : 0;
    return { label: String(Number(d.slice(8))), value: v, display: `${v}% attended on ${d} (${a} of ${w.length})` };
  });

  const g = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const k = dept.get(r.employee_id) ?? "Unassigned";
    const x = g.get(k) ?? {};
    x[r.status] = (x[r.status] ?? 0) + 1;
    x.ot = (x.ot ?? 0) + n(r.overtime_minutes);
    x.lateMin = (x.lateMin ?? 0) + n(r.late_minutes);
    g.set(k, x);
  }
  const deptRows: Cell[][] = [...g.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, x]) => {
      const w = [...WORK].reduce((sum, k) => sum + (x[k] ?? 0), 0);
      const att = [...ATTENDED].reduce((sum, k) => sum + (x[k] ?? 0), 0);
      const id = deptId.get(name);
      return [
        id ? { text: name, href: `/employees?dept=${id}` } : name,
        w,
        pct(att, w),
        x.late ?? 0,
        x.absent ?? 0,
        x.missing_punch ?? 0,
        x.leave ?? 0,
        Math.round((x.ot ?? 0) / 6) / 10,
      ];
    });
  const statusRows: Cell[][] = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {}),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), v, pct(v, rows.length)]);

  return {
    scope: `${scopeLabel(s)} · ${monthLabel(m0)} to date`,
    kpis: [
      { label: "Checked in today", value: checkedIn, hint: `of ${active} active`, href: "/attendance/reports" },
      { label: "Attendance rate", value: pct(attended, work.length), hint: "Working days attended, month to date" },
      { label: "Late arrivals", value: late, hint: `${pct(late, work.length)} of working days`, href: "/attendance/reports" },
      { label: "Absences", value: absent, hint: `${Math.round(otHours)} overtime hours this month` },
    ],
    trend: points.length ? { title: "Daily attendance rate", unit: "%", points } : undefined,
    blocks: [
      { key: "departments", title: "By department", description: "Month to date", head: ["Department", "Working days", "Attended", "Late", "Absent", "Missing punch", "On leave", "Overtime (h)"], rows: deptRows },
      { key: "status", title: "Day status mix", head: ["Status", "Days", "Share"], rows: statusRows },
    ],
  };
}

// ---------------------------------------------------------------- Leave
async function leave(s: Session): Promise<ViewData> {
  const supabase = await createClient();
  const t = pkToday();
  const y = t.slice(0, 4);
  type Req = { employee_id: string; start_date: string; end_date: string; days: number; status: string; leave_types: { name: string } | null };
  const [emps, reqs] = await Promise.all([
    employees(),
    all<Req>((a, b) =>
      supabase
        .from("leave_requests")
        .select("employee_id, start_date, end_date, days, status, leave_types(name)")
        .gte("start_date", `${y}-01-01`)
        .lte("start_date", `${y}-12-31`)
        .order("id")
        .range(a, b) as unknown as PromiseLike<{ data: Req[] | null; error: { message: string } | null }>,
    ),
  ]);
  const active = emps.filter(isActive).length;
  const dept = new Map(emps.map((e) => [e.id, e.department?.name ?? "Unassigned"]));
  const approved = reqs.filter((r) => r.status === "approved");
  const onLeave = new Set(approved.filter((r) => r.start_date <= t && r.end_date >= t).map((r) => r.employee_id)).size;
  const pending = reqs.filter((r) => r.status === "pending");
  const approvedDays = approved.reduce((sum, r) => sum + n(r.days), 0);

  const points = Array.from({ length: 12 }, (_, i) => {
    const m = `${y}-${String(i + 1).padStart(2, "0")}`;
    const v = approved.filter((r) => r.start_date.startsWith(m)).reduce((sum, r) => sum + n(r.days), 0);
    return { label: shortMonth(`${m}-01`), value: v, display: `${v} approved days starting in ${monthLabel(`${m}-01`)}` };
  });

  const byType = new Map<string, { approved: number; pending: number; rejected: number; requests: number }>();
  for (const r of reqs) {
    const k = r.leave_types?.name ?? "Other";
    const x = byType.get(k) ?? { approved: 0, pending: 0, rejected: 0, requests: 0 };
    x.requests++;
    if (r.status === "approved") x.approved += n(r.days);
    if (r.status === "pending") x.pending += n(r.days);
    if (r.status === "rejected") x.rejected++;
    byType.set(k, x);
  }
  const byDept = new Map<string, { days: number; people: Set<string> }>();
  for (const r of approved) {
    const k = dept.get(r.employee_id) ?? "Unassigned";
    const x = byDept.get(k) ?? { days: 0, people: new Set<string>() };
    x.days += n(r.days);
    x.people.add(r.employee_id);
    byDept.set(k, x);
  }
  const headByDept = emps.filter(isActive).reduce<Record<string, number>>((acc, e) => {
    const k = e.department?.name ?? "Unassigned";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return {
    scope: `${scopeLabel(s)} · ${y}`,
    kpis: [
      { label: "On leave today", value: onLeave, hint: `of ${active} active` },
      { label: "Pending requests", value: pending.length, hint: `${pending.reduce((sum, r) => sum + n(r.days), 0)} days awaiting a decision`, href: "/leave#approvals" },
      { label: "Days approved this year", value: approvedDays, hint: `${approved.length} requests` },
      { label: "Average per employee", value: active ? Math.round((approvedDays / active) * 10) / 10 : 0, hint: "Approved days this year" },
    ],
    trend: { title: "Approved leave days by month", unit: "days", points },
    blocks: [
      {
        key: "types",
        title: "By leave type",
        head: ["Leave type", "Requests", "Approved days", "Pending days", "Rejected"],
        rows: [...byType.entries()].sort((a, b) => b[1].approved - a[1].approved).map(([k, x]) => [k, x.requests, x.approved, x.pending, x.rejected]),
      },
      {
        key: "departments",
        title: "By department",
        head: ["Department", "Approved days", "Employees who took leave", "Days per head"],
        rows: [...byDept.entries()]
          .sort((a, b) => b[1].days - a[1].days)
          .map(([k, x]) => [k, x.days, x.people.size, headByDept[k] ? Math.round((x.days / headByDept[k]) * 10) / 10 : null]),
      },
    ],
  };
}

// ---------------------------------------------------------------- Payroll
async function payroll(): Promise<ViewData> {
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("payroll_runs")
    .select("id, period_month, status")
    .in("status", ["approved", "posted", "paid"])
    .order("period_month", { ascending: false })
    .limit(12);
  const runIds = (runs ?? []).map((r) => r.id);
  type Slip = {
    payroll_run_id: string;
    department_name: string | null;
    gross_pay: number;
    total_deductions: number;
    net_pay: number;
    income_tax: number;
    eobi_employer: number;
    pessi_employer: number;
    pf_employer: number;
    vps_employer: number;
  };
  const slips = runIds.length
    ? await all<Slip>((a, b) =>
        supabase
          .from("payslips")
          .select("payroll_run_id, department_name, gross_pay, total_deductions, net_pay, income_tax, eobi_employer, pessi_employer, pf_employer, vps_employer")
          .in("payroll_run_id", runIds)
          .order("id")
          .range(a, b),
      )
    : [];
  const employer = (p: Slip) => n(p.eobi_employer) + n(p.pessi_employer) + n(p.pf_employer) + n(p.vps_employer);
  const sum = (ps: Slip[], f: (p: Slip) => number) => ps.reduce((acc, p) => acc + f(p), 0);
  const per = (runs ?? []).map((r) => {
    const ps = slips.filter((p) => p.payroll_run_id === r.id);
    return {
      ...r,
      staff: ps.length,
      gross: sum(ps, (p) => n(p.gross_pay)),
      deductions: sum(ps, (p) => n(p.total_deductions)),
      tax: sum(ps, (p) => n(p.income_tax)),
      net: sum(ps, (p) => n(p.net_pay)),
      employer: sum(ps, employer),
      slips: ps,
    };
  });
  const [latest, prev] = per;
  const change = latest && prev && prev.gross ? `${latest.gross >= prev.gross ? "+" : ""}${Math.round(((latest.gross - prev.gross) / prev.gross) * 1000) / 10}% vs ${monthLabel(prev.period_month)}` : undefined;
  const depts = new Map<string, { staff: number; gross: number; net: number; employer: number }>();
  for (const p of latest?.slips ?? []) {
    const k = p.department_name ?? "Unassigned";
    const x = depts.get(k) ?? { staff: 0, gross: 0, net: 0, employer: 0 };
    x.staff++;
    x.gross += n(p.gross_pay);
    x.net += n(p.net_pay);
    x.employer += employer(p);
    depts.set(k, x);
  }

  return {
    scope: latest ? `Approved payroll · latest ${monthLabel(latest.period_month)}` : "No approved payroll yet",
    kpis: latest
      ? [
          { label: "Staff paid", value: latest.staff, hint: monthLabel(latest.period_month), href: `/payroll/runs/${latest.id}` },
          { label: "Gross pay", value: `PKR ${money(latest.gross)}`, hint: change },
          { label: "Net pay", value: `PKR ${money(latest.net)}`, hint: `Income tax withheld ${money(latest.tax)}` },
          { label: "Total employer cost", value: `PKR ${money(latest.gross + latest.employer)}`, hint: `Incl. ${money(latest.employer)} EOBI, PESSI, PF & VPS` },
        ]
      : [],
    trend: per.length
      ? {
          title: "Gross pay by month",
          unit: "PKR",
          points: [...per].reverse().map((r) => ({ label: shortMonth(r.period_month), value: r.gross, display: `PKR ${money(r.gross)} gross, ${r.staff} staff, ${monthLabel(r.period_month)}`, href: `/payroll/runs/${r.id}` })),
        }
      : undefined,
    blocks: [
      {
        key: "runs",
        title: "Payroll runs",
        head: ["Month", "Status", "Staff", "Gross", "Deductions", "Income tax", "Net", "Employer contributions"],
        rows: per.map((r) => [{ text: monthLabel(r.period_month), href: `/payroll/runs/${r.id}` }, r.status, r.staff, r.gross, r.deductions, r.tax, r.net, r.employer]),
      },
      {
        key: "departments",
        title: latest ? `Cost by department, ${monthLabel(latest.period_month)}` : "Cost by department",
        head: ["Department", "Staff", "Gross", "Net", "Employer contributions", "Average gross"],
        rows: [...depts.entries()].sort((a, b) => b[1].gross - a[1].gross).map(([k, x]) => [k, x.staff, x.gross, x.net, x.employer, Math.round(x.gross / x.staff)]),
      },
    ],
  };
}

// ---------------------------------------------------------------- Finance
async function finance(): Promise<ViewData> {
  const supabase = await createClient();
  const t = pkToday();
  const m0 = `${t.slice(0, 7)}-01`;
  const months = Array.from({ length: 6 }, (_, i) => addMonths(m0, i - 5));
  const [tb, banks, bills, invoices, ...pls] = await Promise.all([
    supabase.rpc("trial_balance", { p_as_of: t }),
    supabase.from("bank_accounts").select("id, name, bank_name, gl_account_id").eq("is_active", true).order("name"),
    supabase.from("bills").select("total, amount_paid, due_date").eq("status", "posted"),
    supabase.from("invoices").select("total, amount_received, due_date").eq("status", "posted"),
    ...months.map((m) => supabase.rpc("fin_profit_and_loss", { p_from: m, p_to: m === m0 ? t : monthEnd(m), p_cost_center: null })),
  ]);
  const balance = new Map(((tb.data ?? []) as { account_id: string; balance: number }[]).map((r) => [r.account_id, n(r.balance)]));
  const cashRows = (banks.data ?? []).map((b) => [{ text: b.name, href: "/finance/bank" }, b.bank_name, balance.get(b.gl_account_id) ?? 0] as Cell[]);
  const cash = (banks.data ?? []).reduce((acc, b) => acc + (balance.get(b.gl_account_id) ?? 0), 0);

  const aging = (docs: { total: number; paid: number; due_date: string }[]) => {
    const b = [0, 0, 0, 0, 0];
    for (const d of docs) {
      const due = outstanding(d.total, d.paid);
      if (due <= 0) continue;
      const late = Math.floor((Date.parse(t) - Date.parse(d.due_date)) / 86400000);
      b[late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4] += due;
    }
    return b;
  };
  const ap = aging((bills.data ?? []).map((x) => ({ total: x.total, paid: x.amount_paid, due_date: x.due_date })));
  const ar = aging((invoices.data ?? []).map((x) => ({ total: x.total, paid: x.amount_received, due_date: x.due_date })));
  const tot = (b: number[]) => b.reduce((a, c) => a + c, 0);

  const pl = months.map((m, i) => {
    const rows = (pls[i].data ?? []) as { account_type: string; amount: number }[];
    const revenue = rows.filter((r) => r.account_type === "revenue").reduce((a, r) => a + n(r.amount), 0);
    const expense = rows.filter((r) => r.account_type === "expense").reduce((a, r) => a + n(r.amount), 0);
    return { m, revenue, expense, net: revenue - expense };
  });
  const net6 = pl.reduce((a, r) => a + r.net, 0);

  return {
    scope: `Posted entries as of ${t}`,
    kpis: [
      { label: "Cash at bank", value: `PKR ${money(cash)}`, hint: `${(banks.data ?? []).length} bank accounts`, href: "/finance/bank" },
      { label: "Payables outstanding", value: `PKR ${money(tot(ap))}`, hint: `${money(tot(ap) - ap[0])} overdue`, href: "/finance/reports?r=ap" },
      { label: "Receivables outstanding", value: `PKR ${money(tot(ar))}`, hint: `${money(tot(ar) - ar[0])} overdue`, href: "/finance/reports?r=ar" },
      { label: "Net income, 6 months", value: `PKR ${money(net6)}`, hint: `${monthLabel(months[0])} – today`, href: `/finance/reports?r=pl&from=${months[0]}&to=${t}` },
    ],
    trend: {
      title: "Expenses by month",
      unit: "PKR",
      points: pl.map((r) => ({ label: shortMonth(r.m), value: r.expense, display: `PKR ${money(r.expense)} expenses in ${monthLabel(r.m)}`, href: `/finance/reports?r=pl&from=${r.m}&to=${r.m === m0 ? t : monthEnd(r.m)}` })),
    },
    blocks: [
      {
        key: "pl",
        title: "Profit & loss by month",
        head: ["Month", "Revenue", "Expenses", "Net"],
        rows: [
          ...pl.map((r) => [{ text: monthLabel(r.m), href: `/finance/reports?r=pl&from=${r.m}&to=${r.m === m0 ? t : monthEnd(r.m)}` }, r.revenue, r.expense, r.net] as Cell[]),
          ["Total", pl.reduce((a, r) => a + r.revenue, 0), pl.reduce((a, r) => a + r.expense, 0), net6],
        ],
        totalRow: true,
      },
      {
        key: "aging",
        title: "Aging",
        head: ["", "Not due", "1–30", "31–60", "61–90", "90+", "Total"],
        rows: [
          [{ text: "Payables", href: "/finance/reports?r=ap" }, ...ap, tot(ap)],
          [{ text: "Receivables", href: "/finance/reports?r=ar" }, ...ar, tot(ar)],
        ],
      },
      { key: "cash", title: "Cash by bank account", head: ["Account", "Bank", "Balance"], rows: [...cashRows, ["Total", "", cash]], totalRow: true },
    ],
  };
}

// ---------------------------------------------------------------- Recruitment
async function recruitment(): Promise<ViewData> {
  const supabase = await createClient();
  const STAGES = ["applied", "screening", "interview", "selected", "offered", "hired", "rejected"] as const;
  const [reqs, cands, offers] = await Promise.all([
    supabase.from("requisitions").select("id, req_no, title, headcount, status, created_at, department:departments(name)").in("status", ["pending", "approved"]).order("created_at"),
    supabase.from("candidates").select("requisition_id, stage, source, created_at, updated_at"),
    supabase.from("offers").select("status"),
  ]);
  const c = cands.data ?? [];
  const t = pkToday();
  const m0 = `${t.slice(0, 7)}-01`;
  const open = (reqs.data ?? []).filter((r) => r.status === "approved");
  const inPipe = c.filter((x) => x.stage !== "hired" && x.stage !== "rejected");
  const hiredMonth = c.filter((x) => x.stage === "hired" && x.updated_at >= m0).length;
  const offerRows = offers.data ?? [];
  const accepted = offerRows.filter((o) => o.status === "accepted").length;
  const decided = offerRows.filter((o) => o.status === "accepted" || o.status === "declined").length;
  const days = (d: string) => Math.max(0, Math.floor((Date.parse(t) - Date.parse(d)) / 86400000));
  const sources = c.reduce<Record<string, { all: number; hired: number }>>((acc, x) => {
    const k = x.source ?? "Unknown";
    acc[k] = acc[k] ?? { all: 0, hired: 0 };
    acc[k].all++;
    if (x.stage === "hired") acc[k].hired++;
    return acc;
  }, {});

  return {
    scope: "Open and pending requisitions",
    kpis: [
      { label: "Open positions", value: open.reduce((a, r) => a + r.headcount, 0), hint: `${open.length} approved requisitions`, href: "/recruitment" },
      { label: "In the pipeline", value: inPipe.length, hint: `${c.filter((x) => x.stage === "interview").length} at interview` },
      { label: "Hired this month", value: hiredMonth },
      { label: "Offer acceptance", value: pct(accepted, decided), hint: `${decided} offers decided` },
    ],
    blocks: [
      {
        key: "requisitions",
        title: "Requisitions",
        head: ["Requisition", "Department", "Status", "Openings", "Days open", ...STAGES.slice(0, 6).map((s) => s[0].toUpperCase() + s.slice(1))],
        rows: (reqs.data ?? []).map((r) => {
          const mine = c.filter((x) => x.requisition_id === r.id);
          return [
            { text: `${r.req_no} · ${r.title}`, href: `/recruitment/${r.id}` },
            (r.department as unknown as { name: string } | null)?.name ?? "—",
            r.status,
            r.headcount,
            days(r.created_at),
            ...STAGES.slice(0, 6).map((s) => mine.filter((x) => x.stage === s).length),
          ];
        }),
      },
      {
        key: "funnel",
        title: "Pipeline by stage",
        head: ["Stage", "Candidates", "Share"],
        rows: STAGES.map((s) => {
          const k = c.filter((x) => x.stage === s).length;
          return [s[0].toUpperCase() + s.slice(1), k, pct(k, c.length)];
        }),
      },
      {
        key: "sources",
        title: "Candidate sources",
        head: ["Source", "Candidates", "Hired", "Hire rate"],
        rows: Object.entries(sources)
          .sort((a, b) => b[1].all - a[1].all)
          .map(([k, x]) => [k.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase()), x.all, x.hired, pct(x.hired, x.all)]),
      },
    ],
  };
}

export async function loadView(key: ViewKey, s: Session): Promise<ViewData> {
  switch (key) {
    case "workforce":
      return workforce(s);
    case "attendance":
      return attendance(s);
    case "leave":
      return leave(s);
    case "payroll":
      return payroll();
    case "finance":
      return finance();
    case "recruitment":
      return recruitment();
  }
}

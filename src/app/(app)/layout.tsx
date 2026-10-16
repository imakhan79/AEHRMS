import Link from "next/link";
import { requireSession, hasAnyRole, DIRECTORY_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BrandLogo } from "@/components/brand";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { Nav, type NavItem } from "./nav";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  const unread = count ?? 0;

  const items: NavItem[] = [{ href: "/dashboard", label: "Dashboard", section: "Overview" }];
  const approver = session.isHR || session.roles.has("hod") || session.hasReports;
  if (session.employee) {
    items.push(
      { href: "/profile", label: "My Profile", section: "Self-service" },
      { href: "/attendance", label: "Attendance", section: "Self-service" },
      { href: "/leave", label: "Leave", section: "Self-service" },
      { href: "/payslips", label: "My Payslips", section: "Self-service" },
      { href: "/expenses", label: "Expenses & travel", section: "Self-service" },
      { href: "/loans", label: "Loans & advances", section: "Self-service" },
      { href: "/helpdesk", label: "Helpdesk", section: "Self-service" },
    );
  } else if (approver) {
    items.push({ href: "/leave", label: "Leave approvals", section: "Self-service" });
  }
  if (approver) {
    items.push({ href: "/attendance/approvals", label: "Attendance approvals", section: "Team" });
  }
  if (approver || session.isFinance) {
    items.push(
      { href: "/expenses/approvals", label: "Expense approvals", section: "Team" },
      { href: "/loans#approvals", label: "Loan approvals", section: "Team" },
    );
  }
  if (!session.employee && (session.isHR || session.canReadPayroll)) {
    items.push({ href: "/helpdesk?view=all", label: "Helpdesk", section: "HR" });
  }
  if (session.hasReports || hasAnyRole(session, ["hr_admin", "system_admin", "executive", "finance", "auditor", "hod"])) {
    items.push({ href: "/attendance/reports", label: "Attendance reports", section: "Team" });
  }
  if (session.isHR) items.push({ href: "/attendance/setup", label: "Attendance setup", section: "HR" });
  if (session.canReadPayroll) {
    items.push(
      { href: "/payroll", label: "Payroll runs", section: "Payroll & Finance" },
      { href: "/payroll/fnf", label: "Final settlements", section: "Payroll & Finance" },
      { href: "/payroll/setup", label: "Payroll setup", section: "Payroll & Finance" },
      { href: "/finance", label: "Finance overview", section: "Finance" },
      { href: "/finance/payables", label: "Payables", section: "Finance" },
      { href: "/finance/receivables", label: "Receivables", section: "Finance" },
      { href: "/finance/journals", label: "Journals", section: "Finance" },
      { href: "/finance/bank", label: "Bank reconciliation", section: "Finance" },
      { href: "/finance/reports", label: "Reports", section: "Finance" },
      { href: "/finance/budgets", label: "Budgets", section: "Finance" },
      { href: "/finance/ledger", label: "Trial balance", section: "Finance" },
      { href: "/finance/accounts", label: "Chart of accounts", section: "Finance" },
      { href: "/finance/settings", label: "Periods & taxes", section: "Finance" },
    );
  }
  if (hasAnyRole(session, DIRECTORY_ROLES) || session.employee) {
    items.push({ href: "/employees", label: "Employees", section: "HR" });
  }
  items.push({ href: "/organization", label: "Organization", section: "HR" });
  if (session.isAdmin) items.push({ href: "/admin/roles", label: "Users & Roles", section: "Administration" });
  if (hasAnyRole(session, ["system_admin", "auditor"])) {
    items.push({ href: "/admin/audit", label: "Audit Log", section: "Administration" });
  }

  const roleNames = [...session.roles]
    .filter((r) => r !== "employee")
    .map((r) => ROLE_LABELS[r as AppRole]);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto bg-indigo-950 px-3 py-5 md:flex print:hidden">
        <Link href="/dashboard" className="mb-8 block px-2" aria-label="Zicon HRMS — dashboard">
          <BrandLogo onDark priority />
          <div className="mt-2 px-1 text-[11px] font-medium tracking-wide text-stone-400">HRMS · AE Global Group</div>
        </Link>
        <Nav items={items} id="side" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur md:px-8 print:hidden">
          <details className="relative md:hidden">
            <summary className="flex h-10 cursor-pointer list-none items-center rounded-lg px-3 text-sm font-medium text-gray-700 ring-1 ring-gray-300">Menu</summary>
            <div className="absolute left-0 z-40 mt-2 max-h-[75dvh] w-64 overflow-y-auto rounded-xl bg-indigo-950 p-3 shadow-xl">
              <Nav items={items} id="mobile" />
            </div>
          </details>
          <div className="hidden text-sm text-gray-500 md:block">
            {roleNames.length > 0 ? roleNames.join(" · ") : session.employee ? "Employee" : "No role assigned"}
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold text-gray-900">{session.employee?.full_name ?? session.email}</div>
              {session.employee && <div className="text-xs text-gray-500">{session.employee.employee_code}</div>}
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-800" aria-hidden="true">
              {(session.employee?.full_name ?? session.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
            </div>
            <Link href="/notifications" className="relative flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 ring-1 ring-gray-300 transition-colors hover:bg-gray-50" aria-label={`Notifications (${unread} unread)`}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                <path d="M10 2a6 6 0 0 0-6 6v3.6l-1.3 2.1A.8.8 0 0 0 3.4 15h13.2a.8.8 0 0 0 .7-1.3L16 11.6V8a6 6 0 0 0-6-6Zm0 16a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 10 18Z" />
              </svg>
              {unread > 0 && (
                <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
              )}
            </Link>
            <SignOutButton />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8 md:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

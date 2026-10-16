import { requireSession, hasAnyRole, DIRECTORY_ROLES } from "@/lib/auth";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { Nav, type NavItem } from "./nav";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();

  const items: NavItem[] = [{ href: "/dashboard", label: "Dashboard", section: "Overview" }];
  const approver = session.isHR || session.roles.has("hod") || session.hasReports;
  if (session.employee) {
    items.push(
      { href: "/profile", label: "My Profile", section: "Self-service" },
      { href: "/attendance", label: "Attendance", section: "Self-service" },
      { href: "/leave", label: "Leave", section: "Self-service" },
      { href: "/payslips", label: "My Payslips", section: "Self-service" },
    );
  } else if (approver) {
    items.push({ href: "/leave", label: "Leave approvals", section: "Self-service" });
  }
  if (approver) {
    items.push({ href: "/attendance/approvals", label: "Attendance approvals", section: "Team" });
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
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-indigo-950 px-3 py-5 md:flex print:hidden">
        <div className="mb-8 flex items-center gap-2.5 px-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-xs font-bold text-white">AE</div>
          <div>
            <div className="text-sm font-semibold text-white">AE Global</div>
            <div className="text-[11px] text-indigo-200/70">HRMS</div>
          </div>
        </div>
        <Nav items={items} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3 md:px-8 print:hidden">
          <details className="relative md:hidden">
            <summary className="cursor-pointer list-none rounded-lg px-2 py-1 text-sm font-medium text-gray-700 ring-1 ring-gray-300">Menu</summary>
            <div className="absolute left-0 z-10 mt-2 w-56 rounded-xl bg-indigo-950 p-3 shadow-lg">
              <Nav items={items} />
            </div>
          </details>
          <div className="hidden text-sm text-gray-500 md:block">
            {roleNames.length > 0 ? roleNames.join(" · ") : session.employee ? "Employee" : "No role assigned"}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium text-gray-900">{session.employee?.full_name ?? session.email}</div>
              {session.employee && <div className="text-xs text-gray-500">{session.employee.employee_code}</div>}
            </div>
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

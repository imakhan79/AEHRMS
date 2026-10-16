import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = {
  title: "AE Global HRMS — HR, attendance & payroll in one place",
  description:
    "Integrated HR management for AE Global Group: employee records, self-service, leave, GPS & biometric attendance, with native payroll and finance on the way.",
};

const MODULES: { name: string; text: string; live: boolean }[] = [
  { name: "Organization", text: "Company, departments, sections, teams, positions, locations and cost centers with an organogram.", live: true },
  { name: "Employee records", text: "Complete master data, CNIC & bank details under restricted access, history, dependents and digital files.", live: true },
  { name: "Self-service", text: "Employees update contact details, upload documents, view balances and track every request.", live: true },
  { name: "Leave", text: "Policy-checked requests, working-day calculation, holidays per location and manager → HR approvals.", live: true },
  { name: "Attendance", text: "Biometric devices, web & mobile check-in with GPS geofence and selfie, offline sync, shifts and overtime.", live: true },
  { name: "Payroll", text: "Gross-to-net with FBR income tax, EOBI, PESSI, PF and VPS; payslips and bank files.", live: false },
  { name: "Finance & Accounting", text: "Native GL, AP, AR, bank reconciliation and automatic payroll posting.", live: false },
  { name: "Recruitment", text: "Requisitions, candidate pipeline, interviews, offers and onboarding.", live: false },
  { name: "Performance & Training", text: "KPIs, OKRs, appraisal cycles, training needs and certifications.", live: false },
];

const STEPS = [
  ["Check in", "Ayesha checks in from a client site on her phone. GPS shows she's 5.8 km from the office."],
  ["Verify", "Her manager Bilal sees the punch with distance and selfie, and verifies it in one click."],
  ["Compute", "The day is recomputed instantly — worked hours, late minutes and overtime — ready for payroll."],
];

export default async function HomePage() {
  const session = await getSession();
  const demo = process.env.DEMO_MODE === "true";

  return (
    <div className="bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">AE</span>
          <span className="text-sm font-semibold text-gray-900">AE Global HRMS</span>
        </Link>
        <nav className="flex items-center gap-2">
          <a href="#modules" className="hidden px-3 py-2 text-sm text-gray-600 hover:text-gray-900 sm:block">
            Modules
          </a>
          <a href="#security" className="hidden px-3 py-2 text-sm text-gray-600 hover:text-gray-900 sm:block">
            Security
          </a>
          {session ? (
            <Link href="/dashboard" className={buttonClass()}>
              Open dashboard
            </Link>
          ) : (
            <Link href="/login" className={buttonClass()}>
              Sign in
            </Link>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-indigo-50 to-white" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-2 lg:pt-20">
          <div>
            <p className="mb-4 inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
              Lahore · Gujranwala · Islamabad · project sites
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
              One system for your people, their time and their pay.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600">
              AE Global HRMS replaces paper forms and spreadsheets with approvals that route themselves, attendance that
              computes itself, and records every change — built for Pakistani statutory rules.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {session ? (
                <Link href="/dashboard" className={`${buttonClass()} px-5 py-2.5`}>
                  Go to your dashboard →
                </Link>
              ) : (
                <>
                  <Link href="/login" className={`${buttonClass()} px-5 py-2.5`}>
                    Sign in
                  </Link>
                  {demo && (
                    <Link href="/login" className={`${buttonClass("secondary")} px-5 py-2.5`}>
                      Try the live demo
                    </Link>
                  )}
                </>
              )}
            </div>
            {demo && !session && (
              <p className="mt-3 text-sm text-gray-500">No sign-up needed — explore as an HR admin, a manager or an employee.</p>
            )}
          </div>

          {/* Product preview built from the real UI vocabulary */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xl shadow-indigo-900/5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">Welcome, Bilal</div>
                <div className="text-xs text-gray-500">IT Department · today</div>
              </div>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20">Checked in 08:58</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                ["Team present", "11 / 12"],
                ["To approve", "3"],
                ["Annual leave", "9 days"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{k}</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-100 text-sm">
              {[
                ["Ayesha Malik", "Field check-in · 5.8 km", "Verify", "amber"],
                ["Usman Raza", "Annual leave · 3 days", "Approve", "amber"],
                ["Hamza Iqbal", "Correction · forgot check-out", "Approve", "amber"],
              ].map(([name, what, action]) => (
                <div key={name} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900">{name}</div>
                    <div className="truncate text-xs text-gray-500">{what}</div>
                  </div>
                  <span className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white">{action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-gray-100 bg-gray-50/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900">From check-in to payroll, without a spreadsheet</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {STEPS.map(([title, text], i) => (
              <div key={title} className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">{i + 1}</div>
                <h3 className="mt-4 font-semibold text-gray-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Modules</h2>
          <p className="mt-2 text-gray-600">HR and Finance share one database, so payroll posts straight to the ledger. Rolling out in phases.</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.name} className={`rounded-xl p-5 ring-1 ${m.live ? "bg-white ring-gray-200" : "bg-gray-50 ring-gray-100"}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className={`font-semibold ${m.live ? "text-gray-900" : "text-gray-600"}`}>{m.name}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                    m.live ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-white text-gray-500 ring-gray-200"
                  }`}
                >
                  {m.live ? "Live" : "Coming"}
                </span>
              </div>
              <p className={`mt-2 text-sm leading-relaxed ${m.live ? "text-gray-600" : "text-gray-500"}`}>{m.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Security */}
      <section id="security" className="scroll-mt-8 bg-indigo-950 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Private by design</h2>
            <p className="mt-3 text-indigo-200">Access rules live in the database itself, so no screen or API call can show data a role isn&apos;t allowed to see.</p>
          </div>
          <ul className="grid gap-5 text-sm sm:grid-cols-2 lg:col-span-2">
            {[
              ["Role-based access", "Employee, manager/HOD, HR, Finance, Executive, Recruiter, Auditor and System Admin — each sees only their scope."],
              ["Restricted personal data", "CNIC, bank and statutory numbers are separated and visible only to HR, Finance, auditors and the employee."],
              ["Complete audit trail", "Every create, change and delete is logged with who and when. The log can't be edited — even by admins."],
              ["Approvals you can trust", "Nobody approves their own leave or attendance; submitted requests can't be quietly altered."],
            ].map(([t, d]) => (
              <li key={t}>
                <div className="font-semibold">{t}</div>
                <p className="mt-1 leading-relaxed text-indigo-200">{d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900">{session ? "Pick up where you left off" : "Ready to sign in?"}</h2>
        <p className="mt-2 text-gray-600">Use your work email. HR links your account to your employee record.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={session ? "/dashboard" : "/login"} className={`${buttonClass()} px-5 py-2.5`}>
            {session ? "Open dashboard" : "Sign in"}
          </Link>
        </div>
      </section>

      <footer className="border-t border-gray-100">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-gray-500 sm:px-6">
          <span>© {new Date().getFullYear()} AE Global Group of Companies</span>
          <span>Human Resource Management System</span>
        </div>
      </footer>
    </div>
  );
}

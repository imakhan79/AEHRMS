import type { Metadata } from "next";
import Link from "next/link";
import {
  ChartColumn,
  Laptop,
  ArrowRight,
  BadgeCheck,
  Building2,
  Clock,
  FileLock2,
  GraduationCap,
  HandCoins,
  Landmark,
  LifeBuoy,
  Receipt,
  ScrollText,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { buttonClass } from "@/components/ui";
import { BrandLogo } from "@/components/brand";
import { FadeIn, HoverLift, Reveal, Stagger, StaggerItem } from "@/components/motion";

export const metadata: Metadata = {
  title: "Zicon HRMS — HR, attendance, payroll & finance in one place",
  description:
    "Integrated HR management by Zicon Technology for AE Global Group: employee records, self-service, leave, GPS & biometric attendance, payroll with FBR/EOBI, and native finance.",
};

const MODULES: { name: string; text: string; live: boolean; icon: LucideIcon }[] = [
  { name: "Organization", text: "Departments, sections, teams, positions, locations and cost centers with an organogram.", live: true, icon: Building2 },
  { name: "Employee records", text: "Complete master data, CNIC & bank details under restricted access, history, dependents and files.", live: true, icon: Users },
  { name: "Attendance", text: "Biometric devices, web & mobile check-in with GPS geofence and selfie, offline sync, shifts and overtime.", live: true, icon: Clock },
  { name: "Leave", text: "Policy-checked requests, working-day calculation, holidays per location and manager → HR approvals.", live: true, icon: BadgeCheck },
  { name: "Payroll", text: "Gross-to-net with FBR income tax, EOBI, PESSI, PF and VPS; payslips, bank files and final settlements.", live: true, icon: Wallet },
  { name: "Finance & Accounting", text: "GL, journals, AP & AR with GST/WHT, bank reconciliation, budgets and financial statements.", live: true, icon: Landmark },
  { name: "Expenses & travel", text: "Travel requests with advances, receipt-backed claims, manager and Finance approval, reimbursement.", live: true, icon: Receipt },
  { name: "Loans & helpdesk", text: "Online loan applications with payroll recovery; HR tickets tracked against SLA.", live: true, icon: LifeBuoy },
  { name: "Recruitment & performance", text: "Requisitions, candidate pipeline, interviews, offers, appraisals, goals and training.", live: true, icon: GraduationCap },
  { name: "Assets, benefits & exit", text: "Asset issue and returns, benefit plans with payroll deductions, resignations and clearance.", live: true, icon: Laptop },
  { name: "Analytics & administration", text: "Role-based dashboards with drill-down and Excel export, approval-chain and notification rules, user management.", live: true, icon: ChartColumn },
];

const STEPS = [
  ["Check in", "Ayesha checks in from a client site on her phone. GPS shows she's 5.8 km from the office."],
  ["Verify", "Her manager Bilal sees the punch with distance and selfie, and verifies it in one click."],
  ["Pay & post", "The day flows into payroll; the approved run posts a balanced journal to the ledger automatically."],
];

const TRUST: [LucideIcon, string, string][] = [
  [ShieldCheck, "Role-based access", "Employee, manager/HOD, HR, Finance, Executive, Recruiter, Auditor and Admin — each sees only their scope."],
  [FileLock2, "Restricted personal data", "CNIC, bank and statutory numbers are separated and visible only to HR, Finance, auditors and the employee."],
  [ScrollText, "Complete audit trail", "Every create, change and delete is logged with who and when. The log can't be edited — even by admins."],
  [HandCoins, "Maker-checker", "Nobody approves their own leave, payroll, payments or journals; posted entries are immutable."],
];

export default async function HomePage() {
  const session = await getSession();
  const demo = process.env.DEMO_MODE === "true";

  return (
    <div className="bg-white">
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Zicon HRMS home">
            <BrandLogo priority className="max-h-10" />
          </Link>
          <nav aria-label="Home" className="flex items-center gap-1">
            <a href="#modules" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 sm:block">
              Modules
            </a>
            <a href="#security" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 sm:block">
              Security
            </a>
            <Link href={session ? "/dashboard" : "/login"} className={buttonClass()}>
              {session ? "Open dashboard" : "Sign in"}
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_70%_0%,_#fdf3e2_0%,_transparent_60%),radial-gradient(ellipse_60%_50%_at_0%_10%,_#fae8e6_0%,_transparent_60%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-2 lg:pt-20">
          <FadeIn>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-amber" aria-hidden="true" />
              AE Global Group · Lahore · Gujranwala · Islamabad
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight text-balance text-gray-900 sm:text-5xl">
              One system for your people, <span className="text-indigo-700">their time</span> and <span className="text-indigo-700">their pay.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600">
              Approvals that route themselves, attendance that computes itself, payroll that posts to the ledger — with every change on record.
              Built for Pakistani statutory rules.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={session ? "/dashboard" : "/login"} className={`${buttonClass()} px-5 py-3 text-base`}>
                {session ? "Go to your dashboard" : "Sign in"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              {demo && !session && (
                <Link href="/login" className={`${buttonClass("secondary")} px-5 py-3 text-base`}>
                  Try the live demo
                </Link>
              )}
            </div>
            {demo && !session && <p className="mt-3 text-sm text-gray-500">No sign-up needed — explore as HR, a manager, Finance or an employee.</p>}
          </FadeIn>

          {/* Product preview in the real UI vocabulary */}
          <FadeIn delay={0.15} y={24}>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_24px_60px_-20px_rgba(115,32,27,0.25)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Welcome, Bilal</div>
                  <div className="text-xs text-gray-500">IT Department · today</div>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">Checked in 08:58</span>
              </div>
              <Stagger className="grid grid-cols-3 gap-3">
                {[
                  ["Team present", "11 / 12"],
                  ["To approve", "3"],
                  ["Annual leave", "9 days"],
                ].map(([k, v]) => (
                  <StaggerItem key={k} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{k}</div>
                    <div className="mt-1 text-lg font-bold tabular-nums text-gray-900">{v}</div>
                  </StaggerItem>
                ))}
              </Stagger>
              <div className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-100 text-sm">
                {[
                  ["Ayesha Malik", "Field check-in · 5.8 km", "Verify"],
                  ["Usman Raza", "Annual leave · 3 days", "Approve"],
                  ["Hamza Iqbal", "Correction · forgot check-out", "Approve"],
                ].map(([name, what, action]) => (
                  <div key={name} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900">{name}</div>
                      <div className="truncate text-xs text-gray-500">{what}</div>
                    </div>
                    <span className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white">{action}</span>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Reveal>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">From check-in to the ledger, without a spreadsheet</h2>
          </Reveal>
          <Stagger className="mt-8 grid gap-6 md:grid-cols-3">
            {STEPS.map(([title, text], i) => (
              <StaggerItem key={title} className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-700 text-sm font-bold text-white">{i + 1}</div>
                <h3 className="mt-4 font-semibold text-gray-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{text}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <Reveal className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">Modules</h2>
          <p className="mt-2 text-gray-600">HR and Finance share one database, so payroll, expenses and loans post straight to the ledger.</p>
        </Reveal>
        <Stagger className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <StaggerItem key={m.name}>
              <HoverLift className={`h-full rounded-xl p-5 ring-1 ${m.live ? "bg-white ring-gray-200" : "bg-gray-50 ring-gray-100"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${m.live ? "bg-indigo-50 text-indigo-700" : "bg-gray-100 text-gray-500"}`}>
                      <m.icon className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
                    </span>
                    <h3 className={`font-semibold ${m.live ? "text-gray-900" : "text-gray-600"}`}>{m.name}</h3>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                      m.live ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-brand-amber-soft text-amber-800 ring-amber-600/20"
                    }`}
                  >
                    {m.live ? "Live" : "Next"}
                  </span>
                </div>
                <p className={`mt-3 text-sm leading-relaxed ${m.live ? "text-gray-600" : "text-gray-500"}`}>{m.text}</p>
              </HoverLift>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Security */}
      <section id="security" className="scroll-mt-20 bg-indigo-950 text-white">
        <Reveal className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Private by design</h2>
            <p className="mt-3 text-stone-300">Access rules live in the database itself, so no screen or API call can show data a role isn&apos;t allowed to see.</p>
          </div>
          <ul className="grid gap-6 text-sm sm:grid-cols-2 lg:col-span-2">
            {TRUST.map(([Icon, t, d]) => (
              <li key={t} className="flex gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-amber" aria-hidden="true" strokeWidth={1.75} />
                <div>
                  <div className="font-semibold">{t}</div>
                  <p className="mt-1 leading-relaxed text-stone-300">{d}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <Reveal>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">{session ? "Pick up where you left off" : "Ready to sign in?"}</h2>
          <p className="mt-2 text-gray-600">Use your work email. HR links your account to your employee record.</p>
          <div className="mt-6 flex justify-center">
            <Link href={session ? "/dashboard" : "/login"} className={`${buttonClass()} px-5 py-3 text-base`}>
              {session ? "Open dashboard" : "Sign in"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-gray-100">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-gray-500 sm:px-6">
          <span>© {new Date().getFullYear()} Zicon Technology · HRMS for AE Global Group of Companies</span>
          <BrandLogo className="max-h-6 opacity-80" />
        </div>
      </footer>
    </div>
  );
}

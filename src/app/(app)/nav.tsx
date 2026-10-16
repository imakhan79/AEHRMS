"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  BadgeDollarSign,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  Clock,
  FileBarChart,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Timer,
  User,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/components/ui";

export interface NavItem {
  href: string;
  label: string;
  section: string;
}

const ICONS: [string, LucideIcon][] = [
  ["/dashboard", LayoutDashboard],
  ["/profile", User],
  ["/attendance/approvals", ClipboardCheck],
  ["/attendance/reports", FileBarChart],
  ["/attendance/setup", Timer],
  ["/attendance", Clock],
  ["/leave", CalendarDays],
  ["/payslips", FileText],
  ["/expenses/approvals", ClipboardCheck],
  ["/expenses", Receipt],
  ["/loans", HandCoins],
  ["/helpdesk", LifeBuoy],
  ["/employees", Users],
  ["/organization", Building2],
  ["/admin/roles", UserCog],
  ["/admin/audit", ShieldCheck],
  ["/payroll/fnf", ScrollText],
  ["/payroll/setup", Settings],
  ["/payroll", Wallet],
  ["/finance/payables", BadgeDollarSign],
  ["/finance/receivables", BadgeDollarSign],
  ["/finance/journals", BookOpen],
  ["/finance/bank", Landmark],
  ["/finance/reports", FileBarChart],
  ["/finance/budgets", CalendarCheck],
  ["/finance/settings", Settings],
  ["/finance", Landmark],
];

function iconFor(href: string): LucideIcon {
  const path = href.split(/[?#]/)[0];
  return ICONS.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1] ?? FileText;
}

function isActive(pathname: string, href: string, all: NavItem[]) {
  const path = href.split(/[?#]/)[0];
  if (!(pathname === path || pathname.startsWith(`${path}/`))) return false;
  // Prefer the most specific matching item (e.g. /finance/bank over /finance).
  return !all.some((o) => {
    const p = o.href.split(/[?#]/)[0];
    return p !== path && p.startsWith(path) && (pathname === p || pathname.startsWith(`${p}/`));
  });
}

export function Nav({ items, id = "nav" }: { items: NavItem[]; id?: string }) {
  const pathname = usePathname();
  const sections = [...new Set(items.map((i) => i.section))];

  return (
    <nav aria-label="Main" className="space-y-6">
      {sections.map((section) => (
        <div key={section}>
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{section}</div>
          <ul className="space-y-0.5">
            {items
              .filter((i) => i.section === section)
              .map((item) => {
                const active = isActive(pathname, item.href, items);
                const Icon = iconFor(item.href);
                return (
                  <li key={item.href} className="relative">
                    {active && (
                      <motion.span
                        layoutId={`${id}-active`}
                        className="absolute inset-0 rounded-lg bg-white/10 ring-1 ring-white/10 before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-[#e99a22]"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                        aria-hidden="true"
                      />
                    )}
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
                        active ? "text-white" : "text-stone-300 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-[#e99a22]" : "text-stone-400")} aria-hidden="true" strokeWidth={1.75} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

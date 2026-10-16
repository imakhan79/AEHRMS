"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

export interface NavItem {
  href: string;
  label: string;
  section: string;
}

export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const sections = [...new Set(items.map((i) => i.section))];

  return (
    <nav className="space-y-6">
      {sections.map((section) => (
        <div key={section}>
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-200/70">{section}</div>
          <ul className="space-y-0.5">
            {items
              .filter((i) => i.section === section)
              .map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "block rounded-lg px-3 py-2 text-sm font-medium transition",
                        active ? "bg-white/10 text-white" : "text-indigo-100 hover:bg-white/5 hover:text-white",
                      )}
                    >
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

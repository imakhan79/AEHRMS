import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, cn } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { toggleOnboardingTask } from "../../talent-actions";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("onboarding_tasks")
    .select("*, employees!onboarding_tasks_employee_id_fkey(id, full_name, employee_code, joining_date)")
    .order("sort_order");
  type T = NonNullable<typeof data>[number];
  const byEmp = new Map<string, { emp: T["employees"]; tasks: T[] }>();
  for (const t of data ?? []) {
    const k = t.employee_id;
    const g = byEmp.get(k) ?? { emp: t.employees, tasks: [] };
    g.tasks.push(t);
    byEmp.set(k, g);
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Onboarding" description="Checklists generated automatically when a candidate is hired." />
      <div className="grid gap-6 lg:grid-cols-2">
        {[...byEmp.values()].map(({ emp, tasks }) => {
          const done = tasks.filter((t) => t.done_at).length;
          return (
            <Card
              key={emp?.id}
              title={emp?.full_name ?? "Employee"}
              description={`${emp?.employee_code} · joins ${fmtDate(emp?.joining_date)} · ${done}/${tasks.length} done`}
              actions={
                <Link href={`/employees/${emp?.id}`} className="text-xs text-indigo-600 hover:underline">
                  Record →
                </Link>
              }
            >
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={done} aria-valuemax={tasks.length} aria-label="Onboarding progress">
                <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${(done / tasks.length) * 100}%` }} />
              </div>
              <ul className="space-y-1.5">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <form action={toggleOnboardingTask.bind(null, t.id, !t.done_at)} className="flex items-center gap-2 text-sm">
                      <button
                        aria-label={t.done_at ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
                        className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs", t.done_at ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 bg-white")}
                      >
                        {t.done_at ? "✓" : ""}
                      </button>
                      <span className={cn("flex-1", t.done_at && "text-gray-400 line-through")}>{t.title}</span>
                      <span className="text-xs text-gray-500">{t.owner}</span>
                      <span className={cn("w-20 text-right text-xs", !t.done_at && t.due_date && t.due_date < today ? "font-semibold text-red-700" : "text-gray-400")}>{fmtDate(t.due_date)}</span>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
        {byEmp.size === 0 && <Card>No onboarding in progress. Checklists appear here when you hire a candidate.</Card>}
      </div>
    </>
  );
}

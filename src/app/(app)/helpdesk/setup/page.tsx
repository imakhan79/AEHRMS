import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { TicketCategoryForm } from "../../workflow-forms";

export const metadata: Metadata = { title: "Helpdesk SLA setup" };

/** Must match the multipliers in private.ticket_before_insert(). */
const PRIORITY_FACTORS = [
  ["Critical", 0.25],
  ["High", 0.5],
  ["Medium", 1],
  ["Low", 2],
] as const;

export default async function HelpdeskSetupPage() {
  const session = await requireSession();
  if (!session.isHR) redirect("/helpdesk");
  const supabase = await createClient();
  const [{ data: cats }, { data: emps }] = await Promise.all([
    supabase.from("ticket_categories").select("id, name, sla_response_hours, sla_resolution_hours, default_assignee_id, is_active").order("name"),
    supabase.from("employees").select("id, full_name, employee_code").is("deleted_at", null).not("status", "in", "(draft,exited)").order("full_name"),
  ]);
  const employees = (emps ?? []).map((e) => ({ id: e.id, label: `${e.full_name} (${e.employee_code})` }));

  return (
    <>
      <PageHeader
        title="Helpdesk SLA setup"
        description="Response and resolution targets per ticket category. Changes apply to new tickets; open tickets keep the due times they were given."
        actions={
          <Link href="/helpdesk?view=all" className={buttonClass("secondary")}>
            ← Helpdesk
          </Link>
        }
      />
      <div className="space-y-6">
        <Card
          title="Categories"
          description="Tickets go to the default assignee, or to the HR team when none is set. Inactive categories can't be chosen for new tickets."
        >
          <div className="divide-y divide-gray-100">
            {(cats ?? []).map((c) => (
              <div key={c.id} className="py-4 first:pt-0">
                <TicketCategoryForm category={c} employees={employees} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Add a category">
          <TicketCategoryForm employees={employees} />
        </Card>

        <Card title="How priority changes the targets" description="Each ticket's due times are the category's hours multiplied by its priority factor.">
          <div className="grid gap-3 sm:grid-cols-4">
            {PRIORITY_FACTORS.map(([label, f]) => (
              <div key={label} className="rounded-xl bg-gray-50 px-4 py-3 ring-1 ring-gray-100">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">× {f}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-gray-500">
            Example: a 24-hour resolution target is 6 hours for a critical ticket and 48 hours for a low one. Tickets past either target are
            escalated to HR at a quarter past every hour.
          </p>
        </Card>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { setLeaveTypeHr, setNotificationRule } from "../actions";
import { Stagger, StaggerItem } from "@/components/motion";
import { WorkflowRuleForm, type Rule } from "../forms";

export const metadata: Metadata = { title: "Workflows & notifications" };

const TITLES: Record<Rule["workflow"], { title: string; chain: string }> = {
  leave: { title: "Leave", chain: "Employee → line manager → HR" },
  expense: { title: "Expense claims", chain: "Employee → line manager → Finance → reimbursed" },
  travel: { title: "Travel requests", chain: "Employee → line manager → Finance (advance)" },
  loan: { title: "Loans & advances", chain: "Employee → line manager → Finance → payroll recovery" },
};

export default async function WorkflowsPage() {
  const session = await requireSession();
  if (!session.isAdmin) redirect("/dashboard");
  const supabase = await createClient();
  const [{ data: rules }, { data: notes }, { data: types }] = await Promise.all([
    supabase.from("workflow_rules").select("workflow, manager_approval, manager_threshold, hr_above_days"),
    supabase.from("notification_rules").select("module, label, link_prefix, enabled").order("sort_order"),
    supabase.from("leave_types").select("id, name, requires_hr_approval").order("name"),
  ]);
  const byKey = new Map((rules ?? []).map((r) => [r.workflow, r as Rule]));

  return (
    <>
      <PageHeader
        title="Workflows & notifications"
        description="Set who approves what (ADM-03) and which notifications people receive (ADM-04). Employees without a line manager always skip the manager step."
      />
      <Stagger className="mb-6 grid gap-6 md:grid-cols-2">
        {(Object.keys(TITLES) as Rule["workflow"][]).map((w) => {
          const rule = byKey.get(w);
          return (
            <StaggerItem key={w}>
            <Card title={TITLES[w].title} description={TITLES[w].chain}>
              {rule && (
                <WorkflowRuleForm
                  rule={{ ...rule, manager_threshold: rule.manager_threshold == null ? null : Number(rule.manager_threshold), hr_above_days: rule.hr_above_days == null ? null : Number(rule.hr_above_days) }}
                />
              )}
              {w === "leave" && (
                <div className="mt-5 border-t border-gray-100 pt-4">
                  <div className="mb-2 text-xs font-medium text-gray-700">HR approval by leave type</div>
                  <ul className="space-y-1.5">
                    {(types ?? []).map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-800">{t.name}</span>
                        <form action={setLeaveTypeHr.bind(null, t.id, !t.requires_hr_approval)} className="flex items-center gap-2">
                          {t.requires_hr_approval ? <Badge tone="blue">HR required</Badge> : <Badge>Manager only</Badge>}
                          <button className="text-xs font-medium text-indigo-700 hover:underline">Change</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
            </StaggerItem>
          );
        })}
      </Stagger>
      <Card
        title="Notification rules"
        description="Switching a category off stops new in-app notifications for everyone. Approvals still show in each approver's queue."
        actions={
          <Link href="/notifications" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
            Your notifications →
          </Link>
        }
      >
        <Table head={["Category", "Opens", "Status", ""]}>
          {(notes ?? []).map((n) => (
            <tr key={n.module}>
              <Td className="font-medium text-gray-900">{n.label}</Td>
              <Td className="font-mono text-xs">{n.link_prefix}</Td>
              <Td>{n.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</Td>
              <Td className="text-right">
                <form action={setNotificationRule.bind(null, n.module, !n.enabled)}>
                  <button className={buttonClass(n.enabled ? "secondary" : "primary", "sm")}>{n.enabled ? "Turn off" : "Turn on"}</button>
                </form>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

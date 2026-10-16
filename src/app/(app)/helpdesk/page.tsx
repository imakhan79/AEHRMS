import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Notice, PageHeader, Stat, Table, Td, cn } from "@/components/ui";
import { fmtDateTime, titleCase } from "@/lib/format";
import { TicketForm } from "../workflow-forms";

export const metadata: Metadata = { title: "Helpdesk" };

const PRI = { low: "gray", medium: "blue", high: "amber", critical: "red" } as const;

function isPast(ts: string | null) {
  return !!ts && new Date(ts).getTime() < Date.now();
}

export default async function HelpdeskPage({ searchParams }: PageProps<"/helpdesk">) {
  const session = await requireSession();
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : sp.view === "assigned" ? "assigned" : "mine";
  const supabase = await createClient();
  let q = supabase
    .from("tickets")
    .select("*, ticket_categories(name), requester:employees!tickets_requester_id_fkey(full_name), assignee:employees!tickets_assignee_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (view === "mine" && session.employee) q = q.eq("requester_id", session.employee.id);
  if (view === "assigned" && session.employee) q = q.eq("assignee_id", session.employee.id);
  const [{ data: tickets }, { data: cats }] = await Promise.all([q, supabase.from("ticket_categories").select("id, name").eq("is_active", true).order("name")]);
  const list = tickets ?? [];
  const open = list.filter((t) => !["resolved", "closed"].includes(t.status));
  const resolved = list.filter((t) => t.resolved_at);
  const inSla = resolved.filter((t) => new Date(t.resolved_at!) <= new Date(t.resolution_due_at!)).length;
  const tabs = [["mine", "My tickets"], ...(session.employee ? [["assigned", "Assigned to me"]] : []), ...(session.isHR || session.canReadPayroll ? [["all", "All tickets"]] : [])];

  return (
    <>
      <PageHeader title="Helpdesk" description="Raise HR, payroll and IT queries and track them against SLA." />
      <div className="mb-4 flex gap-2">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/helpdesk?view=${k}`} className={cn("rounded-lg px-3 py-1.5 text-sm ring-1", view === k ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-gray-700 ring-gray-300")}>
            {label}
          </Link>
        ))}
      </div>
      {view !== "mine" && (
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <Stat label="Open" value={open.length} />
          <Stat label="Escalated (SLA breached)" value={list.filter((t) => t.escalated && !["resolved", "closed"].includes(t.status)).length} />
          <Stat label="Resolved within SLA" value={resolved.length ? `${Math.round((inSla / resolved.length) * 100)}%` : "—"} hint={`${resolved.length} resolved`} />
          <Stat label="Avg. satisfaction" value={(() => { const r = list.filter((t) => t.satisfaction); return r.length ? `${(r.reduce((s, t) => s + t.satisfaction!, 0) / r.length).toFixed(1)} ★` : "—"; })()} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Table head={["Ticket", "Category", "Priority", "Status", "Due", view === "mine" ? "Assignee" : "Requester"]} empty="No tickets.">
            {list.map((t) => {
              const overdue = !["resolved", "closed"].includes(t.status) && isPast(t.resolution_due_at);
              return (
                <tr key={t.id}>
                  <Td>
                    <Link href={`/helpdesk/${t.id}`} className="font-medium text-indigo-700 hover:underline">
                      {t.subject}
                    </Link>
                    <div className="font-mono text-xs text-gray-500">{t.ticket_no}</div>
                  </Td>
                  <Td className="text-xs">{t.ticket_categories?.name}</Td>
                  <Td>
                    <Badge tone={PRI[t.priority as keyof typeof PRI]}>{t.priority}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={t.status === "resolved" || t.status === "closed" ? "green" : "amber"}>{titleCase(t.status)}</Badge>
                  </Td>
                  <Td className={cn("text-xs", overdue && "font-semibold text-red-700")}>{["resolved", "closed"].includes(t.status) ? "—" : fmtDateTime(t.resolution_due_at)}</Td>
                  <Td className="text-xs">{view === "mine" ? (t.assignee?.full_name ?? "Unassigned") : t.requester?.full_name}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
        {session.employee ? (
          <Card title="Raise a ticket">
            <TicketForm categories={(cats ?? []).map((c) => ({ id: c.id, label: c.name }))} />
          </Card>
        ) : (
          <Notice tone="blue">Link your account to an employee record to raise tickets.</Notice>
        )}
      </div>
    </>
  );
}

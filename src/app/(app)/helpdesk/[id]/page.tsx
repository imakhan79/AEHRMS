import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, DescList, PageHeader, buttonClass, cn } from "@/components/ui";
import { fmtDateTime, titleCase } from "@/lib/format";
import { AgentTicketForm, CommentForm, RequesterTicketForm } from "../../workflow-forms";

export const metadata: Metadata = { title: "Ticket" };

export default async function TicketPage({ params }: PageProps<"/helpdesk/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await requireSession();
  const supabase = await createClient();
  const { data: t } = await supabase
    .from("tickets")
    .select("*, ticket_categories(name), requester:employees!tickets_requester_id_fkey(full_name, employee_code), assignee:employees!tickets_assignee_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!t) notFound();
  const agent = session.isHR || t.assignee_id === session.employee?.id;
  const [{ data: comments }, { data: agents }] = await Promise.all([
    supabase.from("ticket_comments").select("*, author:employees(full_name)").eq("ticket_id", id).order("created_at"),
    agent ? supabase.from("employees").select("id, full_name").is("deleted_at", null).neq("status", "exited").order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const isRequester = t.requester_id === session.employee?.id;
  const done = ["resolved", "closed"].includes(t.status);

  return (
    <>
      <PageHeader
        title={t.subject}
        description={`${t.ticket_no} · ${t.ticket_categories?.name} · raised by ${t.requester?.full_name}`}
        actions={
          <Link href="/helpdesk" className={buttonClass("secondary")}>
            ← Helpdesk
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <p className="whitespace-pre-wrap text-sm text-gray-800">{t.description}</p>
            <p className="mt-3 text-xs text-gray-400">{fmtDateTime(t.created_at)}</p>
          </Card>
          {(comments ?? []).map((c) => (
            <div key={c.id} className={cn("rounded-xl border p-4 text-sm", c.is_internal ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white")}>
              <div className="mb-1 flex justify-between text-xs text-gray-500">
                <span className="font-medium text-gray-700">
                  {c.author?.full_name ?? "System"}
                  {c.is_internal && " · internal note"}
                </span>
                {fmtDateTime(c.created_at)}
              </div>
              <p className="whitespace-pre-wrap text-gray-800">{c.body}</p>
            </div>
          ))}
          {t.status !== "closed" && (agent || isRequester) && (
            <Card>
              <CommentForm ticketId={id} agent={agent} />
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Details">
            <DescList
              items={[
                ["Status", <Badge key="s" tone={done ? "green" : "amber"}>{titleCase(t.status)}</Badge>],
                ["Priority", titleCase(t.priority)],
                ["Assignee", t.assignee?.full_name ?? "Unassigned"],
                ["Respond by", t.first_response_at ? `Responded ${fmtDateTime(t.first_response_at)}` : fmtDateTime(t.response_due_at)],
                ["Resolve by", fmtDateTime(t.resolution_due_at)],
                ["SLA", t.escalated ? <Badge key="e" tone="red">Breached — escalated</Badge> : "On track"],
                ["Rating", t.satisfaction ? "★".repeat(t.satisfaction) : "—"],
              ]}
            />
          </Card>
          {agent && t.status !== "closed" && (
            <Card title="Work this ticket">
              <AgentTicketForm ticketId={id} status={t.status} priority={t.priority} assignee={t.assignee_id} agents={(agents ?? []).map((a) => ({ id: a.id, label: a.full_name }))} />
            </Card>
          )}
          {isRequester && !agent && t.status === "resolved" && (
            <Card title="Was this resolved?">
              <RequesterTicketForm ticketId={id} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

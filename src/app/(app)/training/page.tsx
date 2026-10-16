import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Stat, Table, Td, buttonClass, cn } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";
import { CertificationForm, NeedForm, NominateForm, TrainingEventForm, TrainingFeedbackForm } from "../talent-forms";
import { setAttendance, setEventStatus, setNeedStatus, verifyCertification } from "../talent-actions";

export const metadata: Metadata = { title: "Training" };

function daysUntil(d: string | null) {
  if (!d) return null;
  return Math.round((new Date(`${d}T00:00:00`).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);
}

export default async function TrainingPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const me = session.employee?.id;
  const nominator = session.isHR || session.hasReports || session.roles.has("hod");
  const [{ data: events }, { data: parts }, { data: needs }, { data: certs }, { data: people }] = await Promise.all([
    supabase.from("training_events").select("*").order("start_date", { ascending: false }).limit(100),
    supabase.from("training_participants").select("*, employees!training_participants_employee_id_fkey(full_name)").limit(1000),
    supabase.from("training_needs").select("*, employees!training_needs_employee_id_fkey(full_name)").order("created_at", { ascending: false }),
    supabase.from("certifications").select("*, employees(full_name)").order("expires_on", { nullsFirst: false }),
    nominator ? supabase.from("employees").select("id, full_name").is("deleted_at", null).neq("status", "exited").order("full_name") : Promise.resolve({ data: [] }),
  ]);
  // Managers only see (and may nominate) their team through RLS; HR sees everyone.
  const peopleOpts = (people ?? []).filter((p) => session.isHR || p.id !== me).map((p) => ({ id: p.id, label: p.full_name }));
  const mine = (parts ?? []).filter((p) => p.employee_id === me);
  const evById = new Map((events ?? []).map((e) => [e.id, e]));
  const upcoming = (events ?? []).filter((e) => e.status === "planned");
  const expiring = (certs ?? []).filter((c) => {
    const d = daysUntil(c.expires_on);
    return d != null && d <= 30;
  });

  return (
    <>
      <PageHeader title="Training & development" description="Training needs, calendar and nominations, attendance and feedback, certifications with expiry alerts." />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Upcoming trainings" value={upcoming.length} />
        <Stat label="Open training needs" value={(needs ?? []).filter((n) => n.status === "open").length} />
        <Stat label="Certifications expiring ≤30 days" value={expiring.length} />
        <Stat label="Training spend (listed)" value={`PKR ${money((events ?? []).filter((e) => e.status !== "cancelled").reduce((s, e) => s + Number(e.cost), 0))}`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Training calendar">
            <div className="space-y-4">
              {(events ?? []).map((e) => {
                const ps = (parts ?? []).filter((p) => p.event_id === e.id && p.status !== "cancelled");
                return (
                  <div key={e.id} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-gray-900">{e.title}</div>
                        <div className="text-xs text-gray-500">
                          {fmtDate(e.start_date)}
                          {e.end_date !== e.start_date && ` – ${fmtDate(e.end_date)}`} · {titleCase(e.mode)}
                          {e.location ? ` · ${e.location}` : ""}
                          {e.trainer ? ` · ${e.trainer}` : ""} · {ps.length}
                          {e.capacity ? `/${e.capacity}` : ""} seats
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={e.status === "completed" ? "green" : e.status === "cancelled" ? "gray" : "blue"}>{titleCase(e.status)}</Badge>
                        {session.isHR && e.status === "planned" && (
                          <form action={setEventStatus.bind(null, e.id, "completed")}>
                            <button className={buttonClass("secondary", "sm")}>Mark completed</button>
                          </form>
                        )}
                      </div>
                    </div>
                    {ps.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {ps.map((p) => (
                          <li key={p.id} className="flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs">
                            {p.employees?.full_name}
                            <span className={cn("font-medium", p.status === "attended" ? "text-emerald-700" : p.status === "absent" ? "text-red-700" : "text-gray-500")}>· {p.status}</span>
                            {p.feedback_rating && <span className="text-amber-700">{"★".repeat(p.feedback_rating)}</span>}
                            {session.isHR && p.status === "nominated" && (
                              <>
                                <form action={setAttendance.bind(null, p.id, "attended")}>
                                  <button className="text-emerald-700 underline">attended</button>
                                </form>
                                <form action={setAttendance.bind(null, p.id, "absent")}>
                                  <button className="text-red-700 underline">absent</button>
                                </form>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {nominator && e.status === "planned" && peopleOpts.length > 0 && (
                      <div className="mt-3">
                        <NominateForm eventId={e.id} people={peopleOpts} />
                      </div>
                    )}
                  </div>
                );
              })}
              {!events?.length && <p className="text-sm text-gray-500">No trainings scheduled.</p>}
            </div>
          </Card>
          {session.employee && (
            <Card title="My trainings">
              <Table head={["Training", "Dates", "Status", "Feedback"]} empty="You haven't been nominated yet.">
                {mine.map((p) => {
                  const e = evById.get(p.event_id);
                  return (
                    <tr key={p.id}>
                      <Td className="font-medium text-gray-900">{e?.title}</Td>
                      <Td>{fmtDate(e?.start_date)}</Td>
                      <Td>
                        <Badge tone={p.status === "attended" ? "green" : p.status === "absent" ? "red" : "blue"}>{p.status}</Badge>
                      </Td>
                      <Td>{p.status === "attended" && !p.feedback_rating ? <TrainingFeedbackForm id={p.id} /> : p.feedback_rating ? "★".repeat(p.feedback_rating) : "—"}</Td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          )}
          <Card title="Certifications">
            <Table head={["Employee", "Certification", "Issuer", "Expires", ""]} empty="No certifications recorded.">
              {(certs ?? []).map((c) => {
                const d = daysUntil(c.expires_on);
                return (
                  <tr key={c.id}>
                    <Td>{c.employees?.full_name}</Td>
                    <Td className="font-medium text-gray-900">
                      {c.name} {c.verified ? <Badge tone="green">verified</Badge> : <Badge>unverified</Badge>}
                    </Td>
                    <Td>{c.issuer ?? "—"}</Td>
                    <Td className={cn(d != null && d < 0 ? "font-semibold text-red-700" : d != null && d <= 30 ? "font-semibold text-amber-700" : "")}>
                      {c.expires_on ? `${fmtDate(c.expires_on)}${d != null && d < 0 ? " (expired)" : d != null && d <= 30 ? ` (${d} days)` : ""}` : "No expiry"}
                    </Td>
                    <Td>
                      {session.isHR && !c.verified && (
                        <form action={verifyCertification.bind(null, c.id)}>
                          <button className="text-xs text-indigo-700 hover:underline">Verify</button>
                        </form>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          {session.isHR && (
            <Card title="Schedule training">
              <TrainingEventForm />
            </Card>
          )}
          <Card title="Training needs (TNA)">
            <ul className="mb-4 space-y-2 text-sm">
              {(needs ?? []).slice(0, 15).map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-medium text-gray-900">{n.skill}</span>
                    <span className="text-xs text-gray-500"> · {n.employees?.full_name} · {n.priority}</span>
                  </span>
                  {session.isHR && n.status === "open" ? (
                    <form action={setNeedStatus.bind(null, n.id, "planned")}>
                      <button className="text-xs text-indigo-700 hover:underline">Plan</button>
                    </form>
                  ) : (
                    <Badge tone={n.status === "open" ? "amber" : n.status === "planned" ? "blue" : "gray"}>{n.status}</Badge>
                  )}
                </li>
              ))}
              {!needs?.length && <li className="text-gray-500">None recorded.</li>}
            </ul>
            <NeedForm people={nominator ? peopleOpts : undefined} />
          </Card>
          <Card title="Add certification">
            <CertificationForm people={session.isHR ? peopleOpts : undefined} />
          </Card>
        </div>
      </div>
    </>
  );
}

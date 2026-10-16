import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Stat, Table, Td, buttonClass } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";
import { AssetForm, IssueForm, ReturnForm } from "../lifecycle-forms";
import { acknowledgeAsset, setAssetStatus } from "../lifecycle-actions";

export const metadata: Metadata = { title: "Assets" };

const TONE = { available: "green", assigned: "blue", maintenance: "amber", retired: "gray" } as const;

export default async function AssetsPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const me = session.employee?.id;
  const [{ data: assets }, { data: open }, { data: mine }, { data: people }, { data: locs }] = await Promise.all([
    supabase.from("assets").select("*, locations(name)").order("asset_tag"),
    supabase.from("asset_assignments").select("asset_id, issued_on, acknowledged_at, employees!asset_assignments_employee_id_fkey(full_name)").is("returned_on", null),
    me ? supabase.from("asset_assignments").select("*, assets(asset_tag, name, category, serial_number)").eq("employee_id", me).order("issued_on", { ascending: false }) : Promise.resolve({ data: [] }),
    session.isHR ? supabase.from("employees").select("id, full_name, employee_code").is("deleted_at", null).neq("status", "exited").order("full_name") : Promise.resolve({ data: [] }),
    session.isHR ? supabase.from("locations").select("id, name").order("name") : Promise.resolve({ data: [] }),
  ]);
  const holder = new Map((open ?? []).map((o) => [o.asset_id, o]));
  const list = assets ?? [];
  const peopleOpts = (people ?? []).map((p) => ({ id: p.id, label: `${p.full_name} · ${p.employee_code}` }));
  const register = session.isHR || session.canReadPayroll || session.roles.has("hod");

  return (
    <>
      <PageHeader title="Assets" description="Issue, acknowledge, transfer and receive company assets. Exit clearance checks this register." />
      {mine && mine.length > 0 && (
        <div className="mb-6">
          <Card title="My assets">
            <Table head={["Asset", "Serial", "Issued", "Status", ""]}>
              {mine.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <div className="font-medium text-gray-900">{m.assets?.name}</div>
                    <div className="font-mono text-xs text-gray-500">{m.assets?.asset_tag}</div>
                  </Td>
                  <Td className="text-xs">{m.assets?.serial_number ?? "—"}</Td>
                  <Td>{fmtDate(m.issued_on)}</Td>
                  <Td>{m.returned_on ? <Badge>Returned {fmtDate(m.returned_on)}</Badge> : m.acknowledged_at ? <Badge tone="green">Acknowledged</Badge> : <Badge tone="amber">Please acknowledge</Badge>}</Td>
                  <Td>
                    {!m.returned_on && !m.acknowledged_at && (
                      <form action={acknowledgeAsset.bind(null, m.id)}>
                        <button className={buttonClass("primary", "sm")}>I received it</button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
      {register && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            <Stat label="Assets" value={list.length} hint={`PKR ${money(list.reduce((s, a) => s + Number(a.purchase_cost ?? 0), 0))} at cost`} />
            <Stat label="Issued" value={list.filter((a) => a.status === "assigned").length} hint={`${(open ?? []).filter((o) => !o.acknowledged_at).length} not yet acknowledged`} />
            <Stat label="Available" value={list.filter((a) => a.status === "available").length} />
            <Stat label="In maintenance" value={list.filter((a) => a.status === "maintenance").length} />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Asset register" className="lg:col-span-2">
              <Table head={["Asset", "Category", "Location", "Holder", "Status", ""]} empty="No assets registered.">
                {list.map((a) => {
                  const h = holder.get(a.id);
                  return (
                    <tr key={a.id}>
                      <Td>
                        <div className="font-medium text-gray-900">{a.name}</div>
                        <div className="font-mono text-xs text-gray-500">
                          {a.asset_tag}
                          {a.serial_number ? ` · ${a.serial_number}` : ""}
                        </div>
                      </Td>
                      <Td>{titleCase(a.category)}</Td>
                      <Td className="text-xs">{a.locations?.name ?? "—"}</Td>
                      <Td className="text-xs">
                        {h ? (
                          <>
                            {(h.employees as unknown as { full_name: string } | null)?.full_name}
                            <div className="text-gray-500">since {fmtDate(h.issued_on)}{h.acknowledged_at ? "" : " · unacknowledged"}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        <Badge tone={TONE[a.status as keyof typeof TONE]}>{titleCase(a.status)}</Badge>
                        <div className="text-xs text-gray-500">{a.condition}</div>
                      </Td>
                      <Td>
                        {session.isHR && (
                          <div className="flex flex-col gap-1">
                            {a.status === "available" && <IssueForm assetId={a.id} people={peopleOpts} />}
                            {a.status === "assigned" && (
                              <>
                                <ReturnForm assetId={a.id} />
                                <IssueForm assetId={a.id} people={peopleOpts} transfer />
                              </>
                            )}
                            {a.status === "maintenance" && (
                              <div className="flex gap-1">
                                <form action={setAssetStatus.bind(null, a.id, "available")}>
                                  <button className={buttonClass("secondary", "sm")}>Repaired</button>
                                </form>
                                <form action={setAssetStatus.bind(null, a.id, "retired")}>
                                  <button className={buttonClass("danger", "sm")}>Retire</button>
                                </form>
                              </div>
                            )}
                          </div>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
            {session.isHR && (
              <Card title="Add asset">
                <AssetForm locations={(locs ?? []).map((l) => ({ id: l.id, label: l.name }))} />
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}

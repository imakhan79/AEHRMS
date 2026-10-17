import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { titleCase } from "@/lib/format";
import type { Department, Location, Position } from "@/lib/types";
import { CostCenterForm, DepartmentForm, GeofenceForm, LocationForm, PositionForm } from "./forms";

export const metadata: Metadata = { title: "Organization" };

type Dept = Department & { cost_centers: { code: string } | null; head: { full_name: string } | null };

/** Organogram (ORG-04): departments → sections → teams, as an indented tree. */
function Tree({ depts, parent, depth, headcount }: { depts: Dept[]; parent: string | null; depth: number; headcount: Map<string, number> }) {
  const children = depts.filter((d) => d.parent_id === parent);
  if (!children.length) return null;
  return (
    <ul className={depth ? "ml-5 border-l border-gray-200 pl-4" : ""}>
      {children.map((d) => (
        <li key={d.id} className="py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900">{d.name}</span>
            <span className="font-mono text-xs text-gray-400">{d.code}</span>
            {d.unit_type !== "department" && <Badge>{titleCase(d.unit_type)}</Badge>}
            <span className="text-xs text-gray-500">
              · {headcount.get(d.id) ?? 0} staff{d.head ? ` · Head: ${d.head.full_name}` : ""}
            </span>
          </div>
          <Tree depts={depts} parent={d.id} depth={depth + 1} headcount={headcount} />
        </li>
      ))}
    </ul>
  );
}

export default async function OrganizationPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [orgs, depts, positions, locations, costCenters, staff] = await Promise.all([
    supabase.from("organizations").select("name").eq("org_type", "company"),
    supabase
      .from("departments")
      .select("*, cost_centers(code), head:employees!departments_head_employee_fk(full_name)")
      .order("name"),
    supabase.from("positions").select("*, departments(name)").order("title"),
    supabase.from("locations").select("*").order("name"),
    supabase.from("cost_centers").select("id, code, name").order("code"),
    supabase.from("employees").select("department_id").is("deleted_at", null).neq("status", "exited"),
  ]);

  const deptList = (depts.data ?? []) as Dept[];
  const headcount = new Map<string, number>();
  for (const e of staff.data ?? []) {
    if (e.department_id) headcount.set(e.department_id, (headcount.get(e.department_id) ?? 0) + 1);
  }
  const deptOptions = deptList.map((d) => ({ id: d.id, label: `${d.name} (${d.code})` }));
  const ccOptions = (costCenters.data ?? []).map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }));

  return (
    <>
      <PageHeader
        title="Organization"
        description={`${orgs.data?.[0]?.name ?? "Company"} — structure, positions and locations`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Organogram" description="Departments, sections and teams. Staff counts exclude exited employees you can see.">
            {deptList.length ? (
              <Tree depts={deptList} parent={null} depth={0} headcount={headcount} />
            ) : (
              <p className="text-sm text-gray-500">No departments yet.</p>
            )}
          </Card>

          <Card title="Positions">
            <Table head={["Code", "Title", "Grade", "Department"]} empty="No positions defined yet.">
              {((positions.data ?? []) as (Position & { departments: { name: string } | null })[]).map((p) => (
                <tr key={p.id}>
                  <Td className="font-mono text-xs">{p.code}</Td>
                  <Td className="font-medium text-gray-900">{p.title}</Td>
                  <Td>{p.grade ?? "—"}</Td>
                  <Td>{p.departments?.name ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Locations">
            <Table head={["Code", "Name", "City", "Coordinates", "Geofence"]}>
              {((locations.data ?? []) as Location[]).map((l) => (
                <tr key={l.id}>
                  <Td className="font-mono text-xs">{l.code}</Td>
                  <Td className="font-medium text-gray-900">{l.name}</Td>
                  <Td>{l.city ?? "—"}</Td>
                  <Td>{l.latitude != null ? `${l.latitude}, ${l.longitude}` : <span className="text-amber-700">Not set</span>}</Td>
                  <Td>{l.geofence_radius_m} m</Td>
                </tr>
              ))}
            </Table>
          </Card>

          {session.isHR && (
            <Card
              title="Attendance geofences"
              description="Check-ins within the radius of an office are verified automatically. Stand at the office and use your current location for accuracy."
            >
              <div className="space-y-5 divide-y divide-gray-100">
                {((locations.data ?? []) as Location[]).map((l) => (
                  <div key={l.id} className="pt-5 first:pt-0">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900">{l.name}</div>
                      {l.latitude != null ? <Badge tone="green">Geofence on</Badge> : <Badge tone="amber">Not set</Badge>}
                    </div>
                    <GeofenceForm id={l.id} latitude={l.latitude} longitude={l.longitude} radius={l.geofence_radius_m} />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {session.isHR ? (
            <>
              <Card title="Add unit">
                <DepartmentForm departments={deptOptions} costCenters={ccOptions} />
              </Card>
              <Card title="Add position">
                <PositionForm departments={deptOptions} />
              </Card>
              <Card title="Add location">
                <LocationForm />
              </Card>
              <Card title="Cost centers">
                <ul className="mb-4 space-y-1 text-sm">
                  {(costCenters.data ?? []).map((c) => (
                    <li key={c.id}>
                      <span className="font-mono text-xs text-gray-500">{c.code}</span> {c.name}
                    </li>
                  ))}
                  {!costCenters.data?.length && <li className="text-gray-500">None yet.</li>}
                </ul>
                <CostCenterForm />
              </Card>
            </>
          ) : (
            <Card title="About">
              <p className="text-sm text-gray-600">The organization structure is maintained by HR.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

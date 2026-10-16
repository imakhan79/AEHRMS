import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasAnyRole, requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Input, PageHeader, Table, Td } from "@/components/ui";
import { buttonClass } from "@/components/ui";
import { fmtDateTime, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

const IGNORED = new Set(["updated_at", "created_at"]);

/** Fields whose value changed between old and new rows. */
function diff(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null): string {
  if (!oldData || !newData) return "";
  return Object.keys(newData)
    .filter((k) => !IGNORED.has(k) && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]))
    .join(", ");
}

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const session = await requireSession();
  if (!hasAnyRole(session, ["system_admin", "auditor"])) redirect("/dashboard");
  const sp = await searchParams;
  const table = typeof sp.table === "string" ? sp.table.replace(/[^a-z_]/g, "") : "";

  const supabase = await createClient();
  let query = supabase
    .from("audit_logs")
    .select("id, table_name, record_id, action, old_data, new_data, changed_by, changed_at")
    .order("changed_at", { ascending: false })
    .limit(200);
  if (table) query = query.eq("table_name", table);
  const [{ data: logs }, { data: people }] = await Promise.all([
    query,
    supabase.from("employees").select("user_id, full_name").not("user_id", "is", null),
  ]);
  const who = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));

  return (
    <>
      <PageHeader title="Audit log" description="Every insert, update and delete on HR data. Entries cannot be edited or deleted." />
      <Card>
        <form className="-mt-1 mb-5 flex gap-2">
          <Input name="table" defaultValue={table} placeholder="Filter by table, e.g. employees" className="max-w-xs" />
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
        <div className="pt-5">
          <Table head={["When", "Who", "Table", "Action", "Changed fields"]} empty="No audit entries.">
            {(logs ?? []).map((l) => (
              <tr key={l.id}>
                <Td>{fmtDateTime(l.changed_at)}</Td>
                <Td>{l.changed_by ? (who.get(l.changed_by) ?? `${String(l.changed_by).slice(0, 8)}…`) : "System"}</Td>
                <Td className="font-mono text-xs">{l.table_name}</Td>
                <Td>
                  <Badge tone={l.action === "DELETE" ? "red" : l.action === "INSERT" ? "green" : "blue"}>{titleCase(l.action.toLowerCase())}</Badge>
                </Td>
                <Td className="max-w-md truncate text-xs text-gray-500">{diff(l.old_data, l.new_data) || "—"}</Td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
    </>
  );
}

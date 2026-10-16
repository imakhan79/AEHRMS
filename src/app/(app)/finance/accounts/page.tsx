import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { AccountForm } from "../forms";
import { toggleAccount } from "../actions";
import { requireFinanceReader } from "../shared";

export const metadata: Metadata = { title: "Chart of accounts" };

export default async function AccountsPage() {
  const session = await requireFinanceReader();
  const supabase = await createClient();
  const { data } = await supabase.from("chart_of_accounts").select("*").order("code");
  const rows = data ?? [];
  const byId = new Map(rows.map((a) => [a.id, a]));

  return (
    <>
      <PageHeader title="Chart of accounts" description="Hierarchical COA (FIN-01). Group accounts can't be posted to." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Table head={["Code", "Account", "Type", "Group", "Cash flow", ""]}>
            {rows.map((a) => (
              <tr key={a.id} className={a.is_postable ? "" : "bg-gray-50 font-semibold"}>
                <Td className="font-mono text-xs">{a.code}</Td>
                <Td className={a.parent_id ? "pl-8" : ""}>
                  {a.name} {!a.is_active && <Badge>inactive</Badge>}
                </Td>
                <Td>{titleCase(a.account_type)}</Td>
                <Td className="text-xs">{a.parent_id ? byId.get(a.parent_id)?.name : "—"}</Td>
                <Td className="text-xs">{a.is_postable ? titleCase(a.cash_flow_category) : ""}</Td>
                <Td>
                  {session.isFinance && a.is_postable && (
                    <form action={toggleAccount.bind(null, a.id, !a.is_active)}>
                      <button className="text-xs text-gray-500 hover:text-indigo-700">{a.is_active ? "Deactivate" : "Activate"}</button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        {session.isFinance && (
          <Card title="Add account">
            <AccountForm parents={rows.filter((a) => !a.is_postable).map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }))} />
          </Card>
        )}
      </div>
    </>
  );
}

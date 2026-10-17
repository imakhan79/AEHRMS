import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, DescList, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { SettingsForm, type Settings } from "../forms";

export const metadata: Metadata = { title: "System settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  if (!session.isAdmin) redirect("/dashboard");
  const supabase = await createClient();
  const [{ data: s }, { data: periods }] = await Promise.all([
    supabase.from("system_settings").select("*").single(),
    supabase.from("fiscal_periods").select("period_start, fiscal_year, status").order("period_start"),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const current = (periods ?? []).filter((p) => p.period_start <= today).at(-1);
  const years = [...new Set((periods ?? []).map((p) => p.fiscal_year as number))];
  const closed = (periods ?? []).filter((p) => p.status === "closed").length;

  return (
    <>
      <PageHeader title="System settings" description="Company information and the fiscal calendar (ADM-06)." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Company information" description={s?.updated_at ? `Last changed ${fmtDateTime(s.updated_at)}` : undefined}>
            {s && <SettingsForm values={s as Settings} />}
          </Card>
        </div>
        <Card title="Fiscal year">
          <DescList
            items={[
              ["Fiscal year", "July – June (Pakistan tax year)"],
              ["Current year", current ? `FY${current.fiscal_year} (Jul ${current.fiscal_year - 1} – Jun ${current.fiscal_year})` : "Not opened"],
              ["Years opened", years.map((y) => `FY${y}`).join(", ")],
              ["Closed months", <Badge key="c">{closed}</Badge>],
            ]}
          />
          <p className="mt-4 text-xs text-gray-500">
            The tax slabs and statutory rates use this calendar, so it can&apos;t be changed. Open the next year and close months under{" "}
            <Link href="/finance/settings" className="font-medium text-indigo-700 hover:underline">
              Periods &amp; taxes
            </Link>
            .
          </p>
        </Card>
      </div>
    </>
  );
}

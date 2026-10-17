import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Notice, PageHeader, Stat, Table, Td, buttonClass, cn } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { Stagger, StaggerItem } from "@/components/motion";
import { VIEWS, canReceiveDigest, defaultView, loadView, type Cell } from "@/lib/analytics";
import { TrendChart } from "./trend-chart";
import { SubscriptionForm } from "./subscription-form";

export const metadata: Metadata = { title: "Analytics" };

function CellView({ c }: { c: Cell }) {
  if (c !== null && typeof c === "object") {
    return (
      <Link href={c.href} className="font-medium text-indigo-700 hover:underline">
        {c.text}
      </Link>
    );
  }
  if (typeof c === "number") return <>{c.toLocaleString("en-PK", { maximumFractionDigits: Math.abs(c) >= 1000 ? 0 : 1 })}</>;
  return <>{c ?? "—"}</>;
}

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const session = await requireSession();
  const sp = await searchParams;
  const allowed = VIEWS.filter((v) => v.can(session));
  const fallback = defaultView(session);
  const view = allowed.find((v) => v.key === sp.view) ?? allowed.find((v) => v.key === fallback);

  if (!view) {
    return (
      <>
        <PageHeader title="Analytics" />
        <Notice>
          Analytics are for managers, HR, Finance and leadership. Your own attendance, leave and pay are on your{" "}
          <Link href="/dashboard" className="font-medium underline">
            dashboard
          </Link>
          .
        </Notice>
      </>
    );
  }

  const supabase = await createClient();
  const [data, { data: sub }] = await Promise.all([
    loadView(view.key, session),
    supabase.from("report_subscriptions").select("frequency").eq("report", view.key).maybeSingle(),
  ]);
  const canSubscribe = canReceiveDigest(session, view.key);
  const exportHref = (block?: string) => `/analytics/export?view=${view.key}${block ? `&block=${block}` : ""}`;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={data.scope}
        actions={
          <div className="flex gap-2 print:hidden">
            <a href={exportHref()} className={buttonClass("secondary")} download>
              Export to Excel (CSV)
            </a>
            <PrintButton />
          </div>
        }
      />

      <nav aria-label="Analytics views" className="mb-6 flex flex-wrap gap-1 print:hidden">
        {allowed.map((v) => (
          <Link
            key={v.key}
            href={`/analytics?view=${v.key}`}
            aria-current={v.key === view.key ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              v.key === view.key ? "bg-indigo-600 text-white" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {data.kpis.length > 0 && (
        <Stagger key={view.key} className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.kpis.map((k) => (
            <StaggerItem key={k.label}>
              {k.href ? (
                <Link href={k.href} className="block h-full">
                  <Stat label={k.label} value={k.value} hint={k.hint} />
                </Link>
              ) : (
                <Stat label={k.label} value={k.value} hint={k.hint} />
              )}
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        {data.trend && (
          <Card className="lg:col-span-2">
            <TrendChart trend={data.trend} />
          </Card>
        )}
        <Card title="Scheduled report" className={cn("print:hidden", !data.trend && "lg:col-span-3")}>
          {canSubscribe ? (
            <>
              <SubscriptionForm report={view.key} frequency={sub?.frequency ?? null} />
              <p className="mt-3 text-xs text-gray-500">A company-wide summary of this view arrives in your notifications at 8:00 am.</p>
            </>
          ) : (
            <p className="text-xs text-gray-500">Scheduled summaries cover the whole company and go to HR, Finance and leadership. Bookmark this page for your team&apos;s numbers.</p>
          )}
        </Card>
      </div>

      <Stagger key={`${view.key}-blocks`} className="grid gap-6 lg:grid-cols-2">
        {data.blocks.map((b) => (
          <StaggerItem key={b.key} className={b.head.length > 5 ? "min-w-0 lg:col-span-2" : "min-w-0"}>
          <Card
            title={b.title}
            description={b.description}
            actions={
              <a href={exportHref(b.key)} className="text-xs font-medium text-indigo-600 hover:text-indigo-500 print:hidden" download>
                CSV
              </a>
            }
          >
            <Table head={b.head} empty="No data for this period.">
              {b.rows.map((r, i) => (
                <tr key={i} className={b.totalRow && i === b.rows.length - 1 ? "bg-gray-50/60 font-semibold" : undefined}>
                  {r.map((c, j) => (
                    <Td key={j} className={cn(j > 0 && typeof c !== "object" && "tabular-nums", j === 0 && "text-gray-900")}>
                      <CellView c={c} />
                    </Td>
                  ))}
                </tr>
              ))}
            </Table>
          </Card>
          </StaggerItem>
        ))}
      </Stagger>
      <p className="mt-4 text-xs text-gray-500 print:hidden">For: {view.audience}. Figures respect your access, so managers see only their team. Click a highlighted name or tile to see the records behind it.</p>
    </>
  );
}

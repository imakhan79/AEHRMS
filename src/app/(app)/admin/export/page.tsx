import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { Card, Notice, PageHeader } from "@/components/ui";
import { Stagger, StaggerItem } from "@/components/motion";
import { DATASETS } from "./datasets";

export const metadata: Metadata = { title: "Data export & backup" };

export default async function ExportPage() {
  const session = await requireSession();
  if (!session.isAdmin) redirect("/dashboard");
  const groups = [...new Set(DATASETS.map((d) => d.group))];

  return (
    <>
      <PageHeader title="Data export & backup" description="Download any table as CSV, which opens in Excel (ADM-07). Every download is a full export of that table." />
      <div className="mb-6">
        <Notice tone="blue">
          <strong>Backups:</strong> Supabase backs up the database daily, and point-in-time recovery restores to any second within the retention window
          (BRD 8.1, 20.4). These CSV files are for offline copies, audits and migration checks. They don&apos;t replace those backups. CNIC and bank details
          aren&apos;t included. Export them from the employee record if you need them.
        </Notice>
      </div>
      <Stagger className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <StaggerItem key={g}>
          <Card title={g}>
            <ul className="-my-2 divide-y divide-gray-100">
              {DATASETS.filter((d) => d.group === g).map((d) => (
                <li key={d.key} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-gray-800">{d.label}</span>
                  <a href={`/admin/export/download?t=${d.key}`} className="text-xs font-medium text-indigo-700 hover:underline" download>
                    Download CSV
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </>
  );
}

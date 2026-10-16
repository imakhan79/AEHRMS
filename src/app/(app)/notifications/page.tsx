import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, buttonClass, cn } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { markAllRead } from "../workflow-actions";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireSession();
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
  const unread = (data ?? []).filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={`${unread} unread`}
        actions={
          unread > 0 && (
            <form action={markAllRead}>
              <button className={buttonClass("secondary")}>Mark all read</button>
            </form>
          )
        }
      />
      <Card>
        <ul className="-my-2 divide-y divide-gray-100">
          {(data ?? []).map((n) => (
            <li key={n.id} className={cn("flex items-start justify-between gap-4 py-3", !n.read_at && "font-medium")}>
              <div>
                {n.link ? (
                  <Link href={n.link} className="text-gray-900 hover:text-indigo-700">
                    {!n.read_at && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-indigo-600" />}
                    {n.title}
                  </Link>
                ) : (
                  <span className="text-gray-900">{n.title}</span>
                )}
                {n.body && <div className="text-sm font-normal text-gray-500">{n.body}</div>}
              </div>
              <span className="whitespace-nowrap text-xs font-normal text-gray-400">{fmtDateTime(n.created_at)}</span>
            </li>
          ))}
          {!data?.length && <li className="py-6 text-center text-sm text-gray-500">You&apos;re all caught up.</li>}
        </ul>
      </Card>
    </>
  );
}

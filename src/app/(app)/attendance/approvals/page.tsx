import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAttendanceQueue } from "@/lib/attendance";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtTime, titleCase } from "@/lib/format";
import { DecideRegularization, VerifyPunch } from "../forms";

export const metadata: Metadata = { title: "Attendance approvals" };

export default async function AttendanceApprovalsPage() {
  const session = await requireSession();
  const { punches, regularizations } = await getAttendanceQueue(session);

  // Short-lived links to selfies (private bucket; storage RLS limits to team/HR).
  const supabase = await createClient();
  const paths = punches.map((p) => p.selfie_path).filter((p): p is string => !!p);
  const { data: signed } = paths.length
    ? await supabase.storage.from("attendance-selfies").createSignedUrls(paths, 600)
    : { data: [] };
  const selfie = new Map<string, string>();
  for (const s of signed ?? []) if (s.path && s.signedUrl) selfie.set(s.path, s.signedUrl);

  return (
    <>
      <PageHeader title="Attendance approvals" description="Verify field attendance and decide correction requests from your team." />
      <div className="space-y-6">
        <Card title={`Field attendance to verify (${punches.length})`} description="Punches outside the office geofence, without GPS, or captured offline.">
          <Table head={["Employee", "When", "Type", "Where", "Selfie", ""]} empty="Nothing to verify.">
            {punches.map((p) => (
              <tr key={p.id}>
                <Td>
                  <div className="font-medium text-gray-900">{p.employees?.full_name}</div>
                  <div className="text-xs text-gray-500">{p.employees?.employee_code}</div>
                </Td>
                <Td>
                  {fmtDateTime(p.punch_time)}
                  {p.captured_offline && <div className="text-xs text-amber-700">captured offline</div>}
                </Td>
                <Td>{p.punch_type === "in" ? "Check in" : "Check out"}</Td>
                <Td className="text-xs">
                  {p.distance_m != null ? (
                    <>
                      {Math.round(Number(p.distance_m)).toLocaleString()} m from office
                      {p.accuracy_m != null && <span className="text-gray-500"> (±{Math.round(Number(p.accuracy_m))} m)</span>}
                    </>
                  ) : (
                    <span className="text-amber-700">No GPS</span>
                  )}
                </Td>
                <Td>
                  {p.selfie_path && selfie.get(p.selfie_path) ? (
                    <a href={selfie.get(p.selfie_path)} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                      <img src={selfie.get(p.selfie_path)} alt="Selfie" className="h-12 w-12 rounded-lg object-cover ring-1 ring-gray-200" />
                    </a>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </Td>
                <Td>
                  <VerifyPunch id={p.id} />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title={`Correction requests (${regularizations.length})`}>
          <Table head={["Employee", "Date", "Requested", "Reason", "Stage", ""]} empty="No pending corrections.">
            {regularizations.map((r) => (
              <tr key={r.id}>
                <Td>
                  <div className="font-medium text-gray-900">{r.employees?.full_name}</div>
                  <div className="text-xs text-gray-500">{r.employees?.employee_code}</div>
                </Td>
                <Td>{fmtDate(r.work_date)}</Td>
                <Td>
                  {fmtTime(r.requested_in)}–{fmtTime(r.requested_out)}
                </Td>
                <Td className="max-w-56 truncate whitespace-normal">{r.reason}</Td>
                <Td>
                  <Badge tone="amber">{titleCase(r.stage)}</Badge>
                </Td>
                <Td>
                  <DecideRegularization id={r.id} />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

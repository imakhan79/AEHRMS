import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import { ReviewDocument } from "../section-forms";

export const metadata: Metadata = { title: "Documents to verify" };

type PendingDoc = {
  id: string;
  employee_id: string;
  doc_type: string;
  title: string;
  file_path: string;
  file_name: string;
  expiry_date: string | null;
  created_at: string;
  employees: { full_name: string; employee_code: string } | null;
};

export default async function DocumentReviewPage() {
  const session = await requireSession();
  if (!session.isHR) redirect("/dashboard");
  const supabase = await createClient();

  // HR can't review their own uploads (the DB refuses), so leave those for another HR user.
  let query = supabase
    .from("employee_documents")
    .select("id, employee_id, doc_type, title, file_path, file_name, expiry_date, created_at, employees!employee_documents_employee_id_fkey(full_name, employee_code)")
    .eq("status", "pending")
    .order("created_at");
  if (session.employee) query = query.neq("employee_id", session.employee.id);
  const { data } = await query;
  const docs = (data ?? []) as unknown as PendingDoc[];

  const paths = docs.map((d) => d.file_path);
  const { data: signed } = paths.length
    ? await supabase.storage.from("employee-documents").createSignedUrls(paths, 600)
    : { data: [] };
  const urlFor = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return (
    <>
      <PageHeader title="Documents to verify" description="Files employees uploaded to their own personnel file. Open each one, then verify or reject it." />
      <Card title={`Awaiting review (${docs.length})`}>
        <Table head={["Employee", "Type", "Title", "File", "Expiry", "Uploaded", ""]} empty="Nothing to verify.">
          {docs.map((d) => (
            <tr key={d.id}>
              <Td>
                <Link href={`/employees/${d.employee_id}`} className="font-medium text-gray-900 hover:text-indigo-600">
                  {d.employees?.full_name}
                </Link>
                <div className="text-xs text-gray-500">{d.employees?.employee_code}</div>
              </Td>
              <Td>{titleCase(d.doc_type)}</Td>
              <Td className="font-medium text-gray-900">{d.title}</Td>
              <Td>
                {urlFor.get(d.file_path) ? (
                  <a href={urlFor.get(d.file_path)!} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                    {d.file_name}
                  </a>
                ) : (
                  d.file_name
                )}
              </Td>
              <Td>{fmtDate(d.expiry_date)}</Td>
              <Td>{fmtDateTime(d.created_at)}</Td>
              <Td>
                <ReviewDocument id={d.id} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

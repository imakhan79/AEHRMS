import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui";
import { Badge, Table, Td, statusTone } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { deleteDocument, deleteEmergencyContact } from "./actions";
import { ReviewDocument } from "./section-forms";

/** Personnel file list with short-lived signed download links (private bucket). */
export async function DocumentsTable({ employeeId, canDelete, canReview = false }: { employeeId: string; canDelete: boolean; canReview?: boolean }) {
  const supabase = await createClient();
  const [{ data: docs }, { data: owner }] = await Promise.all([
    supabase
      .from("employee_documents")
      .select("id, doc_type, title, file_path, file_name, size_bytes, expiry_date, created_at, uploaded_by, status, review_note")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false }),
    supabase.from("employees").select("user_id").eq("id", employeeId).maybeSingle(),
  ]);

  const paths = (docs ?? []).map((d) => d.file_path);
  const { data: signed } = paths.length
    ? await supabase.storage.from("employee-documents").createSignedUrls(paths, 300)
    : { data: [] };
  const urlFor = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Table head={["Type", "Title", "File", "Expiry", "Uploaded", "Status", ""]} empty="No documents uploaded.">
      {(docs ?? []).map((d) => (
        <tr key={d.id}>
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
          <Td className={d.expiry_date && d.expiry_date < today ? "font-medium text-red-600" : ""}>{fmtDate(d.expiry_date)}</Td>
          <Td>
            {fmtDate(d.created_at)}
            <div className="text-xs text-gray-500">{d.uploaded_by && d.uploaded_by === owner?.user_id ? "by employee" : "by HR"}</div>
          </Td>
          <Td>
            <Badge tone={statusTone(d.status)}>{d.status === "pending" ? "Awaiting HR" : titleCase(d.status)}</Badge>
            {d.review_note && <div className="mt-1 max-w-48 whitespace-normal text-xs text-gray-500">{d.review_note}</div>}
          </Td>
          <Td>
            <div className="flex flex-wrap items-center gap-2">
              {canReview && d.status === "pending" && <ReviewDocument id={d.id} />}
              {canDelete && (
                <form action={deleteDocument.bind(null, d.id)}>
                  <button className={buttonClass("danger", "sm")}>Delete</button>
                </form>
              )}
            </div>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

export async function EmergencyTable({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("employee_emergency_contacts")
    .select("id, name, relationship, phone")
    .eq("employee_id", employeeId)
    .order("created_at");
  return (
    <Table head={["Name", "Relationship", "Phone", ""]} empty="No emergency contacts.">
      {(data ?? []).map((c) => (
        <tr key={c.id}>
          <Td className="font-medium text-gray-900">{c.name}</Td>
          <Td>{c.relationship}</Td>
          <Td>{c.phone}</Td>
          <Td>
            {canEdit && (
              <form action={deleteEmergencyContact.bind(null, c.id)}>
                <button className={buttonClass("danger", "sm")}>Remove</button>
              </form>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

/** Masks all but the last characters, for display to non-privileged viewers (12.3 Layer 4). */
export function mask(value: string | null | undefined, visible = 4): string {
  if (!value) return "—";
  return value.length <= visible ? value : `${"•".repeat(Math.min(value.length - visible, 12))}${value.slice(-visible)}`;
}

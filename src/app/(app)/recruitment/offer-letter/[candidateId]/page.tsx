import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, titleCase } from "@/lib/format";
import { money } from "@/lib/payroll";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Offer letter" };

/** REC-05: offer letter generated from the offer + requisition. Print / Save as PDF. */
export default async function OfferLetterPage({ params }: PageProps<"/recruitment/offer-letter/[candidateId]">) {
  const { candidateId } = await params;
  if (!z.uuid().safeParse(candidateId).success) notFound();
  await requireSession();
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("candidates")
    .select("full_name, email, requisitions(title, employment_type, departments(name), locations(name), positions(title))")
    .eq("id", candidateId)
    .maybeSingle();
  const { data: o } = await supabase.from("offers").select("*").eq("candidate_id", candidateId).maybeSingle();
  if (!c || !o) notFound();
  const r = c.requisitions as unknown as { title: string; employment_type: string; departments: { name: string } | null; locations: { name: string } | null; positions: { title: string } | null };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <article className="space-y-4 rounded-xl border border-gray-200 bg-white p-10 text-[15px] leading-relaxed text-gray-800 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-start justify-between border-b border-gray-200 pb-4">
          <div>
            <div className="text-lg font-bold text-gray-900">AE Global Group of Companies</div>
            <div className="text-sm text-gray-500">Human Resources</div>
          </div>
          <div className="text-right text-sm text-gray-500">Date: {fmtDate(o.offer_date)}</div>
        </div>
        <p>
          Dear <strong>{c.full_name}</strong>,
        </p>
        <p className="font-semibold">Subject: Offer of employment — {r.positions?.title ?? r.title}</p>
        <p>
          We are pleased to offer you the position of <strong>{r.positions?.title ?? r.title}</strong> in our {r.departments?.name ?? ""} department
          {r.locations?.name ? `, based at ${r.locations.name}` : ""}, on a {titleCase(r.employment_type).toLowerCase()} basis.
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Monthly gross salary: <strong>PKR {money(o.offered_salary)}</strong>, inclusive of allowances as per company policy.
          </li>
          <li>
            Joining date: <strong>{fmtDate(o.joining_date)}</strong>.
          </li>
          {o.probation_months > 0 && <li>Probation period: {o.probation_months} months, after which your employment will be reviewed for confirmation.</li>}
          <li>Statutory deductions (income tax, EOBI) and benefits apply as per law and company policy.</li>
        </ul>
        {o.notes && <p>{o.notes}</p>}
        <p>
          This offer is valid until <strong>{fmtDate(o.expiry_date)}</strong>. Please sign and return a copy to confirm your acceptance.
        </p>
        <p>We look forward to welcoming you to the team.</p>
        <div className="grid grid-cols-2 gap-10 pt-10 text-sm">
          <div className="border-t border-gray-300 pt-2">For AE Global Group — Human Resources</div>
          <div className="border-t border-gray-300 pt-2">Accepted by {c.full_name} · Date</div>
        </div>
      </article>
    </div>
  );
}

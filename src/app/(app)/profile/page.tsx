import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, DescList, Notice, PageHeader } from "@/components/ui";
import { fmtDate, titleCase } from "@/lib/format";
import { EmergencyForm, UploadForm } from "../employees/section-forms";
import { DocumentsTable, EmergencyTable, mask } from "../employees/shared";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const session = await requireSession();
  if (!session.employee) {
    return (
      <>
        <PageHeader title="My profile" />
        <Notice>Your account isn&apos;t linked to an employee record yet. Ask HR to add you using your work email.</Notice>
      </>
    );
  }
  const id = session.employee.id;
  const supabase = await createClient();
  const [{ data: e }, { data: p }] = await Promise.all([
    supabase
      .from("employees")
      .select("*, department:departments!employees_department_id_fkey(name), positions(title, grade), locations(name), manager:manager_id(full_name)")
      .eq("id", id)
      .single(),
    supabase.from("employee_private").select("*").eq("employee_id", id).maybeSingle(),
  ]);

  return (
    <>
      <PageHeader title="My profile" description="Keep your contact details up to date. For other changes, contact HR." />
      <div className="space-y-6">
        <Card title="Employment">
          <DescList
            items={[
              ["Employee code", e.employee_code],
              ["Position", e.positions?.title],
              ["Department", e.department?.name],
              ["Line manager", e.manager?.full_name],
              ["Location", e.locations?.name],
              ["Status", titleCase(e.status)],
              ["Employment type", titleCase(e.employment_type)],
              ["Joined", fmtDate(e.joining_date)],
              ["Work email", e.work_email],
            ]}
          />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Contact details">
            <ContactForm values={e} />
          </Card>
          <Card title="CNIC, bank & statutory" description="Held by HR. Ask HR to correct anything wrong.">
            <DescList
              items={[
                ["CNIC", mask(p?.cnic, 5)],
                ["NTN", p?.ntn],
                ["EOBI no.", p?.eobi_number],
                ["PESSI no.", p?.pessi_number],
                ["Bank", p?.bank_name],
                ["IBAN", mask(p?.iban, 4)],
              ]}
            />
          </Card>
        </div>

        <Card title="Emergency contacts">
          <EmergencyTable employeeId={id} canEdit />
          <div className="mt-8 border-t border-gray-100 pt-4">
            <EmergencyForm employeeId={id} />
          </div>
        </Card>

        <Card title="My documents">
          <DocumentsTable employeeId={id} canDelete={false} />
          <div className="mt-8 border-t border-gray-100 pt-4">
            <UploadForm employeeId={id} />
          </div>
        </Card>
      </div>
    </>
  );
}

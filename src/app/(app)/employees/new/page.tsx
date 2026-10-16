import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import { loadEmployeeOptions } from "../options";

export const metadata: Metadata = { title: "New employee" };

export default async function NewEmployeePage() {
  const session = await requireSession();
  if (!session.isHR) redirect("/employees");
  const options = await loadEmployeeOptions();

  return (
    <>
      <PageHeader
        title="New employee"
        description="Create the record first; add CNIC, bank details, documents and leave on the next screen."
      />
      <Card>
        <EmployeeForm options={options} />
      </Card>
    </>
  );
}

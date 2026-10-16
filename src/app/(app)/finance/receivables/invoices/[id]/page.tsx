import type { Metadata } from "next";
import { DocumentPage } from "../../../shared";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/finance/receivables/invoices/[id]">) {
  return <DocumentPage kind="invoice" id={(await params).id} />;
}

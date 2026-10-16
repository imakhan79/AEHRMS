import type { Metadata } from "next";
import { DocumentPage } from "../../../shared";

export const metadata: Metadata = { title: "Bill" };

export default async function BillPage({ params }: PageProps<"/finance/payables/bills/[id]">) {
  return <DocumentPage kind="bill" id={(await params).id} />;
}

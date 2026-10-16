import type { Metadata } from "next";
import { PaymentPage } from "../../../shared";

export const metadata: Metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: PageProps<"/finance/receivables/receipts/[id]">) {
  return <PaymentPage kind="receipt" id={(await params).id} />;
}

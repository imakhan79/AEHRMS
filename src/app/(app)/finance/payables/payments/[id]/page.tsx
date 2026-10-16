import type { Metadata } from "next";
import { PaymentPage } from "../../../shared";

export const metadata: Metadata = { title: "Payment" };

export default async function VendorPaymentPage({ params }: PageProps<"/finance/payables/payments/[id]">) {
  return <PaymentPage kind="payment" id={(await params).id} />;
}

import type { Metadata } from "next";
import { PayPartyPage } from "../../../shared";

export const metadata: Metadata = { title: "Pay vendor" };

export default async function PayVendorPage({ params }: PageProps<"/finance/payables/pay/[vendorId]">) {
  return <PayPartyPage kind="payment" partyId={(await params).vendorId} />;
}

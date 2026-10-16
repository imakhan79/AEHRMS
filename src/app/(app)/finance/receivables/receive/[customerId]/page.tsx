import type { Metadata } from "next";
import { PayPartyPage } from "../../../shared";

export const metadata: Metadata = { title: "Receive payment" };

export default async function ReceivePage({ params }: PageProps<"/finance/receivables/receive/[customerId]">) {
  return <PayPartyPage kind="receipt" partyId={(await params).customerId} />;
}

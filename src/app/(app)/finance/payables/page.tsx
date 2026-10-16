import type { Metadata } from "next";
import { LedgerSidePage } from "../shared";

export const metadata: Metadata = { title: "Accounts payable" };

export default function PayablesPage() {
  return <LedgerSidePage kind="bill" />;
}

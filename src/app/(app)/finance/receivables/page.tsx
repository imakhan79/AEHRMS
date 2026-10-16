import type { Metadata } from "next";
import { LedgerSidePage } from "../shared";

export const metadata: Metadata = { title: "Accounts receivable" };

export default function ReceivablesPage() {
  return <LedgerSidePage kind="invoice" />;
}

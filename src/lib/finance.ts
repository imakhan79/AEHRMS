import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Option = { id: string; label: string };

/** Lookup lists shared by finance forms (RLS: finance readers). */
export async function financeOptions() {
  const supabase = await createClient();
  const [accounts, costCenters, taxes, banks] = await Promise.all([
    supabase.from("chart_of_accounts").select("id, code, name, account_type").eq("is_active", true).eq("is_postable", true).order("code"),
    supabase.from("cost_centers").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("taxes").select("id, code, name, tax_type, rate_pct").eq("is_active", true).order("code"),
    supabase.from("bank_accounts").select("id, name, gl_account_id").eq("is_active", true).order("name"),
  ]);
  const acc = accounts.data ?? [];
  return {
    accounts: acc.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}`, type: a.account_type as string })),
    costCenters: (costCenters.data ?? []).map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` })),
    taxes: (taxes.data ?? []).map((t) => ({ id: t.id, label: `${t.name} (${Number(t.rate_pct)}%)`, type: t.tax_type as string })),
    banks: (banks.data ?? []).map((b) => ({ id: b.id, label: b.name })),
  };
}

export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
}

export function outstanding(total: number | string, paid: number | string) {
  return Math.round((Number(total) - Number(paid)) * 100) / 100;
}

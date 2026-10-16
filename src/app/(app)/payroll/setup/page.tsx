import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Notice, PageHeader, Table, Td } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { money, taxYearLabel } from "@/lib/payroll";
import { ComponentForm, StatutoryForm, StructureForm, StructureLineForm, TaxSlabForm } from "../forms";

export const metadata: Metadata = { title: "Payroll setup" };

export default async function PayrollSetupPage() {
  const session = await requireSession();
  if (!session.canReadPayroll) redirect("/dashboard");
  const supabase = await createClient();
  const [components, structures, lines, rates, slabs, surcharges] = await Promise.all([
    supabase.from("salary_components").select("*").order("sort_order"),
    supabase.from("salary_structures").select("id, code, name").order("code"),
    supabase.from("salary_structure_components").select("structure_id, calc_type, value, salary_components(code, name)"),
    supabase.from("statutory_rates").select("*").order("effective_from", { ascending: false }),
    supabase.from("tax_slabs").select("*").order("tax_year", { ascending: false }).order("lower_limit"),
    supabase.from("tax_surcharges").select("*"),
  ]);
  const edit = session.isPayroll;
  const years = [...new Set((slabs.data ?? []).map((s) => s.tax_year as number))];
  const configurable = (components.data ?? []).filter((c) => !c.is_system);
  type L = { structure_id: string; calc_type: string; value: number; salary_components: { code: string; name: string } | null };

  return (
    <>
      <PageHeader title="Payroll setup" description="Salary components, structures, statutory rates and FBR tax slabs — all effective-dated, no code changes needed." />
      <div className="mb-6">
        <Notice>
          Rates were loaded from published Finance Act 2026 summaries and the last notified Punjab minimum wage (PKR 40,000). Have your tax
          advisor confirm them against the FBR gazette and the PESSI/EOBI notifications before the first live payroll.
        </Notice>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Salary structures" description="Allowances calculated from basic salary.">
          <div className="space-y-4">
            {(structures.data ?? []).map((s) => {
              const ls = ((lines.data ?? []) as unknown as L[]).filter((l) => l.structure_id === s.id);
              return (
                <div key={s.id}>
                  <div className="text-sm font-medium text-gray-900">
                    {s.name} <span className="font-mono text-xs text-gray-400">{s.code}</span>
                  </div>
                  <ul className="mt-1 flex flex-wrap gap-2 text-xs">
                    <li className="rounded bg-gray-100 px-2 py-0.5">Basic</li>
                    {ls.map((l) => (
                      <li key={l.salary_components?.code} className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-800">
                        {l.salary_components?.name}: {l.calc_type === "fixed" ? `PKR ${money(l.value)}` : `${Number(l.value)}% of basic`}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          {edit && (
            <div className="mt-6 space-y-4 border-t border-gray-100 pt-4">
              <StructureLineForm
                structures={(structures.data ?? []).map((s) => ({ id: s.id, label: s.code }))}
                components={configurable.map((c) => ({ id: c.id, label: c.name }))}
              />
              <StructureForm />
            </div>
          )}
        </Card>

        <Card title="Salary components">
          <Table head={["Code", "Name", "Type", "Tax"]}>
            {(components.data ?? []).map((c) => (
              <tr key={c.id}>
                <Td className="font-mono text-xs">{c.code}</Td>
                <Td>
                  {c.name} {c.is_system && <Badge>system</Badge>}
                </Td>
                <Td>{c.kind === "earning" ? "Earning" : "Deduction"}</Td>
                <Td>{c.kind === "earning" ? (c.is_taxable ? "Taxable" : "Exempt") : "—"}</Td>
              </tr>
            ))}
          </Table>
          {edit && (
            <div className="mt-8 border-t border-gray-100 pt-4">
              <ComponentForm />
            </div>
          )}
        </Card>

        <Card title="Statutory rates" description="EOBI and PESSI are calculated on the notified minimum wage, not actual salary.">
          <Table head={["From", "EOBI base", "EOBI EE / ER", "PESSI base / ER", "Overtime", "Notes"]}>
            {(rates.data ?? []).map((r) => (
              <tr key={r.id}>
                <Td>{fmtDate(r.effective_from)}</Td>
                <Td className="tabular-nums">{money(r.eobi_wage_base)}</Td>
                <Td>
                  {Number(r.eobi_employee_pct)}% / {Number(r.eobi_employer_pct)}%
                </Td>
                <Td>
                  {money(r.pessi_wage_base)} / {Number(r.pessi_employer_pct)}%
                </Td>
                <Td>
                  ×{Number(r.ot_multiplier)} on basic/{Number(r.ot_basis_hours)}h
                </Td>
                <Td className="max-w-40 truncate whitespace-normal text-xs">{r.notes ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          {edit && (
            <div className="mt-8 border-t border-gray-100 pt-4">
              <StatutoryForm />
            </div>
          )}
        </Card>

        <Card title="Income tax slabs (salaried)" description="Tax is projected over the tax year and spread over the remaining months.">
          <div className="space-y-6">
            {years.map((y) => {
              const sur = (surcharges.data ?? []).find((s) => s.tax_year === y);
              return (
                <div key={y}>
                  <div className="mb-2 text-sm font-medium text-gray-900">{taxYearLabel(y)}</div>
                  <Table head={["Annual income", "Tax"]}>
                    {(slabs.data ?? [])
                      .filter((s) => s.tax_year === y)
                      .map((s) => (
                        <tr key={s.id}>
                          <Td className="tabular-nums">
                            {money(s.lower_limit)} – {s.upper_limit ? money(s.upper_limit) : "above"}
                          </Td>
                          <Td>
                            {Number(s.rate_pct) === 0
                              ? "Nil"
                              : `${Number(s.fixed_tax) ? `${money(s.fixed_tax)} + ` : ""}${Number(s.rate_pct)}% above ${money(s.lower_limit)}`}
                          </Td>
                        </tr>
                      ))}
                  </Table>
                  {sur && (
                    <p className="mt-6 text-xs text-gray-500">
                      Surcharge: {Number(sur.surcharge_pct)}% of tax when income exceeds {money(sur.threshold)}.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {edit && (
            <div className="mt-8 border-t border-gray-100 pt-4">
              <TaxSlabForm defaultYear={(years[0] ?? new Date().getFullYear()) + 1} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

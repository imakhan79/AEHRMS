import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { REPORTS, runReport, type ReportKey } from "@/lib/finance-reports";

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function csv(head: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== "number" ? `'${s}` : s; // CSV formula injection
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (!session.canReadPayroll) return new NextResponse("Forbidden", { status: 403 });
  const sp = request.nextUrl.searchParams;
  const key = REPORTS.find((r) => r.key === sp.get("r"))?.key as ReportKey | undefined;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!key || !isDate(from) || !isDate(to)) return new NextResponse("Invalid report parameters", { status: 400 });
  try {
    const r = await runReport(key, { from, to, costCenter: sp.get("cc") ?? "", account: sp.get("account") ?? "", budget: sp.get("budget") ?? "" });
    return new NextResponse(csv(r.head, r.rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${key}-${from}-${to}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return new NextResponse((e as Error).message, { status: 400 });
  }
}

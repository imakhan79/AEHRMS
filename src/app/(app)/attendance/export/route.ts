import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// CSV opens directly in Excel (ATT-09, 9.2). RLS limits rows to what the caller may see.

function csv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    // Quote, and neutralise spreadsheet formulas (CSV injection).
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

const pkTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" }).format(new Date(iso)) : "";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  const sp = request.nextUrl.searchParams;
  const supabase = await createClient();

  if (sp.get("kind") === "summary") {
    const month = sp.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) return new NextResponse("Invalid month", { status: 400 });
    const { data, error } = await supabase.rpc("attendance_monthly_summary", { p_month: `${month}-01` });
    if (error) return new NextResponse(error.message, { status: 400 });
    const rows = [
      ["Code", "Name", "Department", "Present", "Late", "Half day", "Absent", "Leave", "Holiday", "Weekly off", "Missing punch", "Worked hours", "Late minutes", "Overtime hours"],
      ...(data ?? []).map((s: Record<string, number | string | null>) => [
        s.employee_code, s.full_name, s.department, s.present, s.late, s.half_day, s.absent, s.on_leave,
        s.holiday, s.weekly_off, s.missing_punch, (Number(s.worked_minutes) / 60).toFixed(2), s.late_minutes,
        (Number(s.overtime_minutes) / 60).toFixed(2),
      ]),
    ];
    return new NextResponse(csv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="attendance-summary-${month}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  }

  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return new NextResponse("Invalid date range", { status: 400 });
  }
  // Page through results: the API returns at most 1000 rows per request.
  const all: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("attendance")
      .select("work_date, status, first_in, last_out, worked_minutes, late_minutes, early_leave_minutes, overtime_minutes, is_regularized, employees!attendance_employee_id_fkey(employee_code, full_name)")
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date")
      .order("employee_id")
      .range(offset, offset + 999);
    if (error) return new NextResponse(error.message, { status: 400 });
    all.push(...(data ?? []));
    if (!data || data.length < 1000 || all.length >= 50000) break;
  }
  const rows = [
    ["Date", "Code", "Name", "Status", "In", "Out", "Worked minutes", "Late minutes", "Early leave minutes", "Overtime minutes", "Corrected"],
    ...all.map((r) => {
      const e = r.employees as { employee_code: string; full_name: string } | null;
      return [
        r.work_date as string, e?.employee_code, e?.full_name, r.status as string, pkTime(r.first_in as string | null),
        pkTime(r.last_out as string | null), r.worked_minutes as number, r.late_minutes as number,
        r.early_leave_minutes as number, r.overtime_minutes as number, r.is_regularized ? "yes" : "",
      ];
    }),
  ];
  return new NextResponse(csv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="attendance-${from}${to !== from ? `-to-${to}` : ""}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}

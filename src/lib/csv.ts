import "server-only";
import { NextResponse } from "next/server";

export type Cell = string | number | boolean | null | undefined;

/** Excel-friendly CSV: BOM, CRLF, every cell quoted, spreadsheet formulas neutralised (CSV injection). */
export function csv(head: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== "number" ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export function csvResponse(filename: string, body: string) {
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { csv, csvResponse, type Cell } from "@/lib/csv";
import { DATASETS } from "../datasets";

const PAGE = 1000; // PostgREST max_rows
const LIMIT = 100_000;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (!session.isAdmin) return new NextResponse("Forbidden", { status: 403 });
  const ds = DATASETS.find((d) => d.key === request.nextUrl.searchParams.get("t"));
  if (!ds) return new NextResponse("Unknown dataset", { status: 400 });

  const supabase = await createClient();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < LIMIT; from += PAGE) {
    const { data, error } = await supabase.from(ds.key).select("*").order("id").range(from, from + PAGE - 1);
    if (error) return new NextResponse(error.message, { status: 400 });
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  const head = rows.length ? Object.keys(rows[0]) : ["id"];
  const cell = (v: unknown): Cell => (v !== null && typeof v === "object" ? JSON.stringify(v) : (v as Cell));
  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`${ds.key}-${stamp}.csv`, csv(head, rows.map((r) => head.map((k) => cell(r[k])))));
}

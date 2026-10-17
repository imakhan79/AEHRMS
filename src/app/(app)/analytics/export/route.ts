import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { csv, csvResponse } from "@/lib/csv";
import { VIEWS, loadView, type Cell } from "@/lib/analytics";

const plain = (c: Cell) => (c !== null && typeof c === "object" ? c.text : c);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  const sp = request.nextUrl.searchParams;
  const view = VIEWS.find((v) => v.key === sp.get("view"));
  if (!view) return new NextResponse("Unknown view", { status: 400 });
  if (!view.can(session)) return new NextResponse("Forbidden", { status: 403 });

  const data = await loadView(view.key, session);
  const stamp = new Date().toISOString().slice(0, 10);
  const blockKey = sp.get("block");
  if (blockKey) {
    const b = data.blocks.find((x) => x.key === blockKey);
    if (!b) return new NextResponse("Unknown table", { status: 400 });
    return csvResponse(`${view.key}-${b.key}-${stamp}.csv`, csv(b.head.map((h, i) => h || (i === 0 ? b.title : "")), b.rows.map((r) => r.map(plain))));
  }
  // Whole view: KPIs, then each table under its own title row.
  const rows: (string | number | null)[][] = [[`${view.label} — ${data.scope}`], [], ["Measure", "Value", "Note"]];
  rows.push(...data.kpis.map((k) => [k.label, k.value, k.hint ?? ""]));
  for (const b of data.blocks) rows.push([], [b.title], b.head, ...b.rows.map((r) => r.map(plain)));
  return csvResponse(`${view.key}-${stamp}.csv`, csv([`Generated ${stamp}`], rows));
}

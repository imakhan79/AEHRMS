import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Biometric push endpoint (ATT-01). Devices (or a middleware polling them) post
// punches with their device code + API key; the database validates the key hash.
export async function POST(request: NextRequest) {
  const code = request.headers.get("x-device-code");
  const key = request.headers.get("x-device-key");
  if (!code || !key) {
    return NextResponse.json({ error: "x-device-code and x-device-key headers are required" }, { status: 401 });
  }
  let body: { events?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.events)) {
    return NextResponse.json({ error: "Body must be {\"events\": [...]}" }, { status: 400 });
  }

  // Anonymous client: no user session; the RPC authenticates the device itself.
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.rpc("ingest_biometric_events", {
    p_device_code: code,
    p_api_key: key,
    p_events: body.events,
  });
  if (error) {
    const status = error.code === "28000" ? 401 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}

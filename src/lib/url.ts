import "server-only";
import { headers } from "next/headers";

/** Origin of the current request (honours the proxy headers Vercel sets). */
export async function appOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Auth email links land here, then continue to `next`. */
export async function authCallbackUrl(next = "/dashboard") {
  return `${await appOrigin()}/auth/callback?next=${encodeURIComponent(next)}`;
}

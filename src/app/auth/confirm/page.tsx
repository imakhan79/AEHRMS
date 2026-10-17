import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand";
import { ConfirmSession } from "./confirm-session";

export const metadata: Metadata = { title: "Signing you in" };

export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const sp = await searchParams;
  const nextParam = typeof sp.next === "string" ? sp.next : "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-stone-50 px-4">
      <BrandLogo />
      <ConfirmSession next={next} />
    </main>
  );
}

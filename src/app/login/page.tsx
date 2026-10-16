import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { BrandLogo } from "@/components/brand";
import { LoginForm } from "./login-form";
import { DemoLogin } from "./demo-login";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/dashboard");
  const { error } = await searchParams;
  const demo = process.env.DEMO_MODE === "true";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,_#fdf3e2_0%,_#fafaf9_55%)] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link href="/" className="mb-5" aria-label="Zicon HRMS home">
            <BrandLogo priority className="max-h-14" />
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Sign in to HRMS</h1>
          <p className="mt-1 text-sm text-gray-500">AE Global Group · use your work account</p>
        </div>
        <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <LoginForm initialError={typeof error === "string" ? error : undefined} />
          {demo && <DemoLogin />}
        </div>
        <p className="mt-6 text-center text-xs text-gray-400">
          <Link href="/" className="hover:text-gray-600">
            ← Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}

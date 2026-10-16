import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { DemoLogin } from "./demo-login";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/dashboard");
  const { error } = await searchParams;
  const demo = process.env.DEMO_MODE === "true";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
            AE
          </Link>
          <h1 className="text-xl font-semibold text-gray-900">AE Global HRMS</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in with your work account</p>
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

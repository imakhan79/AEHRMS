import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { Card, DescList, Notice, PageHeader } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/types";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Account & password" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const session = await requireSession();
  const sp = await searchParams;
  const setting = sp.set === "password";

  return (
    <>
      <PageHeader title="Account & password" description="Your sign-in details." />
      {setting && (
        <div className="mb-6">
          <Notice tone="blue">You&apos;re signed in from an email link. Choose a password now so you can sign in with it next time.</Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Sign-in">
          <DescList
            items={[
              ["Email", session.email],
              ["Employee record", session.employee ? `${session.employee.full_name} · ${session.employee.employee_code}` : "Not linked"],
              ["Roles", [...session.roles].map((r) => ROLE_LABELS[r]).join(", ") || "None"],
            ]}
          />
          {session.employee && (
            <p className="mt-4 text-xs text-gray-500">
              Update your phone and address on{" "}
              <Link href="/profile" className="font-medium text-indigo-700 hover:underline">
                My Profile
              </Link>
              . Ask HR to change your work email.
            </p>
          )}
        </Card>
        <Card title={setting ? "Set your password" : "Change password"}>
          <PasswordForm autoFocus={setting} />
        </Card>
      </div>
    </>
  );
}

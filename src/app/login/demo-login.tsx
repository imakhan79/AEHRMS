"use client";

import { useState, useTransition } from "react";
import { demoSignIn, type DemoPersona } from "./actions";

const PERSONAS: { key: DemoPersona; name: string; role: string; sees: string }[] = [
  { key: "admin", name: "Sara Ahmed", role: "HR Manager · System Admin", sees: "Everything: employees, setup, roles, audit log" },
  { key: "manager", name: "Bilal Khan", role: "IT Manager · HOD", sees: "Own team, approvals for leave & attendance" },
  { key: "employee", name: "Ayesha Malik", role: "Software Engineer", sees: "Self-service: check-in, leave, own profile" },
];

export function DemoLogin() {
  const [pending, start] = useTransition();
  const [active, setActive] = useState<DemoPersona | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-gray-400">
        <span className="h-px flex-1 bg-gray-200" />
        Try the demo — one click
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <div className="space-y-2">
        {PERSONAS.map((p) => (
          <button
            key={p.key}
            type="button"
            disabled={pending}
            onClick={() => {
              setActive(p.key);
              setError(null);
              start(async () => {
                const res = await demoSignIn(p.key);
                if (res?.error) setError(res.error);
              });
            }}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
              {p.name
                .split(" ")
                .map((w) => w[0])
                .join("")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-900">
                {p.name} <span className="font-normal text-gray-500">· {p.role}</span>
              </span>
              <span className="block truncate text-xs text-gray-500">{p.sees}</span>
            </span>
            <span className="text-xs font-medium text-indigo-600">{pending && active === p.key ? "Signing in…" : "Enter →"}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <p className="mt-3 text-center text-xs text-gray-400">Demo data is fictional. Changes you make are visible to other demo visitors.</p>
    </div>
  );
}

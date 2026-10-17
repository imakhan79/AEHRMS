"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/** Turns the tokens in an implicit-flow link (#access_token=…) into a cookie session. */
export function ConfirmSession({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    // Recovery links must land where the password can be changed.
    const dest = hash.get("type") === "recovery" || hash.get("type") === "invite" ? "/account?set=password" : next;
    const linkError = hash.get("error_description")?.replace(/\+/g, " ") ?? "That link is invalid or has expired.";
    const signIn =
      access_token && refresh_token
        ? createClient().auth.setSession({ access_token, refresh_token }).then(({ error: e }) => (e ? "That link is invalid or has expired." : null))
        : Promise.resolve(linkError);
    signIn.then((message) => {
      if (message) setError(message);
      else window.location.replace(dest);
    });
  }, [next]);

  return (
    <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
      {error ? (
        <>
          <p role="alert" className="text-sm text-red-700">{error}</p>
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-indigo-700 hover:underline">
            Back to sign in
          </Link>
        </>
      ) : (
        <p role="status" className="text-sm text-gray-600">Signing you in…</p>
      )}
    </div>
  );
}

"use client";

import { signOut } from "@/app/login/actions";

export function SignOutButton() {
  return (
    <form
      action={signOut}
      onSubmit={() => navigator.serviceWorker?.controller?.postMessage("clear-cache")}
    >
      <button className="rounded-lg px-2.5 py-1.5 text-sm text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50">Sign out</button>
    </form>
  );
}

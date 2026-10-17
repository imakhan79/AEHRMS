"use client";

import { signOut } from "@/app/login/actions";

export function SignOutButton() {
  return (
    <form
      action={signOut}
      onSubmit={() => navigator.serviceWorker?.controller?.postMessage("clear-cache")}
    >
      <button className="h-10 whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-gray-600 ring-1 ring-gray-200 transition-colors hover:bg-gray-50 hover:text-indigo-700">Sign out</button>
    </form>
  );
}

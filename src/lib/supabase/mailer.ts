import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cookie-less client for sending auth emails on someone else's behalf (invites, password resets).
 * Implicit flow: the link works on the recipient's device, which never saw a PKCE verifier.
 * /auth/confirm picks the tokens up from the URL fragment.
 */
export function createMailerClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
  });
}

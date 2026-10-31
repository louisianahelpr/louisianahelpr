/**
 * AUD31-70 (Account leftovers): an address change waits for the member to confirm it from the new inbox. Supabase
 * keeps that address on the auth user as `new_email` until then; the Security tab's email row says so (the tab's own
 * auth read, same query key as the two-step card: no extra round trip). `sentTo` covers the moment between a send and
 * that read coming back. Moved out of SecurityTab.tsx to keep it under the 600-line component limit.
 * Guard: src/components/profile/securityTabEmailChange.test.tsx.
 */
import { useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { SECURITY_AUTH_USER_KEY, readSecurityAuthUser } from "@/components/profile/securityAuthUser";

/** The address a change is waiting on: the one just sent to, else Supabase's new_email, else null. */
export function usePendingEmail(sentTo: string | null): string | null {
  const pendingEmail = useQuery<User, Error, string | null>({
    queryKey: SECURITY_AUTH_USER_KEY,
    queryFn: readSecurityAuthUser,
    select: (u) => u.new_email ?? null,
    staleTime: 30_000,
    meta: { persist: false },
  }).data;
  return sentTo ?? pendingEmail ?? null;
}

/** "Waiting for you to confirm <new>." under the current address, while a different address waits. */
export function EmailWaitingLine({ waitingFor, email }: { waitingFor: string | null; email: string | null | undefined }) {
  if (!waitingFor || waitingFor.toLowerCase() === (email ?? "").toLowerCase()) return null;
  return (
    <p data-email-waiting="" className="text-ds-11 font-sans mt-0.5 [overflow-wrap:anywhere]" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      Waiting for you to confirm {waitingFor}.
    </p>
  );
}

import { useEffect, useSyncExternalStore } from "react";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { report } from "@/lib/errorLogger";

/**
 * Q2788: a guest's answer, asked once per page session (the switch moves by an admin's hand, rarely) and only once a
 * guest page asks: null until the server answers, and null for good after a failed read or a missing function, so the
 * caller keeps ID_CHECK_BEFORE_ANSWER. A plain store, not React Query: the legal pages, /safety and the landing render
 * this without a QueryClient in their tests and in the /legal prerender. A failure is reported at most once.
 * Tests not ABOUT this read get null here (src/test/setup.ts mocks this module, as it does usePayoutSetupHireAllowed),
 * so the many landing and legal tests keep testing what they were written for without reaching Supabase.
 * Guard: src/test/guestIdWordingFollowsTheSwitch.test.tsx (unmocks it).
 */
let guestIdCheck: boolean | null = null;
let guestIdCheckAsked = false;
const guestIdCheckListeners = new Set<() => void>();

async function askGuestIdCheck(): Promise<void> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const res = await supabase.rpc("identity_check_on_for_everyone");
    if (isMissingRpcNamed(res.error, "identity_check_on_for_everyone")) return;
    if (res.error) throw res.error;
    if (typeof res.data !== "boolean") return;
    guestIdCheck = res.data;
    guestIdCheckListeners.forEach((l) => l());
  } catch (error) {
    report(error, { severity: "warning", tags: { source: "legal.identity_check_on_for_everyone" } });
  }
}

export function useGuestIdCheckAnswer(guest: boolean): boolean | null {
  useEffect(() => {
    if (!guest || guestIdCheckAsked) return;
    guestIdCheckAsked = true;
    void askGuestIdCheck();
  }, [guest]);
  return useSyncExternalStore(
    (l) => {
      guestIdCheckListeners.add(l);
      return () => guestIdCheckListeners.delete(l);
    },
    () => guestIdCheck,
    () => null,
  );
}

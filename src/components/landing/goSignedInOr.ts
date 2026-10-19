import type { NavigateFunction } from "react-router-dom";
import { report } from "@/lib/errorLogger";

/**
 * The landing's account-aware links: the static href is the signed-out
 * destination (crawlable, and what a visitor gets without JS); a click checks
 * the session and sends a signed-in visitor to `signedIn` instead. If the auth
 * chunk fails to load or the session read throws, the visitor still lands on
 * `signedOut` (lead review, 2026-10-19: never a dead tap on the front door).
 */
export async function goSignedInOr(navigate: NavigateFunction, signedIn: string, signedOut: string): Promise<void> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    navigate(session?.user ? signedIn : signedOut);
  } catch (error) {
    // Reported, then the signed-out route: the tap always goes somewhere.
    report(error, { severity: "warning", tags: { source: "landing.goSignedInOr" } });
    navigate(signedOut);
  }
}

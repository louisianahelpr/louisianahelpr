import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { payoutAccountReady } from "@/lib/payoutAfterHire";
import { payoutAfterHireOn } from "@/lib/payoutAfterHireSwitch";

/**
 * Owner decision 2026-10-25 (switch payout_after_hire): right after an accept
 * goes through for a Helpr whose payout account is not ready, "You're hired.
 * Set up payouts to get paid." opens (HiredPayoutSetupDialog) in place of the
 * payment-held notice (its words already say the pay is held).
 *
 * `offer(userId)` reads the switch answer IdentityCheckMount published
 * (payoutAfterHireOn) and the member's own profile row, fresh after the
 * accept, then opens the prompt and
 * answers true only when the switch is on, the profile was read and payouts
 * are not ready; a fixture test seat (is_seed with no account, accept-ready
 * on the server) is never prompted. Anything else, a failed read included,
 * answers false and the caller shows the payment-held notice as before: the
 * job card's "Finish payout setup" line and the reminders still say what is
 * left. Plain calls, not hooks, so the accept handlers stay testable without
 * a query client.
 */
export function useHiredPayoutPrompt() {
  const [open, setOpen] = useState(false);
  const offer = async (userId: string): Promise<boolean> => {
    try {
      if (!payoutAfterHireOn()) return false;
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("stripe_account_id, stripe_payouts_enabled, is_seed")
        .eq("user_id", userId)
        .maybeSingle();
      if (profileErr || !profile || payoutAccountReady(profile)) return false;
      if (profile.is_seed === true && !profile.stripe_account_id) return false;
      setOpen(true);
      return true;
    } catch {
      // A failed read shows the payment-held notice instead (see above); the
      // job card and the reminders still carry the setup step, so nothing is lost.
      return false;
    }
  };
  return { open, offer, close: () => setOpen(false) };
}

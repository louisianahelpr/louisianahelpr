import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { hapticError } from "@/lib/haptics";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";
import { getPublicReturnUrl } from "@/lib/authRedirects";
import { track, AhaEvent } from "@/lib/analytics";
import { userFacingError } from "@/lib/userFacingError";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";

/**
 * Start (or finish) Stripe payout setup in one step: Stripe's own ID check and
 * the bank, on one Account Link (stripe-connect `onboard`, which also gives a
 * hired Helpr a fresh account when Stripe rejected the old one; owner
 * 2026-10-25). Used by the "You're hired" prompt and the job's "Finish payout
 * setup" line (payout_after_hire).
 *
 * Refuses to start while usePayoutSetupPaused() is true (paused, or not hired
 * yet): the caller shows PayoutSetupPausedNotice instead, and stripe-connect
 * refuses on its own anyway.
 *
 * Go first, close after (AwardGateDialog's lesson, owner 2026-10-08): on the
 * web the page leaves for Stripe; in the app Stripe opens over it and
 * `onOpened` runs once it is up.
 */
export function useStartPayoutSetup(source: string, onOpened?: () => void) {
  const setupPaused = usePayoutSetupPaused();
  const [loading, setLoading] = useState(false);
  const start = async () => {
    if (setupPaused || loading) return;
    setLoading(true);
    try {
      track(AhaEvent.PayoutSetupStarted, { action: source });
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "onboard", return_url: getPublicReturnUrl(), collect: "eventually_due" },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Couldn't open Stripe"));
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("Stripe didn't return a setup link — try again in a moment.");
      await openExternalUrl(data.url);
      if (isNativePlatform) {
        onOpened?.();
        setLoading(false);
      }
    } catch (e: unknown) {
      hapticError();
      toast.error(userFacingError(e, "Couldn't open Stripe — try again in a moment."));
      setLoading(false);
    }
  };
  return { start, loading, setupPaused };
}

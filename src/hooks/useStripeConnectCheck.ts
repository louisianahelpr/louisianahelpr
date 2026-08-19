import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

type ConnectStatus = {
  connected: boolean;
  details_submitted: boolean;
  payouts_enabled: boolean;
};

export type StripeConnectCheckResult = {
  ok: boolean;
  reason?: string;
  /**
   * True when the only thing standing between the helper and the action is
   * payout setup — i.e. the failure has a destination. The hook deliberately
   * does NOT navigate: it isn't rendered under a component that owns the
   * router in every caller, and a hook that quietly moves the user is worse
   * than one that reports a fact. Callers turn this into a tappable control
   * (see `useOfferHandlers`), which is why the copy no longer narrates a menu
   * path — a button beats "Go to Profile → Payment Settings".
   */
  needsPayoutSetup?: boolean;
};

export function useStripeConnectCheck() {
  const [checking, setChecking] = useState(false);

  const checkHelperStripeConnect = useCallback(async (): Promise<StripeConnectCheckResult> => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "status" },
      });
      if (error) throw error;
      const status = data as ConnectStatus;
      if (!status.connected) {
        return { ok: false, reason: "Connect a payout account before you can accept jobs.", needsPayoutSetup: true };
      }
      if (!status.details_submitted) {
        return { ok: false, reason: "Your payout account setup is incomplete.", needsPayoutSetup: true };
      }
      // Allow applying as long as a payout method is on file.
      // Stripe may still be verifying the account, but that shouldn't block job applications.
      return { ok: true };
    } catch {
      // No `needsPayoutSetup` here: we never established that the account is
      // missing, only that we couldn't ask. Sending them to set up an account
      // they may already have would be the wrong instruction.
      return { ok: false, reason: "Unable to verify your payout account. Please try again." };
    } finally {
      setChecking(false);
    }
  }, []);

  return { checkHelperStripeConnect, checking };
}

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

type ConnectStatus = {
  connected: boolean;
  details_submitted: boolean;
  payouts_enabled: boolean;
};

export function useStripeConnectCheck() {
  const [checking, setChecking] = useState(false);

  const checkHelperStripeConnect = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "status" },
      });
      if (error) throw error;
      const status = data as ConnectStatus;
      if (!status.connected) {
        return { ok: false, reason: "You need to connect a payout account before accepting jobs. Go to Profile → Payment Settings to set it up." };
      }
      if (!status.details_submitted) {
        return { ok: false, reason: "Your payout account setup is incomplete. Go to Profile → Payment Settings to finish it." };
      }
      if (!status.payouts_enabled) {
        return { ok: false, reason: "Your payout account is still being verified. Please wait 1–2 business days before accepting jobs." };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "Unable to verify your payout account. Please try again." };
    } finally {
      setChecking(false);
    }
  }, []);

  return { checkHelperStripeConnect, checking };
}

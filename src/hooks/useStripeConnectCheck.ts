import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  awardBlockReasonFromStatus,
  type AwardBlockReason,
  type AwardGateStatus,
} from "@/lib/awardGate";

type ConnectStatus = AwardGateStatus & {
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

export type AwardEligibility = {
  /** True when this helper may be awarded a job right now. */
  ok: boolean;
  /** Which requirement is missing; null when `ok`. */
  reason: AwardBlockReason | null;
  /**
   * True only when the check itself failed (network, edge function down) — as
   * opposed to a definite "not eligible". The two must never render the same:
   * telling a verified helper they are unverified because a fetch dropped is
   * the bug that used to trap them in the old IDV dialog with no way out.
   */
  indeterminate?: boolean;
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
      return { ok: false, reason: "Couldn't verify your payout account — try again?" };
    } finally {
      setChecking(false);
    }
  }, []);

  /**
   * The full acceptance gate: payout-ready AND Stripe-identity-verified.
   *
   * One live Stripe read serves both halves, and that same edge-function call
   * writes the verdict back onto the `profiles` columns the server trigger
   * enforces (migration 20260827191647) — so the answer shown here and the
   * answer the database will give are the same fact, refreshed together.
   *
   * This SUPERSEDES the old `idv_status = 'verified'` check rather than adding
   * to it. `idv_status` is the unreviewed upload/admin flag; asserting identity
   * from it was the thing commit 47eef666 set out to stop.
   */
  const checkHelperAwardEligibility = useCallback(async (): Promise<AwardEligibility> => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "status" },
      });
      if (error) throw error;
      const reason = await awardBlockReasonFromStatus(data as ConnectStatus | null);
      return { ok: reason === null, reason };
    } catch {
      return { ok: false, reason: null, indeterminate: true };
    } finally {
      setChecking(false);
    }
  }, []);

  return { checkHelperStripeConnect, checkHelperAwardEligibility, checking };
}

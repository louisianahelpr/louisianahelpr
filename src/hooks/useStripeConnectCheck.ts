import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { functionInvokeError } from "@/lib/supabaseResult";
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
   * telling a ready helper they are not set up because a fetch dropped is
   * the bug that used to trap them in a dialog with no way out.
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
      if (error) throw await functionInvokeError(error);
      const status = data as ConnectStatus;
      if (!status.connected) {
        return { ok: false, reason: "Connect a payout account so you can get paid.", needsPayoutSetup: true };
      }
      if (!status.details_submitted) {
        return { ok: false, reason: "Your payout account setup is incomplete.", needsPayoutSetup: true };
      }
      // Allow applying as long as a payout method is on file.
      // Stripe may still be verifying the account, but that shouldn't block job applications.
      return { ok: true };
    } catch (err) {
      report(err, { severity: "warning", tags: { area: "payout", op: "checkHelperStripeConnect" } });
      // No `needsPayoutSetup` here: we never established that the account is
      // missing, only that we couldn't ask. Sending them to set up an account
      // they may already have would be the wrong instruction.
      return { ok: false, reason: "Couldn't verify your payout account — try again?" };
    } finally {
      setChecking(false);
    }
  }, []);

  /**
   * The full acceptance gate: payout-ready. (Identity verification stopped
   * being part of it on 2026-10-01, migration 20261001222911.)
   *
   * One live Stripe read, and that same edge-function call writes the verdict
   * back onto the `profiles` columns the server trigger enforces (migration
   * 20260827191647), so the answer shown here and the answer the database will
   * give are the same fact, refreshed together.
   */
  const checkHelperAwardEligibility = useCallback(async (): Promise<AwardEligibility> => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "status" },
      });
      if (error) throw await functionInvokeError(error);
      const reason = await awardBlockReasonFromStatus(data as ConnectStatus | null);
      return { ok: reason === null, reason };
    } catch (err) {
      report(err, { severity: "warning", tags: { area: "payout", op: "checkHelperAwardEligibility" } });
      // Reported, and never silent to the user: `indeterminate`
      // is the whole point — it says "we could not ask", which both callers in
      // useOfferHandlers stop on with a "couldn't check your payout
      // status" toast rather than reading it as "not set up" and trapping an
      // already-ready helper. The gate fails CLOSED and explains itself;
      // the report is what tells us when "could not ask" stops being a blip.
      return { ok: false, reason: null, indeterminate: true };
    } finally {
      setChecking(false);
    }
  }, []);

  return { checkHelperStripeConnect, checkHelperAwardEligibility, checking };
}

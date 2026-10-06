import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

/** The server-side payout holds (Q764) for the admin payout queue: the rows, and the three admin writes. */
export function usePayoutHolds(adminId: string | undefined) {
  const qc = useQueryClient();
  // ── Payout holds live on the SERVER (Q764) ──────────────────────────────
  // public.payout_holds: every admin reads the same rows (RLS: admins only),
  // and every payout path refuses a held Helpr (release-payout, the scheduled
  // crons, cash-outs, tips). They used to live in this browser's localStorage,
  // so a second admin's Send Payout or Bulk Approve, and the crons, paid a
  // "held" Helpr. Writes go through admin-only RPCs, which also write the
  // admin_audit_log row themselves (so nothing here calls logAdminAction).
  const holdsKey = ["admin-payout-holds", adminId] as const;
  const {
    data: holdRows,
    isLoading: holdsLoading,
    isError: holdsError,
    refetch: refetchHolds,
  } = useQuery({
    queryKey: holdsKey,
    enabled: !!adminId,
    // Admin-only safety state: opt out of disk persistence like the queue.
    meta: { persist: false },
    queryFn: async () =>
      unwrap(
        await supabase
          .from("payout_holds")
          .select("helper_id, reason, held_at, held_by, denied_at, denied_reason"),
      ),
  });
  const holds = useMemo(() => {
    const out: Record<string, { reason: string; addedAt: string; addedBy?: string }> = {};
    for (const h of holdRows ?? []) {
      out[h.helper_id] = {
        reason: h.denied_reason ? `[DENIED] ${h.denied_reason}` : h.reason,
        addedAt: h.held_at,
        addedBy: h.held_by ?? undefined,
      };
    }
    return out;
  }, [holdRows]);

  /** One hold write: throws into a toast, and re-reads the holds on success. */
  const runHoldWrite = async (
    label: string,
    write: () => Promise<boolean>,
    copyFor: (err: unknown) => string | null,
  ): Promise<boolean> => {
    try {
      if (!(await write())) throw new Error(`${label}: the server did not confirm the change`);
      await qc.invalidateQueries({ queryKey: holdsKey });
      return true;
    } catch (err: unknown) {
      report(err, { tags: { source: `AdminPayoutBatches.${label}` } });
      toast.error(copyFor(err) ?? userFacingError(err, "Couldn't update that payout hold — try again."));
      return false;
    }
  };

  // ── Q1221: the hold also freezes the Helpr's Stripe AUTOMATIC payouts ──
  // The hold RPCs queue the change in public.payout_schedule_freezes (a
  // trigger); payout-hold-stripe-sync tells Stripe. Called here right after
  // the write so the admin learns at once whether Stripe took it. If this call
  // never happens or fails, the 10-minute payout-freeze-sync sweep retries and
  // pages ops; a failure also leaves a note on the Helpr's admin page. So a
  // failure here is a warning to the admin, never a reason to undo the hold.
  const syncStripeFreeze = async (helperId: string, releasing: boolean) => {
    let ok = false;
    try {
      const { data, error } = await supabase.functions.invoke("payout-hold-stripe-sync", { body: { helper_id: helperId } });
      ok = !error && (data as { ok?: unknown } | null)?.ok === true;
      if (!ok) report(error ?? new Error("payout-hold-stripe-sync did not confirm"), { tags: { source: "AdminPayoutBatches.syncStripeFreeze" } });
    } catch (err: unknown) {
      report(err, { tags: { source: "AdminPayoutBatches.syncStripeFreeze" } });
    }
    if (!ok) {
      toast.error(
        releasing
          ? "Hold released, but Stripe automatic payouts could not be switched back on yet. It retries every 10 minutes and ops has been alerted."
          : "Hold saved, but Stripe automatic payouts could not be paused yet. It retries every 10 minutes and ops has been alerted.",
      );
    }
  };

  const addHold = async (helperId: string, reason: string) => {
    const ok = await runHoldWrite("addHold", async () => {
      const row = unwrap(await supabase.rpc("admin_set_payout_hold", { p_helper_id: helperId, p_reason: reason }));
      return !!row && row.helper_id === helperId;
    }, (err) => rpcErrorMessage("admin_set_payout_hold", err));
    if (ok) await syncStripeFreeze(helperId, false);
    return ok;
  };
  const releaseHold = async (helperId: string) => {
    // The RPC answers false when there was no hold to clear (another admin
    // released it first). The end state is the one asked for, so that is not
    // an error; a thrown error is.
    const ok = await runHoldWrite("releaseHold", async () => {
      unwrap(await supabase.rpc("admin_release_payout_hold", { p_helper_id: helperId }));
      return true;
    }, (err) => rpcErrorMessage("admin_release_payout_hold", err));
    if (ok) await syncStripeFreeze(helperId, true);
  };
  const denyHold = async (helperId: string, reason: string) => {
    // A denial is recorded ON the hold and keeps blocking every payout path.
    // Nothing is refunded or reversed here.
    await runHoldWrite("denyHold", async () => {
      const row = unwrap(await supabase.rpc("admin_deny_payout_hold", { p_helper_id: helperId, p_reason: reason }));
      return !!row && row.helper_id === helperId;
    }, (err) => rpcErrorMessage("admin_deny_payout_hold", err));
  };

  return { holdRows, holds, holdsLoading, holdsError, refetchHolds, addHold, releaseHold, denyHold };
}

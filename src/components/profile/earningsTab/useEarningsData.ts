import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { queryKeys } from "@/lib/queryKeys";
import type { PayoutLedgerRow, StripePayoutData } from "./types";

export function useEarningsData(helperId: string) {
  const qc = useQueryClient();

  // React Query: caches Stripe payout data so re-opening the tab is instant.
  const FALLBACK_STRIPE: StripePayoutData = {
    connected: false, payouts_enabled: false, available: [], pending: [], payouts: [],
  };
  const { data: stripeData, isLoading: stripeLoading, isFetching, isError: stripeError, refetch } = useQuery<StripePayoutData>({
    // User-scoped: the persisted IDB cache (24h) would otherwise rehydrate
    // the prior helper's Stripe balance + payout history on a shared device.
    queryKey: queryKeys.stripePayouts.byUser(helperId),
    queryFn: async () => {
      // A failure THROWS instead of resolving to {connected:false} — the
      // fallback made a stripe-payouts outage render as "you haven't
      // connected Stripe" to a fully connected helper. The error surfaces
      // as `stripeError` for EarningsTab to render an inline retry.
      try {
        const { data, error } = await supabase.functions.invoke<StripePayoutData>("stripe-payouts", { body: {} });
        if (error) throw error;
        return data ?? FALLBACK_STRIPE;
      } catch (err) {
        report(err, { severity: "warning", tags: { source: "EarningsTab.fetchPayouts" } });
        throw err;
      }
    },
    enabled: !!helperId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // payout_transfers ledger — the authoritative record of every
  // stripe.transfers.create() call to this helper. RLS already restricts
  // SELECT to `auth.uid() = helper_id` so no extra filter needed here.
  const { data: payoutLedger = [], isError: ledgerError } = useQuery<PayoutLedgerRow[]>({
    queryKey: queryKeys.payoutTransfers.byHelper(helperId),
    queryFn: async () => {
      if (!helperId) return [];
      const { data, error } = await supabase.from("payout_transfers")
        .select("id, job_id, amount_cents, platform_fee_cents, status, created_at, paid_at, failed_at, failure_reason, stripe_transfer_id, jobs(title)")
        .eq("helper_id", helperId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        // Throw, don't collapse to [] — an empty ledger and a failed fetch
        // are different facts, and the tab shows a retry for the latter.
        report(error, { severity: "warning", tags: { source: "EarningsTab.fetchLedger" } });
        throw error;
      }
      return (data ?? []) as PayoutLedgerRow[];
    },
    enabled: !!helperId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const refreshing = isFetching && !stripeLoading;
  const handleRefresh = () => {
    // Prefix invalidate — matches any user-scoped stripe-payouts key the
    // current session may have cached. The transfers ledger rides along so
    // a Retry after a failed load refetches both surfaces.
    qc.invalidateQueries({ queryKey: queryKeys.stripePayouts.all });
    qc.invalidateQueries({ queryKey: queryKeys.payoutTransfers.byHelper(helperId) });
    refetch();
  };

  return { stripeData, stripeLoading, stripeError, ledgerError, payoutLedger, refreshing, handleRefresh };
}

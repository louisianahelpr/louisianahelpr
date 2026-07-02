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
  const { data: stripeData, isLoading: stripeLoading, isFetching, refetch } = useQuery<StripePayoutData>({
    // User-scoped: the persisted IDB cache (24h) would otherwise rehydrate
    // the prior helper's Stripe balance + payout history on a shared device.
    queryKey: queryKeys.stripePayouts.byUser(helperId),
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke<StripePayoutData>("stripe-payouts", { body: {} });
        if (error) throw error;
        return data ?? FALLBACK_STRIPE;
      } catch (err) {
        report(err, { severity: "warning", tags: { source: "EarningsTab.fetchPayouts" } });
        return FALLBACK_STRIPE;
      }
    },
    enabled: !!helperId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // payout_transfers ledger — the authoritative record of every
  // stripe.transfers.create() call to this helper. RLS already restricts
  // SELECT to `auth.uid() = helper_id` so no extra filter needed here.
  const { data: payoutLedger = [] } = useQuery<PayoutLedgerRow[]>({
    queryKey: queryKeys.payoutTransfers.byHelper(helperId),
    queryFn: async () => {
      if (!helperId) return [];
      const { data, error } = await supabase.from("payout_transfers")
        .select("id, job_id, amount_cents, platform_fee_cents, status, created_at, paid_at, failed_at, failure_reason, stripe_transfer_id, jobs(title)")
        .eq("helper_id", helperId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        report(error, { severity: "warning", tags: { source: "EarningsTab.fetchLedger" } });
        return [];
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
    // current session may have cached.
    qc.invalidateQueries({ queryKey: queryKeys.stripePayouts.all });
    refetch();
  };

  return { stripeData, stripeLoading, payoutLedger, refreshing, handleRefresh };
}

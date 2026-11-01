import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { queryKeys } from "@/lib/queryKeys";
import type { PayoutLedgerRow, StripePayoutData } from "./types";
import { functionInvokeError, unwrap } from "@/lib/supabaseResult";

const FALLBACK_STRIPE: StripePayoutData = {
  connected: false, payouts_enabled: false, available: [], pending: [], payouts: [],
};

/** The stripe-payouts read (wallet balance and payouts). React Query caches it so re-opening the tab is instant. */
function stripePayoutsQuery(helperId: string) {
  return {
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
        if (error) throw await functionInvokeError(error);
        return data ?? FALLBACK_STRIPE;
      } catch (err) {
        report(err, { severity: "warning", tags: { source: "EarningsTab.fetchPayouts" } });
        throw err;
      }
    },
    enabled: !!helperId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  };
}

// payout_transfers ledger — the authoritative record of every
// stripe.transfers.create() call to this helper. RLS already restricts
// SELECT to `auth.uid() = helper_id` so no extra filter needed here.
function payoutLedgerQuery(helperId: string) {
  return {
    queryKey: queryKeys.payoutTransfers.byHelper(helperId),
    queryFn: async () => {
      if (!helperId) return [];
      const result = await supabase.from("payout_transfers")
        .select("id, job_id, amount_cents, platform_fee_cents, status, created_at, paid_at, failed_at, failure_reason, stripe_transfer_id, metadata, jobs(title)")
        .eq("helper_id", helperId)
        .order("created_at", { ascending: false })
        .limit(50);
      // Throw (unwrap), don't collapse to [] — an empty ledger and a failed
      // fetch are different facts, and the tab shows a retry for the latter.
      if (result.error) report(result.error, { severity: "warning", tags: { source: "EarningsTab.fetchLedger" } });
      return (unwrap(result) ?? []) as PayoutLedgerRow[];
    },
    enabled: !!helperId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  };
}

/**
 * Starts Money's two payout reads before EarningsTab's chunk has loaded
 * (ProfileTabPanels, on the earnings tab): they used to start only once that
 * chunk had downloaded and run. Same keys and functions as the hook, so the
 * hook finds them in flight or fresh (staleTime) and does not read twice.
 */
export function prefetchEarningsReads(qc: QueryClient, helperId: string): void {
  if (!helperId) return;
  void qc.prefetchQuery(stripePayoutsQuery(helperId));
  void qc.prefetchQuery(payoutLedgerQuery(helperId));
}

export function useEarningsData(helperId: string) {
  const qc = useQueryClient();

  const { data: stripeData, isLoading: stripeLoading, isFetching, isError: stripeError, refetch } = useQuery<StripePayoutData>(stripePayoutsQuery(helperId));

  const { data: payoutLedger = [], isError: ledgerError, isPending: ledgerPending } = useQuery<PayoutLedgerRow[]>(payoutLedgerQuery(helperId));

  const refreshing = isFetching && !stripeLoading;
  const handleRefresh = () => {
    // Prefix invalidate — matches any user-scoped stripe-payouts key the
    // current session may have cached. The transfers ledger rides along so
    // a Retry after a failed load refetches both surfaces.
    qc.invalidateQueries({ queryKey: queryKeys.stripePayouts.all });
    qc.invalidateQueries({ queryKey: queryKeys.payoutTransfers.byHelper(helperId) });
    refetch();
  };

  // A disabled query (no helperId) is pending forever in React Query v5; only
  // a ledger that will actually load holds the page's arrival gate.
  return { stripeData, stripeLoading, stripeError, ledgerError, ledgerPending: !!helperId && ledgerPending, payoutLedger, refreshing, handleRefresh };
}

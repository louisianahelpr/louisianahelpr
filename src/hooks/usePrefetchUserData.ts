import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { fetchReferralData } from "@/hooks/useReferralData";
import { prefetchActivityCores } from "@/hooks/useActivityData";
import { prefetchRoute } from "@/lib/routePrefetch";
import { prefetchPayoutSetup } from "@/lib/payoutSetupQueries";

/**
 * Warm caches for the screens a Dashboard user is most likely to tap next:
 * Referrals, Activity (My Posts / My Jobs), and the Jobs route chunk.
 *
 * Uses queryClient.prefetchQuery so React Query stores the result against the
 * same keys the actual screens will read — making subsequent navigations feel
 * instant. Idle-scheduled to avoid contending with the Dashboard's own load.
 */
export function usePrefetchUserData(userId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const idle = (cb: () => void) => {
      const w = window as any;
      if (typeof w.requestIdleCallback === "function") {
        w.requestIdleCallback(cb, { timeout: 1500 });
      } else {
        setTimeout(cb, 400);
      }
    };

    idle(() => {
      // Data caches — 60s staleTime means revisits are instant.
      queryClient.prefetchQuery({
        queryKey: queryKeys.referral.byUser(userId),
        queryFn: () => fetchReferralData(userId),
        staleTime: 60 * 1000,
      });
      // Both Activity tabs' CORE queries (the per-tab first-paint data). The
      // deferred detail queries are keyed on the core result, so they can't be
      // warmed from here — and nothing waits on them to paint.
      prefetchActivityCores(queryClient, userId);
      // Route chunks — first paint of the destination is now ~instant.
      prefetchRoute("/my-posts");
      prefetchRoute("/my-jobs");
      prefetchRoute("/profile");
      // The SLOW class. Everything above is PostgREST/RPC (~110ms); these two
      // are edge fn → Stripe (395ms measured against prod) and are the whole
      // reason /profile's payout card lands visibly after the rest of the
      // screen. Warming them here spends that 395ms while the user is still
      // looking at the Dashboard. Nothing else in the app warmed a
      // Stripe-class query — this is the pattern the next one should copy.
      prefetchPayoutSetup(queryClient, userId);
    });
  }, [userId, queryClient]);
}

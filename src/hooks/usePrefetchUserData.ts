import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { fetchReferralData } from "@/hooks/useReferralData";
import { prefetchActivityCores } from "@/hooks/useActivityData";
import { isConstrainedNetwork, prefetchRoute, whenPageSettled } from "@/lib/routePrefetch";
import { prefetchPayoutSetup } from "@/lib/payoutSetupQueries";

/**
 * Warm caches for the screens a Dashboard user is most likely to tap next:
 * Referrals, Activity (My Posts / My Jobs), and the Jobs route chunk.
 *
 * Uses queryClient.prefetchQuery so React Query stores the result against the
 * same keys the actual screens will read — making subsequent navigations feel
 * instant.
 *
 * NOT UNTIL THE DASHBOARD HAS ARRIVED (Q1158, 2026-10-03). This used to run in
 * the first `requestIdleCallback` after mount, and "idle" means the MAIN
 * THREAD is idle — which it is the moment the Dashboard has drawn its skeleton
 * and is waiting on the network. So every warm-up below went out in the same
 * tick as the Dashboard's own reads. Measured on a cold /home (local build,
 * prod data, 375, Slow 4G + 4x CPU, scripts/perf/cwv-lab.mjs): the /posts,
 * /jobs and /profile chunk graphs, the referral and Activity reads and the two
 * Stripe-backed payout calls all started ~0.1 s after the app first drew,
 * beside the feed they were meant to stay out of the way of, and the largest
 * paint landed at 6.4 s. Every other speculative prefetch in the app already
 * waited for the page to settle (Q178: `whenPageSettled`,
 * `prefetchRoutesWhenIdle`); this was the one path that skipped the gate. It
 * now waits the same way — the window `load` event AND a quiet network, then
 * an idle callback — and a Save-Data / 2G visitor gets none of it, as with
 * every other speculative fetch (`isConstrainedNetwork`).
 */
export function usePrefetchUserData(userId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    if (isConstrainedNetwork()) return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let cancelIdle = () => {};
    const idle = (cb: () => void) => {
      if (typeof w.requestIdleCallback === "function") {
        const id = w.requestIdleCallback(cb, { timeout: 1500 });
        cancelIdle = () => w.cancelIdleCallback?.(id);
      } else {
        const t = window.setTimeout(cb, 400);
        cancelIdle = () => window.clearTimeout(t);
      }
    };

    const stopWaiting = whenPageSettled(() => idle(() => {
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
      prefetchRoute("/posts");
      prefetchRoute("/jobs");
      prefetchRoute("/profile");
      // The SLOW class. Everything above is PostgREST/RPC (~110ms); these two
      // are edge fn → Stripe (395ms measured against prod) and are the whole
      // reason /profile's payout card lands visibly after the rest of the
      // screen. Warming them here spends that 395ms while the user is still
      // looking at the Dashboard. Nothing else in the app warmed a
      // Stripe-class query — this is the pattern the next one should copy.
      prefetchPayoutSetup(queryClient, userId);
    }));
    return () => {
      stopWaiting();
      cancelIdle();
    };
  }, [userId, queryClient]);
}

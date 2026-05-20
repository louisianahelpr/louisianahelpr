/**
 * Shared React Query client.
 *
 * Extracted from `App.tsx` so non-React modules (e.g. `main.tsx` auth
 * listeners that wipe the cache on SIGNED_OUT) can reach the same client
 * instance the `<QueryClientProvider>` is wrapped around. Without a shared
 * export, every consumer that called `new QueryClient()` would get its own
 * isolated cache, and a `clear()` from outside the tree would do nothing
 * to the in-tree cache.
 *
 * Why this matters for privacy:
 *   PR #262 added persistent React Query cache to IndexedDB with a 24h
 *   maxAge. Without an explicit `queryClient.clear()` on SIGNED_OUT, the
 *   next user to log in on a shared device rehydrates the prior user's
 *   data (Stripe payouts, admin payout ledger, job history,
 *   notification logs) until the persisted entries expire.
 */
import { QueryClient } from "@tanstack/react-query";
import { PERSIST_MAX_AGE_MS } from "./queryPersister";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep data considered fresh for 60s — short enough that refocusing
      // after a brief context switch triggers a background refetch, long
      // enough to avoid hammering Supabase on rapid remounts.
      staleTime: 60 * 1000,
      // Match the persisted-cache max age. `gcTime` MUST be >= the
      // persister's maxAge or TanStack drops entries on hydrate, defeating
      // the whole point of disk persistence. See src/lib/queryPersister.ts.
      gcTime: PERSIST_MAX_AGE_MS,
      // Only retry transient/server errors. Client errors (401/403/404/etc.)
      // won't be fixed by retrying — the token's invalid, the row doesn't
      // exist, or RLS blocked it. Retrying just wastes a round-trip.
      retry: (failureCount, error: unknown) => {
        const status =
          (error as { status?: number; statusCode?: number; code?: number | string })?.status ??
          (error as { statusCode?: number })?.statusCode ??
          Number((error as { code?: number | string })?.code);
        if (typeof status === "number" && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      // Re-enable: in a live marketplace, returning to the app should
      // surface jobs that may have been claimed/cancelled while away.
      refetchOnWindowFocus: true,
    },
  },
});

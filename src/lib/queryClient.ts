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
    mutations: {
      // WRITES MUST FAIL LOUDLY, NEVER PAUSE.
      //
      // React Query's default is `networkMode: "online"`, which does NOT
      // mean "error when offline" — it means the mutation is PAUSED. It
      // never calls `mutationFn`, never fires `onError`, and never rolls
      // back. `useSaveJob`'s `onMutate` had already flipped the heart and
      // `PayItForward`'s donate had already spun its button, so the user
      // sees a completed action while ZERO requests leave the device.
      //
      // Driven against prod (offline tap on Save/Unsave):
      //   +300ms  aria-label="Unsave job"  toasts=[]  netSinceTap=0
      //   +700ms  aria-label="Unsave job"  toasts=[]  netSinceTap=0
      //   saved_jobs 0 -> 0 offline; 0 -> 1 on reconnect;
      //   0 -> 0 when the app is closed before reconnect — SILENTLY LOST.
      //
      // `onlineManager` is fed by @capacitor/network on iOS (see
      // src/lib/appLifecycle.ts), so on the native surface the pause is
      // driven by real reachability and is very much live.
      //
      // Worse, the pause is not even ephemeral. `queryPersister` sets only
      // `shouldDehydrateQuery`, so TanStack's `defaultShouldDehydrateMutation`
      // applies — and it dehydrates exactly the mutations where
      // `state.isPaused` is true. Paused writes are therefore serialised into
      // IndexedDB and rehydrated on next launch as zombies: nothing calls
      // `resumePausedMutations()`, and no call site registers a `mutationKey`
      // via `setMutationDefaults`, so a restored mutation has no `mutationFn`
      // and can never run. Persisted, restored, never sent, never surfaced.
      //
      // "always" converts every one of those into the behaviour the app's
      // bare-`await` write paths already have: the request is attempted, the
      // fetch rejects, `onError` runs, the optimistic update rolls back, and
      // the user gets a toast with a Retry. It also ends the zombie
      // persistence as a side effect — nothing is ever `isPaused`, so nothing
      // is ever dehydrated.
      //
      // Audited every `useMutation` in src/ before flipping this (all 6:
      // PayItForward donate, PetProfiles delete, StrSettings add/remove,
      // useSaveJob, useApplyFlow). None sets its own `networkMode`, none
      // reads `isPaused`/`resumePausedMutations`/`mutationCache`, and none
      // depends on the pause. The app's real offline defence is the set of
      // SYNCHRONOUS pre-mutate gates — `requireOnline()` and `ApplyBody`'s
      // `!online` branch — which bail before `.mutate()` is ever called and
      // are unaffected by this default. `OfflineBanner` documents the
      // deliberate absence of an offline queue; this default makes the code
      // match that documented intent.
      networkMode: "always",
      // Explicit, not inherited: mutation retry does NOT fall back to the
      // `queries.retry` function above (that would re-run a write up to two
      // more times). v5's mutation default is already 0 — stated here so a
      // future edit to `queries.retry` can't quietly start retrying writes.
      retry: 0,
    },
  },
});

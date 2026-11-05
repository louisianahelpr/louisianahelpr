import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { stripeConnectStatusKey } from "@/hooks/useStripeConnectStatus";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import type { Tab } from "./types";

/**
 * Profile-landing scroll offsets, keyed by history entry.
 *
 * MEASURED ON DEVICE, not assumed. An on-screen probe reported
 * `shell=NONE ref=1009 win=0` while the list was scrolled: `.app-shell-scroll`
 * does not exist on /profile (AppShell is `scrollable={false}` here), the
 * PullToRefreshWrapper below IS the scroller, and window.scrollY is always 0.
 * That is why the global ScrollToTop — which resolves its scroller via
 * `document.querySelector(".app-shell-scroll")` and otherwise falls back to the
 * window — recorded 0 for every profile entry and had nothing to restore.
 *
 * An earlier attempt keyed on `location.key` and still failed, because back was
 * a PUSH at the time (seven sub-pages passed `onBack={() => navigate("/profile")}`)
 * and a push mints a NEW key, so the saved offset was never looked up. That was
 * fixed for the seven real sub-ROUTES (PageHeader `backTo`) — but it was never
 * true for the seventeen in-page TABS, which is the round trip the owner
 * actually reported: "if you're scrolled on the profile tab and you click a
 * profile tab then press back, it brings you all the way back up to the top."
 *
 * Those tabs are not navigations. `setTab` is component state, mirrored into
 * `?tab=` by a `setSearchParams(..., { replace: true })` effect — and a replace
 * still mints a BRAND NEW `location.key`; it replaces the entry, key and all.
 * So one trip into a tab and back burned three distinct keys, the landing
 * looked up the third, and the offset saved under the first was unreachable.
 * Measured at 375px: scroll to 400 → open Notifications → back → scrollTop 0.
 *
 * Keyed on the PATHNAME instead, which is what this always wanted. There is one
 * Profile landing and one scroll position for it; `key` was only ever standing
 * in for "this page", and it was a stand-in that changed underneath us every
 * time the tab param moved.
 */
const profileScrollByKey = new Map<string, number>();

/**
 * The Profile landing's scroll surface: pull-to-refresh, the scroll offset
 * kept across a round trip into a tab, and the Stripe-status re-ask on leaving
 * the Payment tab. Moved verbatim out of Profile.tsx (Q806 god-component
 * split); behaviour unchanged.
 */
export function useProfileLandingScroller({ showSkeleton, tab, userId, refreshCurrentUser, queryClient }: {
  showSkeleton: boolean;
  tab: Tab;
  userId: string | undefined;
  refreshCurrentUser: () => Promise<unknown>;
  queryClient: QueryClient;
}) {
  // Pull-to-refresh for the Profile landing — re-syncs the profile,
  // Stripe-connect status, helper stats, and review preview. Scoped to
  // the landing's scroll surface via PullToRefreshWrapper below.
  // Invalidating the stats/reviews queries deliberately re-fetches them
  // (the prior `{ force: true }` semantics) while reusing the cache for
  // everything else.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => {
      await refreshCurrentUser();
      if (userId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["profile", userId, "stats"] }),
          queryClient.invalidateQueries({ queryKey: ["profile", userId, "reviews"] }),
          // The comment above has always claimed pull-to-refresh re-syncs the
          // Stripe-connect status; until this line it did not — the old effect
          // was guarded on `!stripeConnectStatus`, so once it had any answer
          // (including a failed one) nothing could re-ask.
          queryClient.invalidateQueries({ queryKey: stripeConnectStatusKey(userId) }),
        ]);
      }
    },
  });

  // Preserve the landing list's scroll position across a round trip into any
  // profile sub-page. See profileScrollByKey above for why the global handler
  // cannot do this for /profile.
  const routeLocation = useLocation();
  // Pathname, not `key` — see profileScrollByKey above.
  const routeKey = routeLocation.pathname;
  useEffect(() => {
    // `showSkeleton` is in the deps deliberately. Profile early-returns a SKELETON
    // while it is set, so PullToRefreshWrapper — and therefore containerRef — does
    // not exist on first mount. Without this dep the effect bailed on the null
    // ref and never re-ran when the real list appeared, so the scroll listener
    // was never attached and nothing was ever saved. That is what defeated the
    // previous attempt at this fix, verified on device.
    if (showSkeleton || tab !== "landing") return;
    const el = containerRef.current;
    if (!el) return;

    let raf = 0;
    const target = profileScrollByKey.get(routeKey) ?? 0;
    if (target > 0) {
      // Rows depend on async data, so the list's full height does not exist for
      // several frames; assigning scrollTop once clamps to the short content.
      let frames = 0;
      const apply = () => {
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = Math.min(target, Math.max(0, max));
        if (max < target && ++frames < 40) raf = requestAnimationFrame(apply);
      };
      apply();
    }

    const onScroll = () => { profileScrollByKey.set(routeKey, el.scrollTop); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [showSkeleton, tab, routeKey, containerRef]);

  // Stripe payout status is fetched by `useStripeConnectStatus()` inside
  // <ProfileLanding />, not here — it used to be a `useState` + `useEffect`
  // pair on this page that could not start until `profile` had been set, and
  // that re-asked Stripe on every single mount. What stays here is the other
  // half of caching it: the two moments the answer can actually have changed.
  //
  // Leaving the Payment tab is one of them — that is where the user finishes
  // (or repairs) payout onboarding, so the landing's cached "no payout
  // account" verdict is exactly what would otherwise go on lying to them.
  // Invalidating an unmounted query is fine: it marks the key stale and the
  // refetch happens when the landing next mounts.
  const prevTabRef = useRef<Tab>(tab);
  useEffect(() => {
    const leftPaymentTab = prevTabRef.current === "payment" && tab !== "payment";
    prevTabRef.current = tab;
    if (leftPaymentTab && userId) {
      queryClient.invalidateQueries({ queryKey: stripeConnectStatusKey(userId) });
    }
  }, [tab, userId, queryClient]);

  return { containerRef, pullDistance, refreshing, isPulling, canTrigger };
}

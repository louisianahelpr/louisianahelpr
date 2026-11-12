import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { fetchPostedActivity, fetchAppliedActivity, CORE_STALE } from "@/hooks/useActivityData";
import type { Job, AppliedApp } from "@/components/job-card/activityConstants";
import { backoutNoticesKey, useBackoutNotices } from "@/lib/backoutNotices";
import type { ShopOrder } from "@/lib/shops/orders";
import type { CartLine, FreeAskToPick, MyOffer } from "@/lib/declutter/api";
import type { MyRefundTodo } from "@/lib/declutter/refundRequests";
import { queryKeys } from "@/lib/queryKeys";
import { subscribeUserRealtime } from "@/lib/userRealtimeBus";
import { useFeatureStatus } from "@/hooks/useFeature";
import type { BadgeSection } from "@/lib/badgeReads";
import { loadModule, untilReload } from "@/lib/loadModule";
import { inProgressJobIds, useContinueDays } from "@/hooks/useContinueDays";
import type { TodoItem } from "./needsYouTodos";
import { buyerProblemOrderIds } from "@/lib/declutter/buyingTodo";

/**
 * HOME'S DERIVATIONS LOAD BESIDE THE DATA, NOT WITH THE FIRST DRAW (B51, 11-03, Q1158).
 *
 * The to-do list, the live job and the waiting line are derived from the activity cores, which arrive after Home's
 * first draw. Their code (needsYouTodos' derivation, nextUpStates, jobStatusLine, jobProgressState and the step
 * words) was on /home's boot download. It now loads on its own chunk, started when this module evaluates (with
 * Home's chunk, or NeedsYouBridge's on every other signed-in page). Until it is in, the hook says loading and
 * returns no to-dos, as it does before the cores answer. src/test/homeDeriveLoadsBesideData.test.ts.
 */
const homeDeriveApi = () => loadModule(() => import("./homeDerive"));
type HomeDerive = typeof import("./homeDerive");
let homeDerive: HomeDerive | null = null;
const deriveListeners = new Set<() => void>();
let deriveStarted: Promise<void> | null = null;
/** Starts the derivations' chunk once; resolves when it is in (a failed load leaves the hook loading, as loadModule's reload takes over). */
export function loadHomeDerive(): Promise<void> {
  deriveStarted ??= homeDeriveApi().then((m) => {
    if (!m) return;
    homeDerive = m;
    for (const l of deriveListeners) l();
  });
  return deriveStarted;
}
void loadHomeDerive();
const subscribeDerive = (l: () => void) => {
  deriveListeners.add(l);
  return () => {
    deriveListeners.delete(l);
  };
};
/** The derivations, or null until their chunk is in. */
export function useHomeDerive(): HomeDerive | null {
  return useSyncExternalStore(subscribeDerive, () => homeDerive, () => homeDerive);
}

// The import alone goes through Vite's preload wrapper; the read runs after it (Sentry JAVASCRIPT-54,
// src/test/dynamicImportThenDoesNoWork.test.ts).
const shopOrdersApi = () => loadModule(() => import("@/lib/shops/orders"));
// A3-81: Declutter's own cart and offers reads (the Buying / Selling tabs' sources), loaded only when signed in.
const declutterApi = () => loadModule(() => import("@/lib/declutter/api"));
// F363 (owner 11-11): open problems on my purchases (the Buying tab's own read and key, useOpenProblems).
const declutterProblemsApi = () => loadModule(() => import("@/lib/declutter/handover"));
// Blockers 7: the badge's ONE read for six sections (src/lib/badgeReads.ts, my_badge_reads).
const badgeReadsApi = () => loadModule(() => import("@/lib/badgeReads"));

/** Run a to-do: leave its step request (if any), then go (Home's Next up button and its See all rows). */
export function todoTarget(t: Pick<TodoItem, "to" | "helperStep">, request: (jobId: string, step: string) => void): string {
  if (t.helperStep) request(t.helperStep.jobId, t.helperStep.key);
  return t.to;
}

/** Realtime wake-ups are coalesced over this window (one job update can fire two topics). */
const TODO_REFRESH_DEBOUNCE_MS = 400;

const EMPTY_JOBS: Job[] = [];
const EMPTY_APPS: AppliedApp[] = [];
const EMPTY_COUNTS: Record<string, number> = {};
const EMPTY_ORDERS: ShopOrder[] = [];
const EMPTY_CART: CartLine[] = [];
const EMPTY_OFFERS: MyOffer[] = [];
const EMPTY_REFUNDS: MyRefundTodo[] = [];
const EMPTY_FREE_ASKS: FreeAskToPick[] = [];
const EMPTY_PROBLEMS: import("@/lib/declutter/declutterTodos").TodoProblem[] = [];
const EMPTY_TODOS: TodoItem[] = [];

/**
 * The to-dos for `user`, from the SAME React Query cache entries Jobs and Home
 * already read (the two activity cores, the back-out notices, my shop's
 * orders): no new query shape, and on Home (or Jobs) these are reads the
 * screen was already making. Only the cores: the activity DETAIL reads (names,
 * avatars, tracking) decide no bucket, so this never fires them.
 *
 * `live`: the one caller that stays mounted on every page (NeedsYouBridge)
 * also listens on the shared per-user channel (no channel of its own, Q105)
 * and refreshes the cores, coalesced over TODO_REFRESH_DEBOUNCE_MS and held
 * while the page is hidden (nobody can see a badge on a hidden page; Q53).
 */
export function useNeedsYouTodos(
  user: SupaUser | null,
  opts: { live?: boolean } = {},
): { todos: TodoItem[]; loading: boolean; onOldCall: (section: BadgeSection) => boolean } {
  const uid = user?.id ?? "";
  const shopsSwitch = useFeatureStatus("shops");
  const declutterSwitch = useFeatureStatus("declutter");
  const refundsSwitch = useFeatureStatus("declutter_refund_requests");
  const shopsOn = shopsSwitch.on;
  const declutterOn = declutterSwitch.on;
  const refundsOn = refundsSwitch.on;
  const queryClient = useQueryClient();
  // Blockers 7 (lead PASS 2026-11-03): ONE request for the six badge sections, seeded into each section's own key
  // (the keys below, which every screen reads). Asked only once the switches have answered, with only the sections
  // whose switch is on, so a switched-off section is never read and the read is not made twice.
  const switchesSettled = shopsSwitch.settled && declutterSwitch.settled && refundsSwitch.settled;
  const sections: BadgeSection[] = ["backout"];
  if (declutterOn) sections.push("cart", "offers", "free_asks");
  if (declutterOn && refundsOn) sections.push("refund_todos");
  if (shopsOn) sections.push("shop_orders");
  const badge = useQuery({
    queryKey: ["needs-you", "badge-reads", uid, sections.join(",")],
    queryFn: () => badgeReadsApi().then((m) => (m ? m.fetchBadgeReads(queryClient, uid, sections) : untilReload())),
    enabled: !!uid && switchesSettled,
    staleTime: CORE_STALE,
    // No retry: a failed read falls straight back to the old single calls (which keep their own retries), so the
    // badge never sits blank through a retry backoff.
    retry: false,
  });
  // A section falls back to its old single call when the one read failed, is not deployed (null), or could not
  // read that section (false): the badge never goes blank because one section broke (lead).
  const fallback = (s: BadgeSection) => switchesSettled && (badge.isError || badge.data === null || (badge.data !== undefined && badge.data[s] === false));
  const posted = useQuery({
    queryKey: uid ? queryKeys.activity.posted(uid) : ["activity", "posted", "anon"],
    queryFn: () => fetchPostedActivity(uid),
    enabled: !!uid,
    staleTime: CORE_STALE,
  });
  const applied = useQuery({
    queryKey: uid ? queryKeys.activity.applied(uid) : ["activity", "applied", "anon"],
    queryFn: () => fetchAppliedActivity(uid),
    enabled: !!uid,
    staleTime: CORE_STALE,
  });
  // My shop's incoming orders: the same query (key and fetch) the Shop dashboard reads.
  const shopOrders = useQuery({ queryKey: ["shops", "shop-orders", uid], queryFn: () => shopOrdersApi().then((m) => (m ? m.fetchShopOrders(uid) : untilReload())), enabled: !!uid && shopsOn && fallback("shop_orders") });
  // A3-81: Declutter's cart and offers, the same query keys and fetches the Buying / Selling tabs read (useDeclutterTodo).
  const dCart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: () => declutterApi().then((m) => (m ? m.fetchMyCart() : untilReload())), enabled: !!uid && declutterOn && fallback("cart"), staleTime: CORE_STALE });
  const dOffers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: () => declutterApi().then((m) => (m ? m.fetchMyOffers() : untilReload())), enabled: !!uid && declutterOn && fallback("offers"), staleTime: CORE_STALE });
  // A3-81: refund requests waiting on the member (one member-wide read) and the giver's free asks, in the same wave.
  const dRefunds = useQuery({ queryKey: ["declutter", "my-refund-todos"], queryFn: () => declutterApi().then((m) => (m ? m.fetchMyRefundTodos() : untilReload())), enabled: !!uid && declutterOn && refundsOn && fallback("refund_todos"), staleTime: CORE_STALE });
  const dFreeAsks = useQuery({ queryKey: ["declutter", "free-asks-to-pick", uid], queryFn: () => declutterApi().then((m) => (m ? m.fetchFreeAsksToPick(uid) : untilReload())), enabled: !!uid && declutterOn && fallback("free_asks"), staleTime: CORE_STALE });
  const backout = useBackoutNotices(uid || null, { enabled: fallback("backout") });
  // The sections on their old call right now: the live refresh refetches those keys itself (see refresh below).
  const onOldCall = useRef(new Set<BadgeSection>());
  onOldCall.current = new Set((["cart", "offers", "refund_todos", "free_asks", "backout", "shop_orders"] as BadgeSection[]).filter(fallback));

  const live = !!opts.live;
  useEffect(() => {
    if (!live || !uid) return;
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirtyWhileHidden = false;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.posted(uid) });
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.applied(uid) });
      // The six badge sections: ONE refetch of the badge read, which re-seeds each section's key (Blockers 7). A
      // section on its old call (fallback) is refreshed by its own observer's invalidation, as before.
      queryClient.invalidateQueries({ queryKey: ["needs-you", "badge-reads", uid] });
      const old = onOldCall.current;
      const how = (sec: BadgeSection) => (old.has(sec) ? {} : { refetchType: "none" as const });
      queryClient.invalidateQueries({ queryKey: backoutNoticesKey(uid), ...how("backout") });
      queryClient.invalidateQueries({ queryKey: ["shops", "shop-orders", uid], ...how("shop_orders") });
      queryClient.invalidateQueries({ queryKey: ["declutter", "my-cart"], ...how("cart") });
      queryClient.invalidateQueries({ queryKey: ["declutter", "my-offers"], ...how("offers") });
      queryClient.invalidateQueries({ queryKey: ["declutter", "my-refund-todos"], ...how("refund_todos") });
      queryClient.invalidateQueries({ queryKey: ["declutter", "free-asks-to-pick", uid], ...how("free_asks") });
    };
    const schedule = () => {
      if (hidden()) {
        dirtyWhileHidden = true;
        return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (hidden()) {
          dirtyWhileHidden = true;
          return;
        }
        refresh();
      }, TODO_REFRESH_DEBOUNCE_MS);
    };
    const onVisibility = () => {
      if (!hidden() && dirtyWhileHidden) {
        dirtyWhileHidden = false;
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const unsubs = [
      subscribeUserRealtime(uid, "applications:helper", schedule, { onRecovered: schedule }),
      subscribeUserRealtime(uid, "jobs:customer", schedule, { onRecovered: schedule }),
      subscribeUserRealtime(uid, "notifications:insert", schedule, { onRecovered: schedule }),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const u of unsubs) u();
    };
  }, [live, uid, queryClient]);

  // A write anywhere that invalidates one of the six section keys (a paid order, an answered offer, ...) used to
  // refetch this hook's own observer. Those observers now sit idle while the one read answers, so such an
  // invalidation refetches the one read instead: the badge stays as current as before.
  useEffect(() => {
    if (!live || !uid) return;
    const isSection = (key: readonly unknown[]) =>
      (key[0] === "declutter" && (key[1] === "my-cart" || key[1] === "my-offers" || key[1] === "my-refund-todos" || key[1] === "free-asks-to-pick")) ||
      (key[0] === "shops" && key[1] === "shop-orders") ||
      (key[0] === "activity" && key[1] === "backout");
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "invalidate" || !isSection(event.query.queryKey)) return;
      // cancelRefetch false: several keys invalidated together (the live refresh below) make ONE read, not a restart each.
      void queryClient.invalidateQueries({ queryKey: ["needs-you", "badge-reads", uid] }, { cancelRefetch: false });
    });
  }, [live, uid, queryClient]);

  const postedJobs = posted.data?.postedJobs ?? EMPTY_JOBS;
  const pending = posted.data?.pendingApplicantCounts ?? EMPTY_COUNTS;
  const apps = applied.data?.appliedApps ?? EMPTY_APPS;
  const orders = (shopsOn ? shopOrders.data : undefined) ?? EMPTY_ORDERS;
  const cartLines = (declutterOn ? dCart.data : undefined) ?? EMPTY_CART;
  const offerRows = (declutterOn ? dOffers.data : undefined) ?? EMPTY_OFFERS;
  const refundRows = (declutterOn && refundsOn ? dRefunds.data : undefined) ?? EMPTY_REFUNDS;
  const freeAskRows = (declutterOn ? dFreeAsks.data : undefined) ?? EMPTY_FREE_ASKS;
  // Owner 11-12: a seller's first payout waits on their ID check. Asked only for a member with a paid sale of their own.
  const hasPaidSale = cartLines.some((l) => l.my_side === "seller" && l.status === "paid" && l.price_cents > 0);
  const dIdWait = useQuery({
    queryKey: ["declutter", "id-payout-wait", uid],
    queryFn: () => loadModule(() => import("@/lib/declutter/idPayoutWait")).then((m) => (m ? m.fetchIdPayoutWaitCents(uid) : untilReload())),
    enabled: !!uid && declutterOn && hasPaidSale,
    staleTime: CORE_STALE,
  });
  const idPayoutCents = declutterOn && hasPaidSale ? dIdWait.data ?? 0 : 0;
  // F363 side effect (b) (owner 11-11): a seller's problem report puts the purchase under Needs you, here and on the
  // Buying tab alike. Same ids rule and key as the tab (buyerProblemOrderIds, useOpenProblems), so one read serves both.
  const problemIds = useMemo(() => buyerProblemOrderIds(cartLines), [cartLines]);
  const dProblems = useQuery({
    queryKey: ["declutter", "problems", problemIds.join(",")],
    queryFn: () => declutterProblemsApi().then((m) => (m ? m.fetchOpenProblems(problemIds) : untilReload())),
    enabled: !!uid && declutterOn && problemIds.length > 0,
    staleTime: CORE_STALE,
  });
  // Only a SELLER's report can be the buyer's move; whether their side is still missing is in the problem's own read
  // (declutter_order_problem, the order card's key), asked only for those orders (usually none).
  const sellerReported = (declutterOn && problemIds.length > 0 ? dProblems.data ?? [] : []).filter((p) => p.reporter_side === "seller");
  const problemDetails = useQueries({
    queries: sellerReported.map((p) => ({
      queryKey: ["declutter", "problem", p.order_id],
      queryFn: () => declutterProblemsApi().then((m) => (m ? m.fetchOrderProblem(p.order_id) : untilReload())),
      staleTime: CORE_STALE,
    })),
  });
  const awaitingKey = sellerReported
    .filter((_, i) => { const d = problemDetails[i]?.data; return !!d && d.status === "open" && !d.other_side_note; })
    .map((p) => p.order_id).sort().join(",");
  const problemRows = useMemo(
    () => (awaitingKey ? awaitingKey.split(",").map((order_id) => ({ order_id, reporter_side: "seller", awaits_buyer: true })) : EMPTY_PROBLEMS),
    [awaitingKey],
  );
  const continueDays = useContinueDays(inProgressJobIds([...postedJobs, ...apps.map((a) => a.job)]));
  const derive = useHomeDerive();
  const todos = useMemo(
    () => (derive ? derive.deriveNeedsYouTodos({ postedJobs, pendingApplicantCounts: pending, appliedApps: apps, shopOrders: orders, backout, declutterCart: cartLines, declutterOffers: offerRows, declutterRefunds: refundRows, declutterFreeAsks: freeAskRows, declutterProblems: problemRows, continueDays, declutterIdPayoutCents: idPayoutCents }) : EMPTY_TODOS),
    [derive, postedJobs, pending, apps, orders, backout, cartLines, offerRows, refundRows, freeAskRows, problemRows, continueDays, idPayoutCents],
  );
  // onOldCall: whether a section is on its old single call right now. Home's own reads of the same keys
  // (useHomeSummary's cart and shop orders) wait on it too, so the badge's one read is not repeated on Home.
  // Loading until BOTH sides' reads have answered (data or error): with either one alone, Home said "You're all caught
  // up" at 106 px and then grew to "Next up · 1 of 9" when the other side's to-dos landed (live lab 11-04, helper
  // persona, Fast 4G: 0.03 + 0.10 of /home's 0.38 layout shift). A failed read is not loading (isPending is false).
  return { todos, loading: !derive || posted.isPending || applied.isPending, onOldCall: fallback };
}

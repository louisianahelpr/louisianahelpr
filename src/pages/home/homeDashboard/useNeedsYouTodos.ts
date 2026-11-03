import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { fetchPostedActivity, fetchAppliedActivity, CORE_STALE } from "@/hooks/useActivityData";
import type { Job, AppliedApp } from "@/components/job-card/activityConstants";
import { backoutNoticesKey, useBackoutNotices } from "@/lib/backoutNotices";
import type { ShopOrder } from "@/lib/shops/orders";
import type { CartLine, FreeAskToPick, MyOffer } from "@/lib/declutter/api";
import type { MyRefundTodo } from "@/lib/declutter/refundRequests";
import { queryKeys } from "@/lib/queryKeys";
import { subscribeUserRealtime } from "@/lib/userRealtimeBus";
import { useFeature } from "@/hooks/useFeature";
import { loadModule, untilReload } from "@/lib/loadModule";
import { inProgressJobIds, useContinueDays } from "@/hooks/useContinueDays";
import type { TodoItem } from "./needsYouTodos";

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
export function useNeedsYouTodos(user: SupaUser | null, opts: { live?: boolean } = {}): { todos: TodoItem[]; loading: boolean } {
  const uid = user?.id ?? "";
  const shopsOn = useFeature("shops");
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
  const shopOrders = useQuery({ queryKey: ["shops", "shop-orders", uid], queryFn: () => shopOrdersApi().then((m) => (m ? m.fetchShopOrders(uid) : untilReload())), enabled: !!uid && shopsOn });
  // A3-81: Declutter's cart and offers, the same query keys and fetches the Buying / Selling tabs read (useDeclutterTodo).
  const declutterOn = useFeature("declutter");
  const dCart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: () => declutterApi().then((m) => (m ? m.fetchMyCart() : untilReload())), enabled: !!uid && declutterOn, staleTime: CORE_STALE });
  const dOffers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: () => declutterApi().then((m) => (m ? m.fetchMyOffers() : untilReload())), enabled: !!uid && declutterOn, staleTime: CORE_STALE });
  // A3-81: refund requests waiting on the member (one member-wide read) and the giver's free asks, in the same wave.
  const refundsOn = useFeature("declutter_refund_requests");
  const dRefunds = useQuery({ queryKey: ["declutter", "my-refund-todos"], queryFn: () => declutterApi().then((m) => (m ? m.fetchMyRefundTodos() : untilReload())), enabled: !!uid && declutterOn && refundsOn, staleTime: CORE_STALE });
  const dFreeAsks = useQuery({ queryKey: ["declutter", "free-asks-to-pick", uid], queryFn: () => declutterApi().then((m) => (m ? m.fetchFreeAsksToPick(uid) : untilReload())), enabled: !!uid && declutterOn, staleTime: CORE_STALE });
  const backout = useBackoutNotices(uid || null);

  const queryClient = useQueryClient();
  const live = !!opts.live;
  useEffect(() => {
    if (!live || !uid) return;
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirtyWhileHidden = false;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.posted(uid) });
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.applied(uid) });
      queryClient.invalidateQueries({ queryKey: backoutNoticesKey(uid) });
      queryClient.invalidateQueries({ queryKey: ["shops", "shop-orders", uid] });
      queryClient.invalidateQueries({ queryKey: ["declutter", "my-cart"] });
      queryClient.invalidateQueries({ queryKey: ["declutter", "my-offers"] });
      queryClient.invalidateQueries({ queryKey: ["declutter", "my-refund-todos"] });
      queryClient.invalidateQueries({ queryKey: ["declutter", "free-asks-to-pick", uid] });
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

  const postedJobs = posted.data?.postedJobs ?? EMPTY_JOBS;
  const pending = posted.data?.pendingApplicantCounts ?? EMPTY_COUNTS;
  const apps = applied.data?.appliedApps ?? EMPTY_APPS;
  const orders = (shopsOn ? shopOrders.data : undefined) ?? EMPTY_ORDERS;
  const cartLines = (declutterOn ? dCart.data : undefined) ?? EMPTY_CART;
  const offerRows = (declutterOn ? dOffers.data : undefined) ?? EMPTY_OFFERS;
  const refundRows = (declutterOn && refundsOn ? dRefunds.data : undefined) ?? EMPTY_REFUNDS;
  const freeAskRows = (declutterOn ? dFreeAsks.data : undefined) ?? EMPTY_FREE_ASKS;
  const continueDays = useContinueDays(inProgressJobIds([...postedJobs, ...apps.map((a) => a.job)]));
  const derive = useHomeDerive();
  const todos = useMemo(
    () => (derive ? derive.deriveNeedsYouTodos({ postedJobs, pendingApplicantCounts: pending, appliedApps: apps, shopOrders: orders, backout, declutterCart: cartLines, declutterOffers: offerRows, declutterRefunds: refundRows, declutterFreeAsks: freeAskRows, continueDays }) : EMPTY_TODOS),
    [derive, postedJobs, pending, apps, orders, backout, cartLines, offerRows, refundRows, freeAskRows, continueDays],
  );
  return { todos, loading: !derive || (posted.data === undefined && applied.data === undefined) };
}

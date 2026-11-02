import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useActivityData } from "@/hooks/useActivityData";
import { postedActivityBucket, appliedActivityBucket } from "@/components/job-card/activityFilters";
import { loadModule, untilReload } from "@/lib/loadModule";
// Declutter / Shops / Rentals reads load with their query, not with Home (AUD31-60/66, the /home cut B84 measured):
// a section that is off, or a member with nothing there, never downloads that section's data code.
// B87: Home's two Declutter reads have their own small module (myReads.ts): through api.ts this import fetched
// signed-in-pages and its ~150 KB gz closure beside the dock. src/test/homeLazyReadsStayLight.test.ts.
const declutterApi = () => loadModule(() => import("@/lib/declutter/myReads"));
const shopOrdersApi = () => loadModule(() => import("@/lib/shops/orders"));
// Only the import goes through Vite's preload wrapper: a read made INSIDE `import(...).then(...)` runs inside it, so
// its failure is dispatched as vite:preloadError (a chunk-reload) and, prevented, resolves undefined (Sentry
// JAVASCRIPT-54, '["shops","mine"] data is undefined'). Guard: src/test/dynamicImportThenDoesNoWork.test.ts.
const rentalsApi = () => loadModule(() => import("@/lib/rentals/api"));
const handoverApi = () => loadModule(() => import("@/lib/declutter/handover"));
// The section cards' live counts load after Home has painted (owner request 2026-11-01): their module and reads.
const nearCountsApi = () => loadModule(() => import("./sectionNearCounts"));
import { whenPageSettled } from "@/lib/routePrefetch";
import { useFeature } from "@/hooks/useFeature";
import { useNeedsYouTodos } from "./needsYouTodos";
import { deriveLiveNow, deriveWaiting } from "./nextUpStates";
import { deriveComingUp, type ComingUpItem } from "./comingUp";

const DAY = 86_400_000;
/** Board 7 and board 11 both show four Coming up rows. */
const COMING_UP_MAX = 4;

/**
 * The both-sides invitation a Home section card shows when nothing real is
 * there yet (HELPR-DESIGN-SPEC v2 §1.5 + §5.5, board 19): never a "0".
 */
export const SECTION_INVITE = {
  jobs: "Hire help or find work",
  declutter: "Sell or find a deal",
  shops: "Shop local or open a shop",
  homes: "Find a place or list one",
} as const;

/**
 * A section card's one line from REAL counts: only the non-zero ones, joined
 * ("2 need you · 1 in progress"). All zero -> null, and the card shows its
 * SECTION_INVITE instead (lead review 2026-10-20: no big "0 need you").
 */
export function countLine(parts: ReadonlyArray<readonly [number, string, string?]>): string | null {
  const shown = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : (many ?? one)}`);
  return shown.length ? shown.join(" · ") : null;
}

/**
 * The Jobs and Declutter cards' lines with their live counts (owner request 2026-11-01): Jobs keeps "N need you" when
 * something needs the member, otherwise "N open near you"; Declutter says "N items near you". A count that is 0 or
 * not in yet keeps the card's current line (its own counts, or the invitation), so a card never looks empty and the
 * line only changes once, when the count arrives.
 */
export function sectionCardLines(
  current: { jobs: string | null; declutter: string | null },
  jobTodos: number,
  near: { jobs?: number; declutter?: number },
): { jobs: string | null; declutter: string | null } {
  const jobsNear = jobTodos === 0 && (near.jobs ?? 0) > 0 ? `${near.jobs} open near you` : null;
  const declutterNear = (near.declutter ?? 0) > 0 ? `${near.declutter} ${near.declutter === 1 ? "item" : "items"} near you` : null;
  return { jobs: jobsNear ?? current.jobs, declutter: declutterNear ?? current.declutter };
}

/** True once the page has finished loading (routePrefetch's whenPageSettled): the cards' counts wait for it. */
function usePageSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => whenPageSettled(() => setSettled(true), 300, 4000), []);
  return settled;
}

/**
 * Home's numbers, all from data the section screens already read (no new
 * query shape): the poster's and helper's activity (the same buckets Jobs
 * uses), the member's Declutter listings, Shops orders and Homes properties.
 * A section whose switch is off for the viewer is never queried.
 */
const BOOKED_STATUSES: ReadonlySet<string> = new Set(["accepted", "in_progress", "revision_requested"]);

/** A job of mine, either side, with a Helpr booked on it and not finished (JA-36). */
export function hasBookedJob(postedJobs: readonly { status: string; helper_id?: string | null; is_group_job?: boolean | null }[], appliedApps: readonly { helper_id?: string | null; job?: { status: string; helper_id?: string | null } | null }[]): boolean {
  return postedJobs.some((j) => BOOKED_STATUSES.has(j.status) && (!!j.helper_id || j.is_group_job === true))
    || appliedApps.some((a) => !!a.job && BOOKED_STATUSES.has(a.job.status) && !!a.helper_id && a.job.helper_id === a.helper_id);
}

export function useHomeSummary(user: SupaUser | null) {
  const posted = useActivityData(user, "posted");
  const applied = useActivityData(user, "applied");
  const declutterOn = useFeature("declutter");
  const shopsOn = useFeature("shops");
  const homesOn = useFeature("rentals");
  const uid = user?.id ?? "";
  const declutter = useQuery({ queryKey: ["declutter", "mine", uid], queryFn: () => declutterApi().then((m) => (m ? m.fetchMyItems(uid) : untilReload())), enabled: !!uid && declutterOn });
  const orders = useQuery({ queryKey: ["shops", "my-orders", uid], queryFn: () => shopOrdersApi().then((m) => (m ? m.fetchMyOrders(uid) : untilReload())), enabled: !!uid && shopsOn });
  // The to-do list is the ONE the nav badges count (badge = To-do, owner 2026-10-20).
  const { todos } = useNeedsYouTodos(user);
  const homes = useQuery({ queryKey: ["rentals", "my-properties", uid], queryFn: () => rentalsApi().then((m) => (m ? m.fetchMyProperties(uid) : untilReload())), enabled: !!uid && homesOn });
  // Coming up's Declutter pickups and shop orders: the SAME reads (keys and fetches) the Buying/Selling
  // tabs and the Shop dashboard make, so Home adds no query shape.
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: () => declutterApi().then((m) => (m ? m.fetchMyCart() : untilReload())), enabled: !!uid && declutterOn });
  const paidIds = [...new Set((cart.data ?? []).filter((l) => l.status === "paid" && l.order_id).map((l) => l.order_id!))];
  const bookings = useQuery({ queryKey: ["declutter", "bookings", paidIds.join(",")], queryFn: () => handoverApi().then((m) => (m ? m.fetchMyBookings(paidIds) : untilReload())), enabled: paidIds.length > 0 });
  const shopOrders = useQuery({ queryKey: ["shops", "shop-orders", uid], queryFn: () => shopOrdersApi().then((m) => (m ? m.fetchShopOrders(uid) : untilReload())), enabled: !!uid && shopsOn });
  // Live "near you" counts for the Jobs and Declutter cards: head-only count reads, started after first paint.
  const settled = usePageSettled();
  const appliedIds = useMemo(() => [...new Set((applied.appliedApps ?? []).map((a) => a.job_id))].sort(), [applied.appliedApps]);
  const jobsNear = useQuery({
    queryKey: ["home", "jobs-open-near", uid, appliedIds],
    queryFn: () => nearCountsApi().then((m) => (m ? m.fetchOpenJobsNearCount(uid, appliedIds) : untilReload())),
    enabled: !!uid && settled && !applied.loading,
    staleTime: 60_000,
  });
  const declutterNear = useQuery({
    queryKey: ["home", "declutter-near", uid],
    queryFn: () => nearCountsApi().then((m) => (m ? m.fetchDeclutterNearCount(uid) : untilReload())),
    enabled: !!uid && settled && declutterOn,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const now = Date.now();
    const pj = posted.postedJobs ?? [];
    const aa = applied.appliedApps ?? [];
    const postedUpcoming = pj.filter((j) => postedActivityBucket(j, posted.pendingApplicantCounts?.[j.id] ?? 0) === "scheduled");
    // You tab's Posted tile (board 18) counts every live post: waiting for applicants or booked.
    const postedLive = pj.filter((j) => ["waiting", "scheduled"].includes(postedActivityBucket(j, posted.pendingApplicantCounts?.[j.id] ?? 0)));
    const appliedLive = aa.filter((a) => a.job && appliedActivityBucket(a) === "scheduled");
    const jobTodos = todos.filter((t) => t.section === "jobs").length;
    const shopTodos = todos.filter((t) => t.section === "shops").length;

    const upcoming: ComingUpItem[] = deriveComingUp({
      postedJobs: pj,
      appliedApps: aa,
      cart: (declutterOn ? cart.data : undefined) ?? [],
      bookings: bookings.data ?? [],
      myOrders: (shopsOn ? orders.data : undefined) ?? [],
      shopOrders: (shopsOn ? shopOrders.data : undefined) ?? [],
    }, now);
    const thisWeek = upcoming.filter((c) => c.at < now + 7 * DAY).length;
    // A failed read is not "nothing booked" (spec v2 §1.5): Home says it could not load instead.
    const upcomingFailed = posted.loadError || applied.loadError || cart.isError || bookings.isError || orders.isError || shopOrders.isError;

    const items = declutter.data ?? [];
    const myOrders = (orders.data ?? []).filter((o) => o.status === "held" || o.status === "accepted");
    const props = homes.data ?? [];

    // Board 165: a job happening now sits above Next up. Board 83: with nothing to do, who is up (never the live job again).
    const liveNow = deriveLiveNow(pj, aa, posted.helperNames ?? {});
    return {
      loading: posted.loading && applied.loading,
      todos,
      liveNow,
      waiting: todos.length ? null : deriveWaiting(pj, posted.pendingApplicantCounts ?? {}, aa, liveNow?.jobId ?? null, posted.helperNames ?? {}),
      thisWeek,
      upcoming: upcoming.slice(0, COMING_UP_MAX),
      upcomingFailed,
      // JA-36 (audit 11-01): a booked job is live (on the way, under way) but not in Coming up: the empty line says
      // "Nothing else booked", never "Nothing booked yet" under that very job.
      hasBookedJob: hasBookedJob(pj, aa),
      // A3-82 (audit 11-01): a member who sells or buys on Declutter is not new to the app: never the Jobs checklist.
      usesDeclutter: items.length > 0 || (cart.data ?? []).length > 0,
      // You tab's activity tiles (board 18): real counts, 0 = no number shown.
      counts: {
        posted: postedLive.length,
        working: appliedLive.length,
        selling: items.filter((i) => i.status === "live").length,
        shopOrders: myOrders.length,
      },
      tiles: {
        // H5 (Cowork audit 2026-10-20): "N in progress" counted open jobs still
        // WAITING for applicants as in progress. The second count is the jobs that
        // are booked and ahead of you, in the Jobs status boxes' own word.
        ...sectionCardLines(
          {
            jobs: countLine([[jobTodos, "needs you", "need you"], [postedUpcoming.length + appliedLive.length, "upcoming"]]),
            declutter: countLine([[items.filter((i) => i.status === "live").length, "listed"], [items.filter((i) => i.status === "pending_review").length, "in review"]]),
          },
          jobTodos,
          { jobs: jobsNear.data, declutter: declutterOn ? declutterNear.data : undefined },
        ),
        shops: countLine([[shopTodos, "to answer"], [myOrders.length, "open order", "open orders"]]),
        homes: countLine([[props.length, "property", "properties"]]),
      },
    };
  }, [posted.postedJobs, posted.pendingApplicantCounts, posted.helperNames, posted.loading, posted.loadError, applied.appliedApps, applied.loading, applied.loadError, declutter.data, orders.data, orders.isError, todos, homes.data, declutterOn, shopsOn, cart.data, cart.isError, bookings.data, bookings.isError, shopOrders.data, shopOrders.isError, jobsNear.data, declutterNear.data]);
}

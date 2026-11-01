import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useActivityData } from "@/hooks/useActivityData";
import { postedActivityBucket, appliedActivityBucket } from "@/components/job-card/activityFilters";
// Declutter / Shops / Rentals reads load with their query, not with Home (AUD31-60/66, the /home cut B84 measured):
// a section that is off, or a member with nothing there, never downloads that section's data code.
const declutterApi = () => import("@/lib/declutter/api");
const shopOrdersApi = () => import("@/lib/shops/orders");
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
 * Home's numbers, all from data the section screens already read (no new
 * query shape): the poster's and helper's activity (the same buckets Jobs
 * uses), the member's Declutter listings, Shops orders and Homes properties.
 * A section whose switch is off for the viewer is never queried.
 */
export function useHomeSummary(user: SupaUser | null) {
  const posted = useActivityData(user, "posted");
  const applied = useActivityData(user, "applied");
  const declutterOn = useFeature("declutter");
  const shopsOn = useFeature("shops");
  const homesOn = useFeature("rentals");
  const uid = user?.id ?? "";
  const declutter = useQuery({ queryKey: ["declutter", "mine", uid], queryFn: () => declutterApi().then((m) => m.fetchMyItems(uid)), enabled: !!uid && declutterOn });
  const orders = useQuery({ queryKey: ["shops", "my-orders", uid], queryFn: () => shopOrdersApi().then((m) => m.fetchMyOrders(uid)), enabled: !!uid && shopsOn });
  // The to-do list is the ONE the nav badges count (badge = To-do, owner 2026-10-20).
  const { todos } = useNeedsYouTodos(user);
  const homes = useQuery({ queryKey: ["rentals", "my-properties", uid], queryFn: () => import("@/lib/rentals/api").then((m) => m.fetchMyProperties(uid)), enabled: !!uid && homesOn });
  // Coming up's Declutter pickups and shop orders: the SAME reads (keys and fetches) the Buying/Selling
  // tabs and the Shop dashboard make, so Home adds no query shape.
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: () => declutterApi().then((m) => m.fetchMyCart()), enabled: !!uid && declutterOn });
  const paidIds = [...new Set((cart.data ?? []).filter((l) => l.status === "paid" && l.order_id).map((l) => l.order_id!))];
  const bookings = useQuery({ queryKey: ["declutter", "bookings", paidIds.join(",")], queryFn: () => import("@/lib/declutter/handover").then((m) => m.fetchMyBookings(paidIds)), enabled: paidIds.length > 0 });
  const shopOrders = useQuery({ queryKey: ["shops", "shop-orders", uid], queryFn: () => shopOrdersApi().then((m) => m.fetchShopOrders(uid)), enabled: !!uid && shopsOn });

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
    const liveNow = deriveLiveNow(pj, aa);
    return {
      loading: posted.loading && applied.loading,
      todos,
      liveNow,
      waiting: todos.length ? null : deriveWaiting(pj, posted.pendingApplicantCounts ?? {}, aa, liveNow?.jobId ?? null),
      thisWeek,
      upcoming: upcoming.slice(0, COMING_UP_MAX),
      upcomingFailed,
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
        jobs: countLine([[jobTodos, "need you"], [postedUpcoming.length + appliedLive.length, "upcoming"]]),
        declutter: countLine([[items.filter((i) => i.status === "live").length, "listed"], [items.filter((i) => i.status === "pending_review").length, "in review"]]),
        shops: countLine([[shopTodos, "to answer"], [myOrders.length, "open order", "open orders"]]),
        homes: countLine([[props.length, "property", "properties"]]),
      },
    };
  }, [posted.postedJobs, posted.pendingApplicantCounts, posted.loading, posted.loadError, applied.appliedApps, applied.loading, applied.loadError, declutter.data, orders.data, orders.isError, todos, homes.data, declutterOn, shopsOn, cart.data, cart.isError, bookings.data, bookings.isError, shopOrders.data, shopOrders.isError]);
}

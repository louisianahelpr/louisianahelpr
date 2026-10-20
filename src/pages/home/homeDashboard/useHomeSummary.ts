import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useActivityData } from "@/hooks/useActivityData";
import { postedActivityBucket, appliedActivityBucket } from "@/components/job-card/activityFilters";
import type { Job } from "@/components/job-card/activityConstants";
import { fetchMyItems } from "@/lib/declutter/api";
import { fetchMyOrders } from "@/lib/shops/orders";
import { fetchMyProperties } from "@/lib/rentals/api";
import { useFeature } from "@/hooks/useFeature";
import { useNeedsYouTodos } from "./needsYouTodos";

export interface ComingUpItem {
  id: string;
  job: Job;
  role: "posted" | "working";
}

const DAY = 86_400_000;

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
  const declutter = useQuery({ queryKey: ["declutter", "mine", uid], queryFn: () => fetchMyItems(uid), enabled: !!uid && declutterOn });
  const orders = useQuery({ queryKey: ["shops", "my-orders", uid], queryFn: () => fetchMyOrders(uid), enabled: !!uid && shopsOn });
  // The to-do list is the ONE the nav badges count (badge = To-do, owner 2026-10-20).
  const { todos } = useNeedsYouTodos(user);
  const homes = useQuery({ queryKey: ["rentals", "my-properties", uid], queryFn: () => fetchMyProperties(uid), enabled: !!uid && homesOn });

  return useMemo(() => {
    const now = Date.now();
    const pj = posted.postedJobs ?? [];
    const aa = applied.appliedApps ?? [];
    const postedUpcoming = pj.filter((j) => postedActivityBucket(j, posted.pendingApplicantCounts?.[j.id] ?? 0) === "scheduled");
    const appliedLive = aa.filter((a) => a.job && appliedActivityBucket(a) === "scheduled");
    const jobTodos = todos.filter((t) => t.section === "jobs").length;
    const shopTodos = todos.filter((t) => t.section === "shops").length;

    const upcoming: ComingUpItem[] = [
      ...pj.filter((j) => postedActivityBucket(j, 0) === "scheduled").map((job) => ({ id: `p-${job.id}`, job, role: "posted" as const })),
      ...appliedLive.map((a) => ({ id: `a-${a.id}`, job: a.job!, role: "working" as const })),
    ]
      .filter((c) => c.job.date_needed && new Date(c.job.date_needed).getTime() >= now - DAY)
      .sort((x, y) => new Date(x.job.date_needed).getTime() - new Date(y.job.date_needed).getTime());
    const thisWeek = upcoming.filter((c) => new Date(c.job.date_needed).getTime() < now + 7 * DAY).length;

    const items = declutter.data ?? [];
    const myOrders = (orders.data ?? []).filter((o) => o.status === "held" || o.status === "accepted");
    const props = homes.data ?? [];

    return {
      loading: posted.loading && applied.loading,
      todos,
      thisWeek,
      upcoming: upcoming.slice(0, 3),
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
  }, [posted.postedJobs, posted.pendingApplicantCounts, posted.loading, applied.appliedApps, applied.loading, declutter.data, orders.data, todos, homes.data]);
}

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

export interface TodoItem {
  id: string;
  title: string;
  meta: string;
  to: string;
}

export interface ComingUpItem {
  id: string;
  job: Job;
  role: "posted" | "working";
}

const DAY = 86_400_000;

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
  const homes = useQuery({ queryKey: ["rentals", "my-properties", uid], queryFn: () => fetchMyProperties(uid), enabled: !!uid && homesOn });

  return useMemo(() => {
    const now = Date.now();
    const pj = posted.postedJobs ?? [];
    const aa = applied.appliedApps ?? [];
    const postedNeeds = pj.filter((j) => postedActivityBucket(j, posted.pendingApplicantCounts?.[j.id] ?? 0) === "needs_you");
    const appliedNeeds = aa.filter((a) => appliedActivityBucket(a) === "needs_you" && a.job);
    const postedLive = pj.filter((j) => ["waiting", "scheduled"].includes(postedActivityBucket(j, posted.pendingApplicantCounts?.[j.id] ?? 0)));
    const appliedLive = aa.filter((a) => a.job && appliedActivityBucket(a) === "scheduled");

    const todos: TodoItem[] = [
      ...postedNeeds.map((j) => ({ id: `p-${j.id}`, title: j.title, meta: (posted.pendingApplicantCounts?.[j.id] ?? 0) > 0 ? `Jobs I posted · ${posted.pendingApplicantCounts[j.id]} to review` : "Jobs I posted · needs you", to: `/jobs?tab=posted&status=needs_you` })),
      ...appliedNeeds.map((a) => ({ id: `a-${a.id}`, title: a.job!.title, meta: "Jobs I'm working · needs you", to: `/jobs?tab=working&status=needs_you` })),
    ];

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
      tiles: {
        jobs: { n: postedNeeds.length + appliedNeeds.length, label: "need you", second: `${postedLive.length + appliedLive.length} in progress` },
        declutter: { n: items.filter((i) => i.status === "live").length, label: "live", second: `${items.filter((i) => i.status === "pending_review").length} in review` },
        shops: { n: myOrders.length, label: myOrders.length === 1 ? "open order" : "open orders", second: "Browse shops near you" },
        homes: { n: props.length, label: props.length === 1 ? "property" : "properties", second: props.length ? "Repairs and tenants" : "Add a property or rent" },
      },
    };
  }, [posted.postedJobs, posted.pendingApplicantCounts, posted.loading, applied.appliedApps, applied.loading, declutter.data, orders.data, homes.data]);
}

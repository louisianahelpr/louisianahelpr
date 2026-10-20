import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { fetchPostedActivity, fetchAppliedActivity, CORE_STALE } from "@/hooks/useActivityData";
import { postedActivityBucket, appliedActivityBucket, jobIsUnfundedDraft } from "@/components/job-card/activityFilters";
import type { Job, AppliedApp } from "@/components/job-card/activityConstants";
import { backoutNoticeApplies, backoutNoticesKey, useBackoutNotices, type BackoutNotice } from "@/lib/backoutNotices";
import { fetchShopOrders, formatCents, type ShopOrder } from "@/lib/shops/orders";
import { queryKeys } from "@/lib/queryKeys";
import { subscribeUserRealtime } from "@/lib/userRealtimeBus";
import { useFeature } from "@/hooks/useFeature";

export interface TodoItem {
  id: string;
  /** Which section the to-do belongs to: the nav counts are per section. */
  section: "jobs" | "shops";
  title: string;
  meta: string;
  to: string;
  /** The Next up card's one button (sentence case). */
  action: string;
  /** A real amount tied to the task (rust on Home); omitted when there is none. */
  money?: string;
}

export interface NeedsYouInputs {
  postedJobs: readonly Job[];
  pendingApplicantCounts: Readonly<Record<string, number>>;
  appliedApps: readonly AppliedApp[];
  shopOrders: readonly ShopOrder[];
  backout: ReadonlyMap<string, BackoutNotice>;
}

/** An open back-out notice rides on its job, as useActivityData does it (Q1575). */
function withBackout<J extends { id: string; status?: string | null }>(j: J, backout: ReadonlyMap<string, BackoutNotice>): J {
  const open = backout.get(j.id);
  return open && backoutNoticeApplies(open.backout_kind, j.status) ? { ...j, backout_notice: open } : j;
}

/**
 * THE TO-DO LIST, ONE ENTRY PER JOB OR ORDER THAT NEEDS YOU (owner, 2026-10-20:
 * badge = To-do). Home's Next up / To do, the Explore badge and the sidebar
 * counts all read this, so they cannot disagree. A job with 21 new applicants
 * is ONE to-do ("Review 21 applicants"), never 21. Never-paid jobs are left
 * out exactly as My Posts leaves them out (jobIsUnfundedDraft, Q1734): a count
 * must point at something the member can open.
 */
export function deriveNeedsYouTodos(i: NeedsYouInputs): TodoItem[] {
  const posted = i.postedJobs.filter((j) => !jobIsUnfundedDraft(j)).map((j) => withBackout(j, i.backout));
  const applied = i.appliedApps.map((a) => (a.job ? { ...a, job: withBackout(a.job, i.backout) } : a));
  const postedNeeds = posted.filter((j) => postedActivityBucket(j, i.pendingApplicantCounts[j.id] ?? 0) === "needs_you");
  const appliedNeeds = applied.filter((a) => a.job && appliedActivityBucket(a) === "needs_you");
  // Orders waiting for MY SHOP's answer, soonest deadline first: each one lapses at accept_by.
  const shopWaiting = i.shopOrders
    .filter((o) => o.status === "held")
    .slice()
    .sort((x, y) => new Date(x.accept_by ?? 0).getTime() - new Date(y.accept_by ?? 0).getTime());
  // Every side of every section in one list (never role-based): orders to answer first (they expire),
  // then jobs I posted, then jobs I'm working.
  return [
    ...shopWaiting.map((o) => ({
      id: `s-${o.id}`,
      section: "shops" as const,
      title: `Answer an order for ${o.shop_order_lines?.[0]?.title ?? "your shop"}`,
      meta: "My shop · waiting for your answer",
      to: "/shops/dashboard",
      action: "Answer order",
      money: formatCents(o.total_cents),
    })),
    ...postedNeeds.map((j) => {
      const n = i.pendingApplicantCounts[j.id] ?? 0;
      return {
        id: `p-${j.id}`,
        section: "jobs" as const,
        title: j.title,
        meta: n > 0 ? `Jobs I posted · ${n} to review` : "Jobs I posted · needs you",
        to: `/jobs?tab=posted&filter=needs_you`,
        action: n > 0 ? (n === 1 ? "Review 1 applicant" : `Review ${n} applicants`) : "Open job",
      };
    }),
    ...appliedNeeds.map((a) => ({
      id: `a-${a.id}`,
      section: "jobs" as const,
      title: a.job!.title,
      meta: "Jobs I'm working · needs you",
      to: `/jobs?tab=working&filter=needs_you`,
      action: "Open job",
    })),
  ];
}

/** Realtime wake-ups are coalesced over this window (one job update can fire two topics). */
const TODO_REFRESH_DEBOUNCE_MS = 400;

const EMPTY_JOBS: Job[] = [];
const EMPTY_APPS: AppliedApp[] = [];
const EMPTY_COUNTS: Record<string, number> = {};
const EMPTY_ORDERS: ShopOrder[] = [];

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
  const shopOrders = useQuery({ queryKey: ["shops", "shop-orders", uid], queryFn: () => fetchShopOrders(uid), enabled: !!uid && shopsOn });
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
  const todos = useMemo(
    () => deriveNeedsYouTodos({ postedJobs, pendingApplicantCounts: pending, appliedApps: apps, shopOrders: orders, backout }),
    [postedJobs, pending, apps, orders, backout],
  );
  return { todos, loading: posted.data === undefined && applied.data === undefined };
}

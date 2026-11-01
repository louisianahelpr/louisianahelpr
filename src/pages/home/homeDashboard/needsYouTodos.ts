import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { fetchPostedActivity, fetchAppliedActivity, CORE_STALE } from "@/hooks/useActivityData";
import { postedActivityBucket, appliedActivityBucket, jobIsUnfundedDraft } from "@/components/job-card/activityFilters";
import type { Job, AppliedApp } from "@/components/job-card/activityConstants";
import { backoutNoticeApplies, backoutNoticesKey, useBackoutNotices, type BackoutNotice } from "@/lib/backoutNotices";
import type { ShopOrder } from "@/lib/shops/orders";
import { formatCents } from "@/lib/shops/formatCents";
import { queryKeys } from "@/lib/queryKeys";
import { subscribeUserRealtime } from "@/lib/userRealtimeBus";
import { useFeature } from "@/hooks/useFeature";
import { posterStatusLine, helperStatusLine, type JobStatusLine } from "@/components/job-card/jobStatusLine";
import { jobStartTarget } from "@/components/job-card/CountdownRows";
// The import alone goes through Vite's preload wrapper; the read runs after it (Sentry JAVASCRIPT-54,
// src/test/dynamicImportThenDoesNoWork.test.ts).
const shopOrdersApi = () => import("@/lib/shops/orders");

export interface TodoItem {
  id: string;
  /** Which section the to-do belongs to: the nav counts are per section. */
  section: "jobs" | "shops";
  /** The TASK (spec v2 §5.2: "title = the task"), never just the job's name. */
  title: string;
  /** Which side you are on, then the job or order it is about ("You hired · Mow the lawn"). */
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

const HOUR = 3_600_000;

/** Spec v2 §5.2 tier 2: someone is waiting on the member (applicants, an offer, an order, a finished job). */
const POSTER_SOMEONE_WAITING = new Set(["applicants", "approve", "revision_fixed", "confirm_arrival"]);
const HELPER_SOMEONE_WAITING = new Set(["offer", "confirm_booking", "confirm_spot", "revision"]);

/**
 * When a to-do's clock runs out, if it has one STILL AHEAD: the status line's
 * own countdown (the one the card shows), else the job's start when that is
 * still to come. A passed clock is not a deadline any more (the card says
 * "expired" or the job is overdue), so it does not jump the queue.
 */
function dueAt(line: JobStatusLine, job: Pick<Job, "date_needed" | "start_time">, now: number): number | null {
  const clock = line.deadline?.at ? Date.parse(line.deadline.at) : NaN;
  if (Number.isFinite(clock) && clock >= now) return clock;
  const start = jobStartTarget(job.date_needed, job.start_time)?.getTime() ?? NaN;
  return Number.isFinite(start) && start >= now ? start : null;
}

/** A job's date for tier 4 ("everything else, by date"); undated last. */
const jobDateMs = (job: Pick<Job, "date_needed" | "start_time">) => jobStartTarget(job.date_needed, job.start_time)?.getTime() ?? Infinity;

/**
 * NEXT UP RANKING (spec v2 §5.2): (1) a deadline in under 24 hours, soonest
 * first; (2) someone waiting on the member; (3) money waiting on the member;
 * (4) everything else, by date. Ties keep the list's order. Every to-do's tier
 * comes from the SAME status line its card shows, so Home never ranks a step
 * the card does not name.
 *
 * Tier 3 has no source among today's to-dos: its examples are Homes rent and
 * Shops pay-to-confirm, neither of which makes a to-do yet, and a Jobs
 * payment that failed is a never-paid job, which is never a to-do
 * (jobIsUnfundedDraft). The tier number is kept so a new source slots in.
 */
function rank(due: number | null, waiting: boolean, date: number, now: number): [number, number] {
  if (due !== null && due - now < 24 * HOUR) return [1, due];
  if (waiting) return [2, due ?? date];
  return [4, due ?? date];
}

/**
 * THE TO-DO LIST, ONE ENTRY PER JOB OR ORDER THAT NEEDS YOU (owner, 2026-10-20:
 * badge = To-do). Home's Next up / To do, the Explore badge and the sidebar
 * counts all read this, so they cannot disagree. A job with 21 new applicants
 * is ONE to-do ("Review 21 applicants"), never 21. Never-paid jobs are left
 * out exactly as My Posts leaves them out (jobIsUnfundedDraft, Q1734): a count
 * must point at something the member can open.
 */
export function deriveNeedsYouTodos(i: NeedsYouInputs, now: number = Date.now()): TodoItem[] {
  const posted = i.postedJobs.filter((j) => !jobIsUnfundedDraft(j)).map((j) => withBackout(j, i.backout));
  const applied = i.appliedApps.map((a) => (a.job ? { ...a, job: withBackout(a.job, i.backout) } : a));
  const postedNeeds = posted.filter((j) => postedActivityBucket(j, i.pendingApplicantCounts[j.id] ?? 0) === "needs_you");
  const appliedNeeds = applied.filter((a) => a.job && appliedActivityBucket(a) === "needs_you");
  // Orders waiting for MY SHOP's answer, soonest deadline first: each one lapses at accept_by.
  const shopWaiting = i.shopOrders
    .filter((o) => o.status === "held")
    .slice()
    .sort((x, y) => new Date(x.accept_by ?? 0).getTime() - new Date(y.accept_by ?? 0).getTime());
  // Every side of every section in one list (never role-based), ranked by spec v2 §5.2 (rank above).
  // An order to answer lapses at accept_by (24 hours), so a live one is always tier 1.
  const ranked: { item: TodoItem; tier: number; at: number }[] = [];
  for (const o of shopWaiting) {
    const due = o.accept_by ? Date.parse(o.accept_by) : NaN;
    const [tier, at] = rank(Number.isFinite(due) && due >= now ? due : null, true, Infinity, now);
    ranked.push({
      tier,
      at,
      item: {
        id: `s-${o.id}`,
        section: "shops",
        title: `Answer an order for ${o.shop_order_lines?.[0]?.title ?? "your shop"}`,
        meta: "Your shop · waiting for your answer",
        to: "/shops/dashboard",
        action: "Answer order",
        money: formatCents(o.total_cents),
      },
    });
  }
  // The task is the job card's own status sentence (jobStatusLine), so Home and the
  // card never name a different step of one job (boards 7, 83, 165).
  for (const j of postedNeeds) {
    const n = i.pendingApplicantCounts[j.id] ?? 0;
    const line = posterStatusLine(j, n, new Date(now));
    const [tier, at] = rank(dueAt(line, j, now), n > 0 || POSTER_SOMEONE_WAITING.has(line.id), jobDateMs(j), now);
    ranked.push({
      tier,
      at,
      item: {
        id: `p-${j.id}`,
        section: "jobs",
        title: n > 0 ? (n === 1 ? "Review 1 applicant" : `Review ${n} applicants`) : line.detail,
        meta: `${j.helper_id ? "You hired" : "You posted"} · ${j.title}`,
        // "Open job" opens THE job (audit #12, 2026-10-21); the applicant
        // review still lands on the Posted list where applicants are handled.
        to: n > 0 ? `/jobs?tab=posted&filter=needs_you` : `/jobs/${j.id}`,
        action: n > 0 ? "See applicants" : "Open job",
      },
    });
  }
  for (const a of appliedNeeds) {
    const line = helperStatusLine(a);
    const [tier, at] = rank(dueAt(line, a.job!, now), HELPER_SOMEONE_WAITING.has(line.id), jobDateMs(a.job!), now);
    ranked.push({
      tier,
      at,
      item: {
        id: `a-${a.id}`,
        section: "jobs",
        title: line.detail,
        meta: `${a.job!.helper_id ? "You're working" : "You applied"} · ${a.job!.title}`,
        to: `/jobs/${a.job!.id}`,
        action: "Open job",
      },
    });
  }
  // Array.prototype.sort is stable: equal ranks keep the order above.
  return ranked.sort((x, y) => x.tier - y.tier || x.at - y.at).map((r) => r.item);
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
  const shopOrders = useQuery({ queryKey: ["shops", "shop-orders", uid], queryFn: () => shopOrdersApi().then((m) => m.fetchShopOrders(uid)), enabled: !!uid && shopsOn });
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

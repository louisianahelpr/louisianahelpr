import { useCallback, useEffect, useMemo } from "react";
import { formatName } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { fetchRatingStats } from "@/lib/reviewStats";
import { parseLocalDate } from "@/lib/dateUtils";
import { useQuery, useInfiniteQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { report } from "@/lib/errorLogger";
import { queryKeys } from "@/lib/queryKeys";
import { PERSIST_MAX_AGE_MS } from "@/lib/queryPersister";
import { TIER_PERKS, tierFeePercent } from "@/lib/subscriptionTiers";
import { earlyAccessDelayMs, resolveEarlyAccessTier } from "@/lib/earlyAccess";

// Cursor-based pagination over the open-jobs feed. Page size kept small so the
// initial paint stays cheap as the marketplace grows; later pages are fetched
// on demand by the dashboard's IntersectionObserver sentinel.
const PAGE_SIZE = 25;

/**
 * Split one raw `open_jobs_browse` response into this page's rows and "is
 * there another page" — in that order, which is the entire point.
 *
 * `hasMore` MUST be read off what the SERVER returned, BEFORE any client-side
 * filtering. It used to be computed after the blocked-poster filter had run:
 *
 *     const rawAll = rows.filter((j) => !blockedUserIds.has(j.customer_id));
 *     const hasMore = rawAll.length > PAGE_SIZE;   // ← the bug
 *
 * The query asks for PAGE_SIZE + 1 rows (`.range(offset, offset + PAGE_SIZE)`,
 * inclusive both ends) precisely so a full response means "at least one more
 * row exists". Drop one row from it for any client-side reason and the
 * response is PAGE_SIZE long, `25 > 25` is false, `nextOffset` comes back
 * null, and React Query's `getNextPageParam` treats the feed as finished —
 * permanently, for the rest of the session, because no later fetch ever runs
 * to correct it. So a SINGLE blocked poster anywhere in the first page capped
 * the dashboard at 25 jobs, silently: no error, the feed just ends early and
 * looks exactly like the end of the list.
 *
 * The probe row is also dropped BEFORE the block filter rather than after.
 * Page boundaries are server-index based (`offset` advances by PAGE_SIZE
 * regardless of what the client removed), so filtering first and slicing
 * second lets the probe row slide into this page and then render AGAIN as the
 * first row of the next one.
 */
export function splitFeedPage<T>(
  serverRows: T[],
  isBlocked: (row: T) => boolean,
): { rows: T[]; hasMore: boolean } {
  const hasMore = serverRows.length > PAGE_SIZE;
  const pageRows = hasMore ? serverRows.slice(0, PAGE_SIZE) : serverRows;
  return { rows: pageRows.filter((row) => !isBlocked(row)), hasMore };
}

// Hard ceiling on each network phase of the feed fetch. Without it a stalled
// connection leaves the dashboard spinning indefinitely; on timeout we reject
// so React Query surfaces the existing ErrorState (with its manual retry).
const JOBS_QUERY_TIMEOUT_MS = 12_000;

const withTimeout = <T,>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

interface JobsPage {
  jobs: EnrichedJob[];
  nextOffset: number | null;
}

type DashboardContext = Awaited<ReturnType<typeof fetchDashboardContext>>;

/** Per-user dashboard context (fee / availability / applied set / blocks).
 *
 *  Hoisted to module scope so the feed query can RACE it via
 *  queryClient.ensureQueryData instead of waiting a whole round-trip for it.
 *  None of these four values is needed to ISSUE the jobs request — only to
 *  filter the rows it returns — so gating the feed on `!!ctx` cost one full
 *  serial network round (~215ms measured) before the first card could paint.
 */
async function fetchDashboardContext(
  userId: string | null,
) {
  if (!userId) return null;
    // Wrap in try/catch so a network-level failure in any of the four
    // sub-queries is surfaced via report() (PostHog + error_logs) instead
    // of a silent partial state. We RETHROW so React Query flips into its
    // error state — callers downstream depend on `ctx` being either
    // fully-formed or absent.
    let feeRes, availRes, appliedRes, blocksRes;
    try {
      [feeRes, availRes, appliedRes, blocksRes] = await Promise.all([
        supabase.rpc("get_public_platform_settings"),
        supabase
          .from("helper_availability")
          .select("day_of_week, is_available, start_time, end_time")
          .eq("helper_id", userId)
          .is("specific_date", null)
          .order("day_of_week"),
        supabase
          .from("applications")
          .select("job_id")
          .eq("helper_id", userId),
        supabase
          .from("user_blocks")
          .select("blocker_id, blocked_id")
          .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      ]);
    } catch (ctxErr) {
      report(ctxErr, {
        // "error" not "warning" — this throw bricks the dashboard for every
        // signed-in user. The Sentry alert rule for `permission denied for`
        // (added 2026-05-28 after PR #355 / #358 missed paging on exactly
        // this code path) filters on level=error, so leaving it at warning
        // re-creates the silent-regression we just paid for.
        severity: "error",
        tags: { source: "dashboard.ctx_query" },
        context: { user_id: userId },
      });
      throw ctxErr;
    }

    // Promise.all doesn't reject on Supabase PostgrestError shapes — those
    // come back as { data: null, error }. Spot-check each result so we
    // don't silently treat a failed sub-query as "empty" — and so PostHog/
    // error_logs sees the real PostgrestError next time this fires.
    const subResults = [
      { sub: "get_public_platform_settings", error: feeRes.error },
      { sub: "helper_availability", error: availRes.error },
      { sub: "applications", error: appliedRes.error },
      { sub: "user_blocks", error: blocksRes.error },
    ];
    for (const { sub, error } of subResults) {
      if (!error) continue;
      report(new Error(`dashboard.ctx sub-query failed: ${sub}: ${error.message ?? "unknown"}`), {
        // Promoted from "warning" — the get_public_platform_settings RPC
        // here is the same one that bricks the post-job form (see
        // usePostJobForm.ts). Treat any subquery failure on the dashboard
        // ctx fetch as a real error so the new "permission denied for"
        // alert rule catches it.
        severity: "error",
        tags: { source: "dashboard.ctx_subquery", sub },
        context: {
          user_id: userId,
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }
    // Don't throw on sub-errors — degrade gracefully. Empty defaults
    // below give the user a usable dashboard (no availability flag, no
    // blocks, etc.) instead of an outright error state.

    const feeRow = Array.isArray(feeRes.data) ? (feeRes.data)[0] : null;
    // Fall back to the canonical FREE-tier rate (12%), not a magic 10 — a
    // helper with no fee row is on the free plan, and the subscription page
    // already advertises free = 12% / pro = 10% / elite = 8% (LH-30).
    const platformFee = feeRow?.helper_fee_percent ?? TIER_PERKS.free.platformFeePercent;
    const helperAvailability = availRes.data ?? [];
    const appliedJobIds = new Set((appliedRes.data ?? []).map((a) => a.job_id));
    const blockedUserIds = new Set<string>();
    for (const row of (blocksRes.data ?? [])) {
      if (row.blocker_id === userId) blockedUserIds.add(row.blocked_id);
      if (row.blocked_id === userId) blockedUserIds.add(row.blocker_id);
    }
    return { platformFee, helperAvailability, appliedJobIds, blockedUserIds };
}

export function useDashboardData() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, profile, isAdmin, isLoading: userLoading, refresh: refreshCurrentUser } = useCurrentUser();

  // Redirect denied users (non-admin). Pending users stay on the dashboard so
  // they see the in-page "Profile under review" state with a Check Status
  // button and realtime updates from useCurrentUser.
  useEffect(() => {
    if (userLoading || isAdmin || !profile) return;
    if (profile.approval_status === "denied") navigate("/account-denied");
  }, [profile, isAdmin, userLoading, navigate]);

  // Lightweight per-user context (settings + availability + applied jobs + blocks).
  // Cached separately so it doesn't re-fetch when the next page of jobs loads.
  const { data: ctx, isLoading: ctxLoading, isFetching: ctxFetching } = useQuery({
    queryKey: queryKeys.dashboard.context(user?.id),
    queryFn: () => fetchDashboardContext(user?.id ?? null),
    enabled: !!user && !userLoading,
    // SWR window for the dashboard ctx (settings / availability / applied set
    // / blocks). 2 minutes is generous enough that tab-switching back to the
    // dashboard within a quick errand always serves cache instantly while
    // refetchOnWindowFocus (queryClient.ts default) keeps it fresh after the
    // user returns from a long context switch.
    staleTime: 2 * 60 * 1000,
    // Reach the 24h persisted-cache window so the ctx (fee / availability /
    // applied set / blocks) survives a cold start alongside the feed.
    gcTime: PERSIST_MAX_AGE_MS,
    // Hold the prior ctx during a background refetch rather than briefly
    // returning undefined (which would make the feed query re-disable).
    placeholderData: keepPreviousData,
  });

  // Paginated open-jobs feed. Each page = 25 raw rows + per-page enrichment.
  const {
    data: pagesData,
    isLoading: jobsLoading,
    isError: jobsError,
    isFetching: jobsFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.dashboard.jobs(user?.id),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<JobsPage> => {
      const offset = pageParam as number;
      // The ctx fetch (fee / availability / applied set / blocks) is only
      // needed to FILTER the rows below — never to ISSUE the jobs request. So
      // kick it off here and await it *after* the jobs query is already in
      // flight, so the two rounds overlap instead of stacking. This query used
      // to carry `enabled: !!ctx`, which serialised them and cost a full extra
      // network round (~215ms measured RTT) before the first card could paint.
      // ensureQueryData dedupes against the ctx useQuery above, so this never
      // fires a second request.
      //
      // A ctx failure must not brick the feed — it only costs the applied /
      // blocked filters, and the ctx useQuery surfaces the error separately.
      const ctxSettled: Promise<DashboardContext> = user
        ? queryClient
            .ensureQueryData({
              queryKey: queryKeys.dashboard.context(user.id),
              queryFn: () => fetchDashboardContext(user.id),
              staleTime: 2 * 60 * 1000,
            })
            .catch(() => null)
        : Promise.resolve(null);

      // Phase 1: jobs page. Range is inclusive on both ends, so request
      // PAGE_SIZE + 1 rows to know whether another page exists without a count.
      //
      // We query the curated `open_jobs_browse` view (masks precise location).
      // If it errors, we report() and rethrow so React Query surfaces the
      // honest error state to the user. (An earlier version had a fallback
      // direct-`jobs` query, but `public.jobs` SELECT policies are
      // participant-scoped — customer_id / helper_id / admin / offered_to_helper_id
      // — so a typical browsing helper saw only jobs they posted themselves
      // or were directly offered. Effectively empty, more confusing than the
      // honest ErrorState.)
      // Early access: subscription tiers shave time off a 20-minute delay on
      // brand-new jobs (free=20, Basic=15, Pro=10, Elite=0).
      //
      // THIS IS NO LONGER THE GATE. The perk is enforced inside
      // `open_jobs_browse` itself, against `public.early_access_cutoff()`
      // (migration 20260901022522) — the same authority `/jobs`
      // (get_ranked_open_jobs) and the map (get_open_jobs_for_map) compare
      // against. It had to move: a `.lte()` the client attaches is a `.lte()`
      // the client can delete, and everybody browsing already holds the anon
      // key, so the paid perk was one hand-rolled PostgREST call away from
      // free. DO NOT re-promote this line to "the gate" — if you need to
      // change who gets early access, change the SQL function.
      //
      // The cutoff below stays only as a redundant PRE-filter. It can subtract
      // rows the server already allowed, never add one, so at worst it agrees
      // with the server and at best it keeps behaviour correct in the window
      // between this commit landing and db-deploy finishing. It is computed
      // from the same `resolveEarlyAccessTier` + `earlyAccessDelayMs` pair the
      // SQL mirrors (null expiry = ACTIVE, matching tierFeePercent), so the two
      // layers cannot disagree; Elite resolves to a 0ms delay (cutoff === now),
      // which passes every already-created job.
      //
      // profile is read from the outer useDashboardData scope (always
      // current-user's profile). Default to free-tier when profile is
      // still loading — safer than accidentally granting early access.
      const effectiveTier = resolveEarlyAccessTier(
        profile?.subscription_tier,
        profile?.subscription_expires_at,
      );
      const earlyAccessCutoff = new Date(
        Date.now() - earlyAccessDelayMs(effectiveTier),
      ).toISOString();

      let rawJobsRes: any[];
      try {
        // Build query — early-access filter applied conditionally.
        const baseQuery = supabase
          .from("open_jobs_browse")
          .select(
            // NOTE: open_jobs_browse view does NOT expose latitude/longitude
            // (the underlying jobs table has them, but the view masks them
            // along with the precise location). Asking for them returned a
            // PostgREST 400 that silently emptied the dashboard. The
            // nearby-radius filter falls back to the location string match.
            "id, title, description, category, budget, date_needed, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status, location, pricing_mode, applicant_count",
          )
          .neq("payment_status", "abandoned");

        // Redundant pre-filter, NOT the gate — see the long note above the
        // cutoff. The view already refuses these rows server-side.
        const filteredQuery = baseQuery.lte("created_at", earlyAccessCutoff);

        rawJobsRes = unwrap(await withTimeout(filteredQuery
          .order("boosted_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE), JOBS_QUERY_TIMEOUT_MS, "Loading tasks timed out")) as any[];
      } catch (viewErr) {
        report(viewErr, {
          // "error" — a thrown open_jobs_browse query bricks the entire
          // BrowseTasksFeed for every signed-in user (PR #355 / #358
          // symptom). The 2026-05-28 alert rule for "permission denied for"
          // filters on level=error.
          severity: "error",
          tags: { area: "dashboard.open_jobs_browse_error" },
          context: { offset, user_id: user?.id ?? null },
        });
        throw viewErr;
      }

      // Both rounds are done by now — join them here, not before the fetch.
      const ctxData = await ctxSettled;
      const blockedUserIds = ctxData?.blockedUserIds ?? new Set<string>();
      const appliedJobIds = ctxData?.appliedJobIds ?? new Set<string>();

      const { rows: rawJobs, hasMore } = splitFeedPage(
        (rawJobsRes ?? []) as any[],
        (j) => blockedUserIds.has(j.customer_id),
      );

      if (rawJobs.length === 0) {
        // An empty page is NOT the end of the feed. Every row on it can be a
        // blocked poster, and the filters below can empty it for applied-to /
        // expired / past-dated rows too. Hand back the server's own answer so
        // the scroll sentinel fetches the NEXT page instead of stopping here —
        // returning a hardcoded null was the same "client-side filtering ends
        // pagination" defect as the one splitFeedPage documents.
        return { jobs: [], nextOffset: hasMore ? offset + PAGE_SIZE : null };
      }

      // Phase 2: enrich page with poster names + review stats + subscription tier (for Search Priority).
      const posterIds = [...new Set(rawJobs.map((j) => j.customer_id))];
      const [profilesRes, reviewStatsMap, posterTiersRes] = await withTimeout(Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        fetchRatingStats(posterIds),
        supabase
          .from("profiles")
          .select("user_id, subscription_tier, subscription_expires_at")
          .in("user_id", posterIds),
      ]), JOBS_QUERY_TIMEOUT_MS, "Loading tasks timed out");

      const nameMap = new Map(
        profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || [],
      );
      const avatarMap = new Map<string, string | null>(
        profilesRes.data?.map((p) => [p.user_id, p.avatar_url ?? null]) || [],
      );
      // Poster ID-verified flag — get_safe_profiles gained is_id_verified in
      // migration 20260616120000. Until that migration is pushed the RPC
      // returns rows without the field, so read it via an optional cast and
      // default to false → the "Verified" badge simply stays hidden.
      const verifiedMap = new Map<string, boolean>(
        profilesRes.data?.map((p) => [
          p.user_id,
          (p as { is_id_verified?: boolean }).is_id_verified ?? false,
        ]) || [],
      );
      // Applicant counts now come straight off the main feed select —
      // `applicant_count` has been live on the open_jobs_browse view since
      // migration 20260616120000 (verified present on prod), so the separate
      // best-effort round-trip that used to re-query the same view for the
      // same rows is gone.
      const applicantCountMap = new Map<string, number>(
        rawJobs.map((j) => [j.id as string, (j.applicant_count as number | null) ?? 0]),
      );

      // Build poster tier map — only count tier if subscription hasn't expired
      const nowDate = new Date();
      const posterTierMap = new Map<string, string | null>();
      for (const p of posterTiersRes.data ?? []) {
        const expired = p.subscription_expires_at ? new Date(p.subscription_expires_at) < nowDate : false;
        posterTierMap.set(p.user_id, expired ? null : (p.subscription_tier ?? null));
      }

      const now = new Date();
      // Start of today (local) — a one-off job whose date has already passed
      // is stale and must drop out of the feed even if its expires_at is null
      // or still in the future. Flexible-schedule and recurring jobs have no
      // single hard date, so they're exempt from the past-date cull.
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const enriched: EnrichedJob[] = rawJobs
        .filter((j) => !appliedJobIds.has(j.id))
        .filter((j) => !j.expires_at || new Date(j.expires_at) > now)
        .filter((j) => {
          if (j.is_flexible_schedule || j.is_recurring || !j.date_needed) return true;
          const d = parseLocalDate(j.date_needed);
          return isNaN(d.getTime()) || d >= startOfToday;
        })
        .map((j) => {
          const isBoosted = !!j.boost_expires_at && new Date(j.boost_expires_at) > now;
          const stats = reviewStatsMap.get(j.customer_id);
          return {
            ...j,
            posterName: nameMap.get(j.customer_id) || "a neighbor",
            posterAvatarUrl: avatarMap.get(j.customer_id) ?? null,
            posterReviewCount: stats?.count ?? 0,
            posterAvgRating: stats?.avg ?? 0,
            posterCompletedJobs: 0,
            posterSubscriptionTier: posterTierMap.get(j.customer_id) ?? null,
            isBoosted,
            applicant_count: applicantCountMap.get(j.id) ?? 0,
            posterIdVerified: verifiedMap.get(j.customer_id) ?? false,
          };
        });

      // NO poster-tier re-sort here any more, deliberately.
      //
      // This used to end with an unbounded `tierWeight` sort (elite 3, pro 1,
      // else 0) that lifted every Elite poster's job above everything else
      // outright. It was wrong twice over. It was an OVERRIDE of the signals a
      // browsing helper actually needs — freshness, budget, distance — on the
      // surface where they are the customer of the ranking. And it never
      // reached the screen anyway: `useDashboardFilters` re-ranks `allJobs`
      // through `sortJobsSmart`, whose only tie-break is input index, and
      // `smartScore` is continuous, so exact ties essentially never happen and
      // this ordering was discarded on every render. Same defect, same shape,
      // as the applicant list's discarded tier sort (applicantScoring.ts).
      //
      // The perk still exists — it is now a BOUNDED term inside `smartScore`
      // (`POSTER_PLACEMENT_MAX_POINTS`, capped under the smallest discrete
      // signal that scorer awards), where it survives the downstream sort and
      // cannot outrank a genuinely better-matched job. `posterSubscriptionTier`
      // is set above and is what that term reads. Re-adding a sort here would
      // not reinforce it; it would be silently thrown away again.
      return { jobs: enriched, nextOffset: hasMore ? offset + PAGE_SIZE : null };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    // NOTE: deliberately NOT gated on `!!ctx` — see the ensureQueryData race
    // in the queryFn above. Gating here made the feed wait a full round-trip
    // for data it only uses to filter the response.
    enabled: !!user && !userLoading,
    // Spotty rural/coastal signal: a background refetch (window-focus,
    // pull-to-refresh) keeps the LAST successful feed on screen with a quiet
    // updating state instead of collapsing to skeletons mid-scroll. Only the
    // very first ever load shows the loader. See queryClient.ts / queryPersister.ts.
    placeholderData: keepPreviousData,
    // Fail fast on a timeout — the ErrorState already offers a manual retry,
    // so don't make the user wait through 2 silent auto-retries (~36s). Other
    // transient errors keep the default retry behavior.
    retry: (failureCount, error) =>
      error instanceof Error && error.message === "Loading tasks timed out"
        ? false
        : failureCount < 2,
    // SWR — same 2-minute fresh window as ctx above. Pages loaded on the last
    // visit stay fresh long enough that the user lands on a populated feed
    // instantly on re-entry; refetchOnWindowFocus (queryClient.ts default)
    // backgrounds the swap if the marketplace moved while they were away.
    // Hand-off pattern mirrors useProfileTabData.ts (PR #426).
    staleTime: 2 * 60 * 1000,
    // gcTime must reach the persisted-cache window (24h) or TanStack evicts
    // the feed from memory before the disk persister can keep it alive across
    // a cold start — defeating the instant-render-on-return goal. See
    // PERSIST_MAX_AGE_MS in src/lib/queryPersister.ts.
    gcTime: PERSIST_MAX_AGE_MS,
    // No refetchInterval: on an infinite query it refetches EVERY loaded
    // page (~16 queries each) on a timer. The feed stays fresh via
    // refetchOnWindowFocus (frequent on mobile) and the dashboard's
    // pull-to-refresh — both far cheaper than an all-pages poll.
  });

  // Pro tier — separate lightweight query so it doesn't block dashboard
  const { data: proData } = useQuery({
    queryKey: queryKeys.dashboard.proTier(user?.id),
    queryFn: async () => {
      // unwrap surfaces an edge-function failure as the query's error state
      // instead of silently treating the user as a non-subscriber.
      const data = unwrap(await supabase.functions.invoke("check-pro-subscription"));
      return data?.subscribed ? (data.tier as string) : null;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Flatten loaded pages into a single array for downstream filtering/sorting.
  const allJobs = useMemo<EnrichedJob[]>(
    () => (pagesData?.pages ?? []).flatMap((p) => p.jobs),
    [pagesData],
  );

  // Recommended jobs derived from currently-loaded pages so the section grows
  // organically as the user scrolls — no extra query.
  const recommendedJobs = useMemo<EnrichedJob[]>(() => {
    if (!profile || !user) return [];
    const userId = user.id;
    const userSkills = (profile.skills || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    const userLoc = (profile.location || "").toLowerCase();
    return allJobs
      .filter((j) => j.customer_id !== userId)
      .map((j) => {
        let score = 0;
        // `location` is nullable since 20260901033011 — deleting an account
        // anonymises the poster's jobs, and the street address goes with them.
        // An address-less job just scores no location point; it is not a match
        // for every `userLoc` and it must not throw here.
        if (userLoc && j.location?.toLowerCase().includes(userLoc)) score += 2;
        if (
          userSkills.some(
            (s) => j.category.includes(s) || j.title.toLowerCase().includes(s) || j.description.toLowerCase().includes(s),
          )
        ) {
          score += 3;
        }
        return { job: j, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.job);
  }, [allJobs, profile, user]);

  const refresh = useCallback(async () => {
    await Promise.all([
      refreshCurrentUser(),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.context(user?.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.jobs(user?.id) }),
    ]);
  }, [user, queryClient, refreshCurrentUser]);

  const loading = userLoading || !profile || ctxLoading || (jobsLoading && allJobs.length === 0);
  // True when a background refetch is in flight on top of already-rendered
  // cache (the "revalidate" half of stale-while-revalidate). The Dashboard
  // header uses this to render a small pulsing dot — proof the feed is
  // syncing without blanking the surface. We deliberately exclude
  // `isFetchingNextPage` because the load-more spinner already covers it.
  const isRefreshing =
    (jobsFetching && !jobsLoading && !isFetchingNextPage && allJobs.length > 0) ||
    (ctxFetching && !ctxLoading);

  // Helper commission shown on the dashboard (ApplyEarningsBreakdown) is the
  // VIEWER's own tiered rate, not the global platform_settings.helper_fee_percent
  // — a Pro helper sees their real 10% (Basic 11%, Elite 8%), matching what the
  // payout resolver charges (`_shared/helperFees.ts`). Derived from the already-
  // loaded profile, so no extra fetch; reverts an expired paid tier to free. Falls
  // back to the ctx (global) fee, then the free rate, until the profile row is
  // available — never 0%, which would over-promise earnings ("you keep 100%").
  const viewerFeePercent = useMemo(
    () => tierFeePercent(profile?.subscription_tier, profile?.subscription_expires_at),
    [profile?.subscription_tier, profile?.subscription_expires_at],
  );

  return {
    user,
    profile,
    isAdmin,
    loading,
    helprTier: proData ?? null,
    allJobs,
    platformFee: profile ? viewerFeePercent : (ctx?.platformFee ?? TIER_PERKS.free.platformFeePercent),
    helperAvailability: ctx?.helperAvailability ?? [],
    recommendedJobs,
    refresh,
    // True once the open-jobs feed fetch has failed (first page).
    loadError: jobsError,
    // Background-refetch indicator — stale-while-revalidate signal.
    isRefreshing,
    // Pagination controls consumed by the dashboard scroll sentinel
    fetchNextPage,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
  };
}

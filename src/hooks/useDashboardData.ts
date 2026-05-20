import { useCallback, useEffect, useMemo } from "react";
import { formatName } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { aggregateRatings } from "@/lib/reviewStats";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { report } from "@/lib/errorLogger";

// Columns shared by the curated `open_jobs_browse` view AND the fallback
// direct-`jobs` query. Kept as a single string constant so both code paths
// request exactly the same shape — drift here would crash the enrichment.
// NOTE: `open_jobs_browse` masks latitude/longitude (security feature). The
// fallback path queries `jobs` directly but still omits lat/lng + leaves the
// `location` string blank, so the precise-location masking is preserved even
// when the curated view is unavailable (we'd rather show jobs with no
// location than leak a precise address).
const JOB_COLUMNS_SHARED =
  "id, title, description, category, budget, date_needed, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status";

// Cursor-based pagination over the open-jobs feed. Page size kept small so the
// initial paint stays cheap as the marketplace grows; later pages are fetched
// on demand by the dashboard's IntersectionObserver sentinel.
const PAGE_SIZE = 25;

interface JobsPage {
  jobs: EnrichedJob[];
  nextOffset: number | null;
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
  const { data: ctx, isLoading: ctxLoading } = useQuery({
    queryKey: ["dashboardContext", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const userId = user.id;
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
          severity: "warning",
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
          severity: "warning",
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
      const platformFee = feeRow?.helper_fee_percent ?? 10;
      const helperAvailability = availRes.data ?? [];
      const appliedJobIds = new Set((appliedRes.data ?? []).map((a) => a.job_id));
      const blockedUserIds = new Set<string>();
      for (const row of (blocksRes.data ?? [])) {
        if (row.blocker_id === userId) blockedUserIds.add(row.blocked_id);
        if (row.blocked_id === userId) blockedUserIds.add(row.blocker_id);
      }
      return { platformFee, helperAvailability, appliedJobIds, blockedUserIds };
    },
    enabled: !!user && !userLoading,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  // Paginated open-jobs feed. Each page = 25 raw rows + per-page enrichment.
  const {
    data: pagesData,
    isLoading: jobsLoading,
    isError: jobsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["dashboardJobs", user?.id],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<JobsPage> => {
      const offset = pageParam as number;
      const blockedUserIds = ctx?.blockedUserIds ?? new Set<string>();
      const appliedJobIds = ctx?.appliedJobIds ?? new Set<string>();

      // Phase 1: jobs page. Range is inclusive on both ends, so request
      // PAGE_SIZE + 1 rows to know whether another page exists without a count.
      //
      // Two-stage fetch:
      //   1) Try the curated `open_jobs_browse` view (masks precise location).
      //   2) If that errors for ANY reason (view dropped, RLS regression,
      //      transient PostgREST hiccup), fall back to a direct `jobs`
      //      query so the user still sees something — and report() the
      //      real error so we can see PostgrestError + status in
      //      PostHog / error_logs next time it fires.
      // Without (2) the dashboard renders ErrorState ("couldn't load
      // nearby jobs") on any view-side failure, which is what TestFlight
      // user is currently seeing.
      let rawJobsRes: any[];
      try {
        rawJobsRes = unwrap(await supabase
          .from("open_jobs_browse")
          .select(
            // NOTE: open_jobs_browse view does NOT expose latitude/longitude
            // (the underlying jobs table has them, but the view masks them
            // along with the precise location). Asking for them returned a
            // PostgREST 400 that silently emptied the dashboard. The
            // nearby-radius filter falls back to the location string match.
            `${JOB_COLUMNS_SHARED}, location`,
          )
          .neq("payment_status", "abandoned")
          .order("boosted_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE)) as any[];
      } catch (viewErr) {
        report(viewErr, {
          severity: "warning",
          tags: { source: "dashboard.open_jobs_browse_error" },
          context: {
            offset,
            user_id: user?.id ?? null,
            // err message often includes the PostgrestError code +
            // hint; redact() in errorLogger handles JWT/token redaction.
            message: viewErr instanceof Error ? viewErr.message : String(viewErr),
          },
        });
        // Fallback: query `jobs` table directly. Same status filter as the
        // view (status = 'open' + payment_status != 'abandoned'). We omit
        // `location` from the select (the view's whole purpose is to mask
        // precise location, so leaking it from the fallback would defeat
        // that). Downstream code coerces missing location → "" below.
        const fallbackRows = unwrap(await supabase
          .from("jobs")
          .select(JOB_COLUMNS_SHARED)
          .eq("status", "open")
          .neq("payment_status", "abandoned")
          .order("boosted_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE)) as any[];
        // Strip / blank the location field on every row. `EnrichedJob.location`
        // is typed as `string` (non-optional) and downstream UI reads
        // `j.location.toLowerCase()` etc., so empty string keeps everything
        // safe instead of `undefined` crashing the recommended-jobs scorer.
        rawJobsRes = (fallbackRows ?? []).map((j: any) => ({ ...j, location: "" }));
      }

      const rawAll = ((rawJobsRes ?? []) as any[]).filter((j) => !blockedUserIds.has(j.customer_id));
      const hasMore = rawAll.length > PAGE_SIZE;
      const rawJobs = hasMore ? rawAll.slice(0, PAGE_SIZE) : rawAll;

      if (rawJobs.length === 0) {
        return { jobs: [], nextOffset: null };
      }

      // Phase 2: enrich page with poster names + review stats + subscription tier (for Search Priority).
      const posterIds = [...new Set(rawJobs.map((j) => j.customer_id))];
      const [profilesRes, reviewsRes, posterTiersRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        supabase
          .from("reviews")
          .select("reviewee_id, rating, jobs!inner(status)")
          .in("reviewee_id", posterIds)
          .neq("jobs.status", "cancelled"),
        supabase
          .from("profiles")
          .select("user_id, subscription_tier, subscription_expires_at")
          .in("user_id", posterIds),
      ]);

      const nameMap = new Map(
        profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || [],
      );
      const avatarMap = new Map<string, string | null>(
        profilesRes.data?.map((p) => [p.user_id, p.avatar_url ?? null]) || [],
      );

      // Build poster tier map — only count tier if subscription hasn't expired
      const nowDate = new Date();
      const posterTierMap = new Map<string, string | null>();
      for (const p of posterTiersRes.data ?? []) {
        const expired = p.subscription_expires_at ? new Date(p.subscription_expires_at) < nowDate : false;
        posterTierMap.set(p.user_id, expired ? null : (p.subscription_tier ?? null));
      }

      const reviewStatsMap = aggregateRatings(reviewsRes.data);

      const now = new Date();
      const enriched: EnrichedJob[] = rawJobs
        .filter((j) => !appliedJobIds.has(j.id))
        .filter((j) => !j.expires_at || new Date(j.expires_at) > now)
        .map((j) => {
          const isBoosted = !!j.boost_expires_at && new Date(j.boost_expires_at) > now;
          const stats = reviewStatsMap.get(j.customer_id);
          return {
            ...j,
            posterName: nameMap.get(j.customer_id) || "User",
            posterAvatarUrl: avatarMap.get(j.customer_id) ?? null,
            posterReviewCount: stats?.count ?? 0,
            posterAvgRating: stats?.avg ?? 0,
            posterCompletedJobs: 0,
            posterSubscriptionTier: posterTierMap.get(j.customer_id) ?? null,
            isBoosted,
          };
        });

      // Auto-bump: within the existing newest-first order, lift Elite-
      // posted jobs to the top, then Pro-posted, then everything else.
      // Stable sort preserves the boosted ordering inside each tier band
      // (already applied by the SQL ORDER BY boosted_at).
      const tierWeight = (tier: string | null | undefined) =>
        tier === "elite" ? 2 : tier === "pro" ? 1 : 0;
      enriched.sort((a, b) => tierWeight(b.posterSubscriptionTier) - tierWeight(a.posterSubscriptionTier));

      return { jobs: enriched, nextOffset: hasMore ? offset + PAGE_SIZE : null };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: !!user && !userLoading && !!ctx,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    // No refetchInterval: on an infinite query it refetches EVERY loaded
    // page (~16 queries each) on a timer. The feed stays fresh via
    // refetchOnWindowFocus (frequent on mobile) and the dashboard's
    // pull-to-refresh — both far cheaper than an all-pages poll.
  });

  // Pro tier — separate lightweight query so it doesn't block dashboard
  const { data: proData } = useQuery({
    queryKey: ["proTier", user?.id],
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
        if (userLoc && j.location.toLowerCase().includes(userLoc)) score += 2;
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
      queryClient.invalidateQueries({ queryKey: ["dashboardContext", user?.id] }),
      queryClient.invalidateQueries({ queryKey: ["dashboardJobs", user?.id] }),
    ]);
  }, [user, queryClient, refreshCurrentUser]);

  const loading = userLoading || !profile || ctxLoading || (jobsLoading && allJobs.length === 0);

  return {
    user,
    profile,
    isAdmin,
    loading,
    helprTier: proData ?? null,
    allJobs,
    platformFee: ctx?.platformFee ?? 0,
    helperAvailability: ctx?.helperAvailability ?? [],
    recommendedJobs,
    refresh,
    // True once the open-jobs feed fetch has failed (first page).
    loadError: jobsError,
    // Pagination controls consumed by the dashboard scroll sentinel
    fetchNextPage,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
  };
}

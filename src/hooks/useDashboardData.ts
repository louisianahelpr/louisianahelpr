import { useCallback, useEffect, useMemo } from "react";
import { formatName } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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
  const { user, profile, isAdmin, isLoading: userLoading } = useCurrentUser();

  // Redirect denied/pending users (non-admin) — in an effect, not during render
  useEffect(() => {
    if (userLoading || isAdmin || !profile) return;
    if (profile.approval_status === "pending") navigate("/account-pending");
    if (profile.approval_status === "denied") navigate("/account-denied");
  }, [profile, isAdmin, userLoading, navigate]);

  // Lightweight per-user context (settings + availability + applied jobs + blocks).
  // Cached separately so it doesn't re-fetch when the next page of jobs loads.
  const { data: ctx, isLoading: ctxLoading } = useQuery({
    queryKey: ["dashboardContext", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const userId = user.id;
      const [feeRes, availRes, appliedRes, blocksRes] = await Promise.all([
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
          .from("user_blocks" as any)
          .select("blocker_id, blocked_id")
          .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      ]);

      const feeRow = Array.isArray(feeRes.data) ? (feeRes.data as any[])[0] : null;
      const platformFee = feeRow?.helper_fee_percent ?? 10;
      const helperAvailability = availRes.data ?? [];
      const appliedJobIds = new Set((appliedRes.data ?? []).map((a) => a.job_id));
      const blockedUserIds = new Set<string>();
      for (const row of (blocksRes.data ?? []) as any[]) {
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
      const { data: rawJobsRes } = await supabase
        .from("open_jobs_browse" as any)
        .select(
          "id, title, description, category, budget, date_needed, location, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status",
        )
        .neq("payment_status", "abandoned")
        .order("boosted_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE);

      const rawAll = ((rawJobsRes ?? []) as any[]).filter((j) => !blockedUserIds.has(j.customer_id));
      const hasMore = rawAll.length > PAGE_SIZE;
      const rawJobs = hasMore ? rawAll.slice(0, PAGE_SIZE) : rawAll;

      if (rawJobs.length === 0) {
        return { jobs: [], nextOffset: null };
      }

      // Phase 2: enrich page with poster names + review stats.
      const posterIds = [...new Set(rawJobs.map((j) => j.customer_id))];
      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        supabase
          .from("reviews")
          .select("reviewee_id, rating, jobs!inner(status)")
          .in("reviewee_id", posterIds)
          .neq("jobs.status", "cancelled"),
      ]);

      const nameMap = new Map(
        profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || [],
      );

      const reviewStatsMap = new Map<string, { count: number; avg: number }>();
      for (const r of reviewsRes.data ?? []) {
        const existing = reviewStatsMap.get(r.reviewee_id);
        if (existing) {
          existing.count += 1;
          existing.avg = (existing.avg * (existing.count - 1) + r.rating) / existing.count;
        } else {
          reviewStatsMap.set(r.reviewee_id, { count: 1, avg: r.rating });
        }
      }

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
            posterReviewCount: stats?.count ?? 0,
            posterAvgRating: stats?.avg ?? 0,
            posterCompletedJobs: 0,
            isBoosted,
          };
        });

      return { jobs: enriched, nextOffset: hasMore ? offset + PAGE_SIZE : null };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: !!user && !userLoading && !!ctx,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  // Pro tier — separate lightweight query so it doesn't block dashboard
  const { data: proData } = useQuery({
    queryKey: ["proTier", user?.id],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke("check-pro-subscription");
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
      queryClient.invalidateQueries({ queryKey: ["dashboardContext", user?.id] }),
      queryClient.invalidateQueries({ queryKey: ["dashboardJobs", user?.id] }),
    ]);
  }, [user, queryClient]);

  const loading = userLoading || ctxLoading || (jobsLoading && allJobs.length === 0);

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
    // Pagination controls consumed by the dashboard scroll sentinel
    fetchNextPage,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
  };
}

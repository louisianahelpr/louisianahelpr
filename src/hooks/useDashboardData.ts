import { useCallback, useEffect } from "react";
import { formatName } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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

  // Core dashboard data query — cached & deduped
  const { data, isLoading: dataLoading } = useQuery({
    queryKey: ["dashboardData", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const userId = user.id;

      // Phase 1: jobs + settings + availability + user applications + blocks in parallel
      const [openJobsRes, feeRes, availRes, appliedRes, blocksRes] = await Promise.all([
        supabase
          .from("open_jobs_browse" as any)
          .select("id, title, description, category, budget, date_needed, location, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status")
          .neq("payment_status", "abandoned")
          .order("boosted_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(0, 499),
        supabase.from("platform_settings").select("platform_fee_percent, helper_fee_percent").limit(1).maybeSingle(),
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

      const appliedJobIds = new Set((appliedRes.data ?? []).map((a) => a.job_id));

      // Build set of user IDs blocked in either direction
      const blockedUserIds = new Set<string>();
      for (const row of (blocksRes.data ?? []) as any[]) {
        if (row.blocker_id === userId) blockedUserIds.add(row.blocked_id);
        if (row.blocked_id === userId) blockedUserIds.add(row.blocker_id);
      }

      const platformFee = (feeRes.data as any)?.helper_fee_percent ?? 10;
      const helperAvailability = availRes.data ?? [];
      const rawJobs = ((openJobsRes.data ?? []) as any[]).filter(
        (j) => !blockedUserIds.has(j.customer_id),
      );

      if (rawJobs.length === 0) {
        return { allJobs: [] as EnrichedJob[], platformFee, helperAvailability, recommendedJobs: [] as EnrichedJob[], helprTier: null as string | null };
      }

      // Phase 2: Enrich — poster names + real review data
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
        profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || []
      );

      // Build review stats map
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

      // Build recommended jobs
      let recommendedJobs: EnrichedJob[] = [];
      if (profile) {
        const userSkills = (profile.skills || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
        const userLoc = (profile.location || "").toLowerCase();
        const scored = enriched
          .filter((j) => j.customer_id !== userId)
          .map((j) => {
            let score = 0;
            if (userLoc && j.location.toLowerCase().includes(userLoc)) score += 2;
            if (userSkills.some((s) => j.category.includes(s) || j.title.toLowerCase().includes(s) || j.description.toLowerCase().includes(s))) score += 3;
            return { ...j, _score: score };
          })
          .filter((j) => j._score > 0)
          .sort((a, b) => b._score - a._score)
          .slice(0, 5);
        recommendedJobs = scored;
      }

      // Check pro subscription in background (non-blocking, separate query)
      let helprTier: string | null = null;

      return { allJobs: enriched, platformFee, helperAvailability, recommendedJobs, helprTier };
    },
    enabled: !!user && !userLoading,
    staleTime: 60 * 1000, // 1 min cache
    gcTime: 5 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000, // auto-refresh every 2 minutes
    refetchIntervalInBackground: false, // only when tab is visible
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

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["dashboardData", user?.id] });
  }, [user, queryClient]);

  const loading = userLoading || dataLoading;

  return {
    user,
    profile,
    isAdmin,
    loading,
    helprTier: proData ?? data?.helprTier ?? null,
    allJobs: data?.allJobs ?? [],
    platformFee: data?.platformFee ?? 0,
    helperAvailability: data?.helperAvailability ?? [],
    recommendedJobs: data?.recommendedJobs ?? [],
    refresh,
  };
}

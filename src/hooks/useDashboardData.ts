import { useCallback } from "react";
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

  // Redirect denied/pending users (non-admin)
  const shouldRedirect = !isAdmin && profile?.approval_status === "pending";
  const shouldRedirectDenied = !isAdmin && profile?.approval_status === "denied";
  if (shouldRedirect) navigate("/account-pending");
  if (shouldRedirectDenied) navigate("/account-denied");

  // Core dashboard data query — cached & deduped
  const { data, isLoading: dataLoading } = useQuery({
    queryKey: ["dashboardData", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const userId = user.id;

      // Phase 1: jobs + settings + availability + user applications in parallel
      const [openJobsRes, feeRes, availRes, appliedRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("*")
          .eq("status", "open")
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
      ]);

      const appliedJobIds = new Set((appliedRes.data ?? []).map((a) => a.job_id));

      const platformFee = feeRes.data?.platform_fee_percent ?? 0;
      const helperAvailability = availRes.data ?? [];
      const rawJobs = openJobsRes.data ?? [];

      if (rawJobs.length === 0) {
        return { allJobs: [] as EnrichedJob[], platformFee, helperAvailability, recommendedJobs: [] as EnrichedJob[], helprTier: null as string | null };
      }

      // Phase 2: Enrich — poster names + real review data
      const posterIds = [...new Set(rawJobs.map((j) => j.customer_id))];

      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        supabase
          .from("reviews")
          .select("reviewee_id, rating")
          .in("reviewee_id", posterIds),
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

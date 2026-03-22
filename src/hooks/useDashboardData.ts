import { useCallback } from "react";
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
          .order("boosted_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(0, 199),
        supabase.from("platform_settings").select("platform_fee_percent").limit(1).single(),
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

      const platformFee = feeRes.data?.platform_fee_percent ?? 15;
      const helperAvailability = availRes.data ?? [];
      const rawJobs = openJobsRes.data ?? [];

      if (rawJobs.length === 0) {
        return { allJobs: [] as EnrichedJob[], platformFee, helperAvailability, recommendedJobs: [] as EnrichedJob[], helprTier: null as string | null };
      }

      // Phase 2: Enrich — poster names + review counts
      const posterIds = [...new Set(rawJobs.map((j) => j.customer_id))];

      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", posterIds),
      ]);

      const formatName = (fullName: string | null) => {
        if (!fullName) return "User";
        const parts = fullName.trim().split(/\s+/);
        if (parts.length === 1) return parts[0];
        return `${parts[0]} ${parts[parts.length - 1][0]}.`;
      };

      const nameMap = new Map(
        profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || []
      );

      const reviewMap = new Map<string, { count: number; avg: number }>();
      posterIds.forEach(id => reviewMap.set(id, { count: 0, avg: 0 }));
      const reviewsByPoster = new Map<string, number[]>();
      reviewsRes.data?.forEach((r) => {
        if (!reviewsByPoster.has(r.reviewee_id)) reviewsByPoster.set(r.reviewee_id, []);
        reviewsByPoster.get(r.reviewee_id)!.push(r.rating);
      });
      reviewsByPoster.forEach((ratings, id) => {
        reviewMap.set(id, { count: ratings.length, avg: ratings.reduce((a, b) => a + b, 0) / ratings.length });
      });

      const now = new Date();
      const enriched: EnrichedJob[] = rawJobs
        .filter((j) => !appliedJobIds.has(j.id))
        .map((j) => {
          const isBoosted = !!j.boost_expires_at && new Date(j.boost_expires_at) > now;
          const review = reviewMap.get(j.customer_id) || { count: 0, avg: 0 };
          return {
            ...j,
            posterName: nameMap.get(j.customer_id) || "User",
            posterReviewCount: review.count,
            posterAvgRating: review.avg,
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
    platformFee: data?.platformFee ?? 15,
    helperAvailability: data?.helperAvailability ?? [],
    recommendedJobs: data?.recommendedJobs ?? [],
    refresh,
  };
}

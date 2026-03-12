import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];


export function useDashboardData() {
  const navigate = useNavigate();
  const { user: cachedUser, profile: cachedProfile, isAdmin: cachedIsAdmin } = useCurrentUser();
  const [user, setUser] = useState<SupaUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [helprTier, setHelprTier] = useState<string | null>(null);
  const [allJobs, setAllJobs] = useState<EnrichedJob[]>([]);
  const [platformFee, setPlatformFee] = useState(15);
  const [helperAvailability, setHelperAvailability] = useState<{ day_of_week: number; is_available: boolean; start_time: string; end_time: string }[]>([]);
  const [recommendedJobs, setRecommendedJobs] = useState<EnrichedJob[]>([]);

  // Seed from cached data for instant render
  useEffect(() => {
    if (cachedUser && !user) {
      setUser(cachedUser);
      if (cachedProfile) {
        setProfile(cachedProfile);
        setIsAdmin(cachedIsAdmin);
      }
    }
  }, [cachedUser, cachedProfile, cachedIsAdmin]);

  const loadData = useCallback(async (userId: string) => {
    // Phase 1: Load critical data in parallel (profile + jobs + settings)
    const [profileRes, rolesRes, openJobsRes, feeRes, availRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("jobs").select("*").eq("status", "open").order("boosted_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).range(0, 199),
      supabase.from("platform_settings").select("platform_fee_percent").limit(1).single(),
      supabase.from("helper_availability").select("day_of_week, is_available, start_time, end_time").eq("helper_id", userId).is("specific_date", null).order("day_of_week"),
    ]);

    if (availRes.data && availRes.data.length > 0) {
      setHelperAvailability(availRes.data);
    }

    if (feeRes.data) setPlatformFee(feeRes.data.platform_fee_percent);
    if (profileRes.data) {
      setProfile(profileRes.data);
      const userIsAdmin = rolesRes.data?.some((r) => r.role === "admin") ?? false;
      if (!userIsAdmin) {
        if (profileRes.data.approval_status === "pending") { navigate("/account-pending"); return; }
        if (profileRes.data.approval_status === "denied") { navigate("/account-denied"); return; }
      }
      setIsAdmin(userIsAdmin);
    } else {
      setIsAdmin(rolesRes.data?.some((r) => r.role === "admin") ?? false);
    }

    if (openJobsRes.data && openJobsRes.data.length > 0) {
      // Phase 2: Enrich jobs — only fetch profiles for unique poster IDs
      const posterIds = [...new Set(openJobsRes.data.map((j) => j.customer_id))];
      
      // Batch poster IDs into chunks to avoid URL length limits
      const chunkSize = 50;
      const posterChunks = [];
      for (let i = 0; i < posterIds.length; i += chunkSize) {
        posterChunks.push(posterIds.slice(i, i + chunkSize));
      }

      // Fetch enrichment data via secure RPC for other users' profiles
      const [profilesRes, reviewsRes, completedJobsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", posterIds),
        supabase.from("jobs").select("customer_id").in("customer_id", posterIds).eq("status", "completed"),
      ]);
      
      const nameMap = new Map(profilesRes.data?.map((p) => [p.user_id, (p.full_name || "User").split(" ")[0]]) || []);
      const reviewMap = new Map<string, number[]>();
      reviewsRes.data?.forEach((r) => {
        if (!reviewMap.has(r.reviewee_id)) reviewMap.set(r.reviewee_id, []);
        reviewMap.get(r.reviewee_id)!.push(r.rating);
      });
      const completedMap = new Map<string, number>();
      completedJobsRes.data?.forEach((j) => {
        completedMap.set(j.customer_id, (completedMap.get(j.customer_id) || 0) + 1);
      });

      const now = new Date();
      const enriched = openJobsRes.data.map((j) => {
        const ratings = reviewMap.get(j.customer_id) || [];
        const isBoosted = !!j.boost_expires_at && new Date(j.boost_expires_at) > now;
        return {
          ...j,
          posterName: nameMap.get(j.customer_id) || "User",
          posterReviewCount: ratings.length,
          posterAvgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
          posterCompletedJobs: completedMap.get(j.customer_id) || 0,
          isBoosted,
        };
      });
      setAllJobs(enriched);

      // Build recommended jobs
      if (profileRes.data) {
        const userSkills = (profileRes.data.skills || "").toLowerCase().split(",").map((s: string) => s.trim()).filter(Boolean);
        const userLoc = (profileRes.data.location || "").toLowerCase();
        const scored = enriched
          .filter(j => j.customer_id !== userId)
          .map(j => {
            let score = 0;
            if (userLoc && j.location.toLowerCase().includes(userLoc)) score += 2;
            if (userSkills.some(s => j.category.includes(s) || j.title.toLowerCase().includes(s) || j.description.toLowerCase().includes(s))) score += 3;
            return { ...j, _score: score };
          })
          .filter(j => j._score > 0)
          .sort((a, b) => b._score - a._score)
          .slice(0, 5);
        setRecommendedJobs(scored);
      }
    } else {
      setAllJobs([]);
    }

    setLoading(false);
  }, [navigate]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      setUser(session.user);
      await loadData(session.user.id);
      // Check pro subscription in background (non-blocking)
      supabase.functions.invoke("check-pro-subscription").then(({ data }) => {
        if (data?.subscribed) setHelprTier(data.tier);
      }).catch(() => {});
    };
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return;
      setUser(session.user);
      loadData(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, [loadData]);

  const refresh = useCallback(async () => {
    if (user) await loadData(user.id);
  }, [user, loadData]);

  return {
    user, profile, isAdmin, loading, helprTier,
    allJobs, platformFee, helperAvailability, recommendedJobs, refresh,
  };
}

import { useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Job, AppliedApp } from "@/components/activity/activityConstants";
import { queryKeys } from "@/lib/queryKeys";

export interface ActivityData {
  postedJobs: Job[];
  appliedApps: AppliedApp[];
  applicantCounts: Record<string, number>;
  startRequestedJobIds: Set<string>;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  declinedJobIds: Set<string>;
  helperReviewedJobIds: Set<string>;
}

const EMPTY: ActivityData = {
  postedJobs: [],
  appliedApps: [],
  applicantCounts: {},
  startRequestedJobIds: new Set(),
  helperNames: {},
  completedJobMeta: {},
  declinedJobIds: new Set(),
  helperReviewedJobIds: new Set(),
};

export async function fetchActivityData(userId: string): Promise<ActivityData> {
  const [postedRes, appsRes, directOffersRes] = await Promise.all([
    supabase.from("jobs").select("*").eq("customer_id", userId).order("created_at", { ascending: false }),
    supabase.from("applications").select("*").eq("helper_id", userId).order("created_at", { ascending: false }),
    supabase.from("jobs").select("*").eq("offered_to_helper_id", userId).eq("direct_offer_status", "pending").order("created_at", { ascending: false }),
  ]);

  const startRequestedJobIds = new Set<string>();
  const postedJobs: Job[] = (postedRes.data as any) || [];
  const applicantCounts: Record<string, number> = {};
  const helperNames: Record<string, string> = {};
  const completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }> = {};

  if (postedJobs.length > 0) {
    const jobIds = postedJobs.map((j) => j.id);
    const [allAppsRes, startCheckinsRes] = await Promise.all([
      supabase.from("applications").select("job_id").in("job_id", jobIds),
      supabase.from("job_checkins").select("job_id").in("job_id", jobIds).eq("type", "start_request"),
    ]);
    allAppsRes.data?.forEach((a) => {
      applicantCounts[a.job_id] = (applicantCounts[a.job_id] || 0) + 1;
    });
    (startCheckinsRes.data || []).forEach((c) => startRequestedJobIds.add(c.job_id));

    const helperIds = [...new Set(postedJobs.filter((j) => j.helper_id).map((j) => j.helper_id!))];
    if (helperIds.length > 0) {
      const { data: helperProfiles } = await supabase.rpc("get_safe_profiles", { user_ids: helperIds });
      helperProfiles?.forEach((p: any) => {
        helperNames[p.user_id] = formatName(p.full_name, "Helpr");
      });
    }

    const completedIds = postedJobs.filter((j) => j.status === "completed").map((j) => j.id);
    if (completedIds.length > 0) {
      const [tipsRes, reviewsRes] = await Promise.all([
        supabase.from("tips").select("job_id").in("job_id", completedIds).eq("tipper_id", userId),
        supabase.from("reviews").select("job_id").in("job_id", completedIds).eq("reviewer_id", userId),
      ]);
      completedIds.forEach((id) => {
        completedJobMeta[id] = { tipped: false, reviewed: false };
      });
      tipsRes.data?.forEach((t) => {
        if (completedJobMeta[t.job_id]) completedJobMeta[t.job_id].tipped = true;
      });
      reviewsRes.data?.forEach((r) => {
        if (completedJobMeta[r.job_id]) completedJobMeta[r.job_id].reviewed = true;
      });
    }
  }

  let appliedApps: AppliedApp[] = [];
  let declinedJobIds = new Set<string>();
  let helperReviewedJobIds = new Set<string>();

  if (appsRes.data && appsRes.data.length > 0) {
    const jobIds = [...new Set(appsRes.data.map((a) => a.job_id))];
    const [jobsRes, violationsRes, helperStartCheckins, helperReviewsRes] = await Promise.all([
      supabase.from("jobs").select("*").in("id", jobIds),
      supabase.from("user_violations").select("job_id").eq("user_id", userId).eq("violation_type", "job_denial"),
      supabase.from("job_checkins").select("job_id").in("job_id", jobIds).eq("type", "start_request"),
      supabase.from("reviews").select("job_id").eq("reviewer_id", userId).in("job_id", jobIds),
    ]);
    (helperStartCheckins.data || []).forEach((c) => startRequestedJobIds.add(c.job_id));
    helperReviewedJobIds = new Set((helperReviewsRes.data || []).map((r) => r.job_id));
    const jobs = jobsRes.data;
    const jobMap = new Map(jobs?.map((j) => [j.id, j]) || []);
    const posterIds = [...new Set(jobs?.map((j) => j.customer_id) || [])];
    declinedJobIds = new Set<string>((violationsRes.data || []).map((v: any) => v.job_id).filter(Boolean));
    let posterNameMap = new Map<string, string>();
    if (posterIds.length > 0) {
      const { data: profiles } = await supabase.rpc("get_safe_profiles", { user_ids: posterIds });
      posterNameMap = new Map(profiles?.map((p: any) => [p.user_id, formatName(p.full_name)]) || []);
    }
    appliedApps = appsRes.data.map((a) => {
      const job = jobMap.get(a.job_id) || null;
      return { ...a, job: job as any, posterName: job ? posterNameMap.get(job.customer_id) || "User" : "User" };
    });
  }

  if (directOffersRes.data && directOffersRes.data.length > 0) {
    const directPosterIds = [...new Set(directOffersRes.data.map((j: any) => j.customer_id))];
    const { data: directPosterProfiles } = await supabase.rpc("get_safe_profiles", { user_ids: directPosterIds });
    const directPosterNames = new Map(directPosterProfiles?.map((p: any) => [p.user_id, formatName(p.full_name)]) || []);
    const synthetic: AppliedApp[] = directOffersRes.data.map((job: any) => ({
      id: `direct-${job.id}`,
      job_id: job.id,
      helper_id: userId,
      status: "pending" as any,
      message: null,
      offer_message: null,
      attachment_urls: null,
      proposed_rate: null,
      created_at: job.created_at,
      updated_at: job.updated_at,
      job,
      posterName: directPosterNames.get(job.customer_id) || "User",
    }));
    const existingIds = new Set(appliedApps.map((a) => a.job_id));
    appliedApps = [...synthetic.filter((s) => !existingIds.has(s.job_id)), ...appliedApps];
  }

  return {
    postedJobs,
    appliedApps,
    applicantCounts,
    startRequestedJobIds,
    helperNames,
    completedJobMeta,
    declinedJobIds,
    helperReviewedJobIds,
  };
}

export function useActivityData(user: SupaUser | null) {
  const queryClient = useQueryClient();
  const userId = user?.id;

  const { data, isLoading, refetch } = useQuery({
    queryKey: userId ? queryKeys.activity(userId) : ["activity", "anon"],
    queryFn: () => fetchActivityData(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });

  // Realtime: invalidate the cache so React Query refetches in background.
  useEffect(() => {
    if (!userId) return;
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(userId) });
    const channel = supabase
      .channel("activity-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_tracking" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, invalidate)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reviews" }, invalidate)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_checkins" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  const refresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const merged = data ?? EMPTY;
  return {
    loading: isLoading,
    postedJobs: merged.postedJobs,
    appliedApps: merged.appliedApps,
    applicantCounts: merged.applicantCounts,
    startRequestedJobIds: merged.startRequestedJobIds,
    helperNames: merged.helperNames,
    completedJobMeta: merged.completedJobMeta,
    declinedJobIds: merged.declinedJobIds,
    helperReviewedJobIds: merged.helperReviewedJobIds,
    refresh,
  };
}

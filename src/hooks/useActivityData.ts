import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Job, Application, AppliedApp } from "@/components/activity/activityConstants";

export function useActivityData(user: SupaUser | null) {
  const [loading, setLoading] = useState(true);
  const [postedJobs, setPostedJobs] = useState<Job[]>([]);
  const [appliedApps, setAppliedApps] = useState<AppliedApp[]>([]);
  const [applicantCounts, setApplicantCounts] = useState<Record<string, number>>({});
  const [startRequestedJobIds, setStartRequestedJobIds] = useState<Set<string>>(new Set());
  const [helperNames, setHelperNames] = useState<Record<string, string>>({});
  const [completedJobMeta, setCompletedJobMeta] = useState<Record<string, { tipped: boolean; reviewed: boolean }>>({});
  const [declinedJobIds, setDeclinedJobIds] = useState<Set<string>>(new Set());
  const [helperReviewedJobIds, setHelperReviewedJobIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async (userId: string) => {
    const [postedRes, appsRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("customer_id", userId).order("created_at", { ascending: false }),
      supabase.from("applications").select("*").eq("helper_id", userId).order("created_at", { ascending: false }),
    ]);

    const newStartRequestedJobIds = new Set<string>();

    if (postedRes.data) {
      setPostedJobs(postedRes.data);
      const jobIds = postedRes.data.map(j => j.id);
      if (jobIds.length > 0) {
        const [allAppsRes, startCheckinsRes] = await Promise.all([
          supabase.from("applications").select("job_id").in("job_id", jobIds),
          supabase.from("job_checkins").select("job_id").in("job_id", jobIds).eq("type", "start_request"),
        ]);
        const counts: Record<string, number> = {};
        allAppsRes.data?.forEach(a => { counts[a.job_id] = (counts[a.job_id] || 0) + 1; });
        setApplicantCounts(counts);
        (startCheckinsRes.data || []).forEach(c => newStartRequestedJobIds.add(c.job_id));

        const helperIds = [...new Set(postedRes.data.filter(j => j.helper_id).map(j => j.helper_id!))];
        if (helperIds.length > 0) {
          const { data: helperProfiles } = await supabase.rpc("get_safe_profiles", { user_ids: helperIds });
          const names: Record<string, string> = {};
          helperProfiles?.forEach((p: any) => { names[p.user_id] = formatName(p.full_name, "Helpr"); });
          setHelperNames(names);
        }

        const completedIds = postedRes.data.filter(j => j.status === "completed").map(j => j.id);
        if (completedIds.length > 0) {
          const [tipsRes, reviewsRes] = await Promise.all([
            supabase.from("tips").select("job_id").in("job_id", completedIds).eq("tipper_id", userId),
            supabase.from("reviews").select("job_id").in("job_id", completedIds).eq("reviewer_id", userId),
          ]);
          const meta: Record<string, { tipped: boolean; reviewed: boolean }> = {};
          completedIds.forEach(id => { meta[id] = { tipped: false, reviewed: false }; });
          tipsRes.data?.forEach(t => { if (meta[t.job_id]) meta[t.job_id].tipped = true; });
          reviewsRes.data?.forEach(r => { if (meta[r.job_id]) meta[r.job_id].reviewed = true; });
          setCompletedJobMeta(meta);
        }
      }
    }

    if (appsRes.data && appsRes.data.length > 0) {
      const jobIds = [...new Set(appsRes.data.map((a) => a.job_id))];
      const [jobsRes, violationsRes, helperStartCheckins, helperReviewsRes] = await Promise.all([
        supabase.from("jobs").select("*").in("id", jobIds),
        supabase.from("user_violations").select("job_id").eq("user_id", userId).eq("violation_type", "job_denial"),
        supabase.from("job_checkins").select("job_id").in("job_id", jobIds).eq("type", "start_request"),
        supabase.from("reviews").select("job_id").eq("reviewer_id", userId).in("job_id", jobIds),
      ]);
      (helperStartCheckins.data || []).forEach(c => newStartRequestedJobIds.add(c.job_id));
      setHelperReviewedJobIds(new Set((helperReviewsRes.data || []).map(r => r.job_id)));
      const jobs = jobsRes.data;
      const jobMap = new Map(jobs?.map((j) => [j.id, j]) || []);
      const posterIds = [...new Set(jobs?.map((j) => j.customer_id) || [])];
      const declined = new Set<string>((violationsRes.data || []).map((v: any) => v.job_id).filter(Boolean));
      setDeclinedJobIds(declined);
      let posterNameMap = new Map<string, string>();
      if (posterIds.length > 0) {
        const { data: profiles } = await supabase.rpc("get_safe_profiles", { user_ids: posterIds });
        posterNameMap = new Map(profiles?.map((p: any) => [p.user_id, formatName(p.full_name)]) || []);
      }
      setAppliedApps(appsRes.data.map((a) => {
        const job = jobMap.get(a.job_id) || null;
        return { ...a, job: job as any, posterName: job ? posterNameMap.get(job.customer_id) || "User" : "User" };
      }));
    } else {
      setAppliedApps([]);
    }

    setStartRequestedJobIds(newStartRequestedJobIds);
    setLoading(false);
  }, []);

  // Initialize and subscribe to auth
  useEffect(() => {
    if (user) {
      loadData(user.id);
    }
  }, [user?.id]);

  // Realtime subscriptions
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("activity-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => loadData(user.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "job_tracking" }, () => loadData(user.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, () => loadData(user.id))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reviews" }, () => loadData(user.id))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_checkins" }, () => loadData(user.id))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, loadData]);

  const refresh = useCallback(() => {
    if (user) loadData(user.id);
  }, [user?.id, loadData]);

  return {
    loading, postedJobs, appliedApps, applicantCounts,
    startRequestedJobIds, helperNames, completedJobMeta,
    declinedJobIds, helperReviewedJobIds, refresh,
  };
}

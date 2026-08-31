/**
 * Per-tab data fetching for the Profile page, migrated from a stack of
 * manual `useState` + loading/loaded flags to React Query.
 *
 * Each tab's data is its own `enabled`-gated query keyed under
 * `["profile", userId, <section>]`, so:
 *  - switching away from a tab and back hits the cache instead of refetching,
 *  - React Query dedupes duplicate in-flight requests, and
 *  - the now-dead `loading`/`loaded` flag pairs disappear.
 *
 * Every queryFn pipes Supabase results through `unwrap()` so a failed fetch
 * surfaces as the query's error state (driving the existing inline
 * <ProfileSectionError /> banners) rather than silently blanking a section.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

export type ProfileReview = {
  rating: number;
  punctuality: number | null;
  quality: number | null;
  communication: number | null;
  feedback: string | null;
  created_at: string;
  reviewerName: string;
  jobTitle: string;
};

export type ProfileViolation = {
  id: string;
  violation_type: string;
  description: string | null;
  action_taken: string;
  created_at: string | null;
  job_id: string | null;
};

export type ProfileStats = {
  completedCount: number;
  postedCount: number;
  avgRating: number | null;
  reviewCount: number;
};

const profileKey = (userId: string, section: string) =>
  ["profile", userId, section] as const;

/**
 * Helper stats (completed jobs, posted jobs, average rating, review count).
 * Always enabled once the user is known — the landing tab needs it on first
 * paint, mirroring the prior `loadStats(cachedUser.id)` call.
 */
export function useProfileStats(userId: string | undefined) {
  return useQuery<ProfileStats>({
    queryKey: profileKey(userId ?? "", "stats"),
    enabled: !!userId,
    queryFn: async () => {
      const id = userId!;
      const [helperJobsRes, reviewsRes, postedRes] = await Promise.all([
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("helper_id", id).eq("status", "completed"),
        supabase.from("reviews").select("rating").eq("reviewee_id", id).lte("feedback_visible_at", new Date().toISOString()),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", id),
      ]);
      if (helperJobsRes.error) throw helperJobsRes.error;
      if (reviewsRes.error) throw reviewsRes.error;
      if (postedRes.error) throw postedRes.error;
      const ratings = reviewsRes.data ?? [];
      return {
        completedCount: helperJobsRes.count || 0,
        postedCount: postedRes.count || 0,
        avgRating: ratings.length > 0 ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : null,
        reviewCount: ratings.length,
      };
    },
  });
}

/**
 * Full reviews list (with reviewer names + job titles resolved). Enabled on
 * the reviews tab only — the landing's hero preview was removed.
 */
export function useProfileReviews(userId: string | undefined, enabled: boolean) {
  return useQuery<ProfileReview[]>({
    queryKey: profileKey(userId ?? "", "reviews"),
    enabled: !!userId && enabled,
    queryFn: async () => {
      const id = userId!;
      const data = unwrap(
        await supabase
          .from("reviews")
          .select("rating, punctuality, quality, communication, feedback, created_at, reviewer_id, job_id, jobs!inner(status)")
          .eq("reviewee_id", id)
          .lte("feedback_visible_at", new Date().toISOString())
          .neq("jobs.status", "cancelled")
          .order("created_at", { ascending: false }),
      );
      if (!data || data.length === 0) return [];
      const reviewerIds = [...new Set(data.map((r) => r.reviewer_id))];
      const jobIds = [...new Set(data.map((r) => r.job_id))];
      const [profilesRes, jobsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: reviewerIds }),
        supabase.from("jobs").select("id, title").in("id", jobIds),
      ]);
      // Enrichment only — a failure here degrades names to "User" / titles to
      // "Job" rather than blanking the reviews, so it deliberately does NOT
      // throw. It must still be OBSERVABLE though: dropping `.error` on the
      // floor is how "every reviewer is called User" becomes a bug nobody can
      // explain. (CLAUDE.md: never drop the Supabase error.)
      if (profilesRes.error) {
        report(profilesRes.error, { tags: { source: "useProfileReviews.reviewerNames" } });
      }
      if (jobsRes.error) {
        report(jobsRes.error, { tags: { source: "useProfileReviews.jobTitles" } });
      }
      const nameMap = new Map(profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || []);
      const jobMap = new Map(jobsRes.data?.map((j) => [j.id, j.title]) || []);
      return data.map((r: any) => ({
        rating: r.rating,
        punctuality: r.punctuality ?? null,
        quality: r.quality ?? null,
        communication: r.communication ?? null,
        feedback: r.feedback,
        created_at: r.created_at,
        reviewerName: nameMap.get(r.reviewer_id) || "User",
        jobTitle: jobMap.get(r.job_id) || "a task",
      }));
    },
  });
}

/** Earnings tab — helper's non-cancelled jobs + tips on completed jobs. */
export function useProfileEarnings(userId: string | undefined, enabled: boolean) {
  return useQuery<{ jobs: Job[]; tips: { amount: number; job_id: string; created_at: string }[] }>({
    queryKey: profileKey(userId ?? "", "earnings"),
    enabled: !!userId && enabled,
    queryFn: async () => {
      const id = userId!;
      const [jobsRes, tipsRes] = await Promise.all([
        supabase.from("jobs").select("*").eq("helper_id", id).neq("status", "cancelled").order("created_at", { ascending: false }),
        supabase.from("tips").select("amount, job_id, created_at").eq("helper_id", id),
      ]);
      const jobs = unwrap(jobsRes) ?? [];
      const allTips = unwrap(tipsRes) ?? [];
      const completedJobIds = new Set(jobs.filter((j) => j.status === "completed").map((j) => j.id));
      return { jobs, tips: allTips.filter((t) => completedJobIds.has(t.job_id)) };
    },
  });
}

/** Schedule tab — upcoming posted + assigned jobs. */
export function useProfileSchedule(userId: string | undefined, enabled: boolean) {
  return useQuery<{ posted: Job[]; assigned: Job[] }>({
    queryKey: profileKey(userId ?? "", "schedule"),
    enabled: !!userId && enabled,
    queryFn: async () => {
      const id = userId!;
      const [posted, assigned] = await Promise.all([
        supabase.from("jobs").select("*").eq("customer_id", id).in("status", ["open", "accepted", "in_progress"]).order("date_needed"),
        supabase.from("jobs").select("*").eq("helper_id", id).in("status", ["accepted", "in_progress"]).order("date_needed"),
      ]);
      return { posted: unwrap(posted) ?? [], assigned: unwrap(assigned) ?? [] };
    },
  });
}

/** Landing inline job lists — opened from the posted/completed tabs. */
/** Warnings tab — the user's violation history. */
export function useProfileViolations(userId: string | undefined, enabled: boolean) {
  return useQuery<ProfileViolation[]>({
    queryKey: profileKey(userId ?? "", "violations"),
    enabled: !!userId && enabled,
    queryFn: async () => {
      const id = userId!;
      const data = unwrap(
        await supabase.from("user_violations").select("*").eq("user_id", id).order("created_at", { ascending: false }),
      );
      return data ?? [];
    },
  });
}

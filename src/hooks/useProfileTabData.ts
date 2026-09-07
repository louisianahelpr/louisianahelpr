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
      // `reviewer_id` is nullable — an account deletion anonymises the review
      // rather than removing it, so the rating survives its author. Null is
      // dropped here rather than tolerated downstream: `get_safe_profiles`
      // takes a uuid[], and a null inside it is a malformed argument, not a
      // no-match. The review still renders; its author falls back to "User"
      // via `nameMap.get(...) || "User"` below.
      const reviewerIds = [
        ...new Set(data.map((r) => r.reviewer_id).filter((id): id is string => !!id)),
      ];
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
        // "a neighbor", not "User": every other consumer surface for this exact
        // state says "a neighbor" (ReviewList, PublicReviewWall, useActivityData,
        // DashboardGuest). "User" read like an unfilled placeholder rather than
        // a person who left, and it disagreed with the review panel about the
        // same review. Admin surfaces keep "Deleted user" — an admin should see
        // the truth.
        reviewerName: (r.reviewer_id ? nameMap.get(r.reviewer_id) : null) || "a neighbor",
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
      // GROUP JOBS: only ONE roster member is ever written to `jobs.helper_id`,
      // but `release-payout` transfers to EVERY member of `group_job_helpers`
      // (it reads the roster separately and fans out `budget / N` each). So a
      // `helper_id`-only query drops a completed group job from the earnings of
      // every member except the lead — money that was genuinely paid, missing
      // from the tab that exists to account for it.
      //
      // PostgREST cannot express `helper_id = me OR id IN (subquery)` in one
      // request, so the roster ids are fetched first and folded into the `or`.
      // Empty roster (the case today: zero rows in prod) degrades to exactly
      // the previous query.
      const rosterRes = await supabase
        .from("group_job_helpers")
        .select("job_id")
        .eq("helper_id", id);
      const rosterJobIds = [...new Set((unwrap(rosterRes) ?? []).map((r) => r.job_id))];
      // NO `is_seed` FILTER HERE, AND THE OMISSION IS DELIBERATE — READ THIS
      // BEFORE ADDING ONE BACK.
      //
      // It was added on 2026-09-04 for ME-042: seed fixtures written straight
      // into SQL with `payment_status='released'` and no `payout_transfers`
      // row made "total earned" ($349.60) disagree with the payout ledger
      // ($248.40). It was removed on 2026-09-06 because it filtered on the
      // wrong axis and broke a real screen. External QA ran a full job loop,
      // the poster approved and released, and the helper's Earnings & Payouts
      // read "$0.00 · total earned · 0 jobs" and "No earnings yet" — while My
      // Jobs → Done showed the same job at $105 with its proof photos.
      // Reproduced against prod: helper 437de07d (profile `is_seed=false`, a
      // real account, Stripe connected) had exactly one non-cancelled job,
      // 8133a907 "QA main loop mow and edge", `is_seed=true`. This one clause
      // was the whole reason every figure on that screen was zero.
      //
      // `is_seed` marks a FIXTURE ROW. It does not mark money that did not
      // move, which is what ME-042 was actually about, and it is not consulted
      // by My Jobs, by `useProfileStats`, or by the Work Record — so putting
      // it here is what made two screens disagree about one job. The honest
      // axis is `payment_status`, and it now lives in `isEarnedJob`
      // (earningsTabHelpers.ts): a completed job counts as earned only when
      // its money is `payout_pending` or `released`, so a refunded or
      // charged-back job stops counting as income too — which the old
      // `status === "completed"` test got wrong for every account, fixture or
      // not. Admin aggregates keep excluding `is_seed` unconditionally
      // (see src/config/showSeedJobs.ts); a platform-wide money figure and one
      // person's own ledger are not the same instrument.
      const jobsQuery = supabase.from("jobs").select("*").neq("status", "cancelled");
      const [jobsRes, tipsRes] = await Promise.all([
        (rosterJobIds.length
          ? jobsQuery.or(`helper_id.eq.${id},id.in.(${rosterJobIds.join(",")})`)
          : jobsQuery.eq("helper_id", id)
        ).order("created_at", { ascending: false }),
        // Only PAID tips count toward displayed earnings. Unfiltered, a
        // `pending` row — written by create-payment before the tipper even
        // reaches Stripe, and left behind for good if they abandon checkout —
        // inflated the helper's earnings by money that never arrived.
        supabase.from("tips").select("amount, job_id, created_at").eq("helper_id", id).eq("payment_status", "paid"),
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

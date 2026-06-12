import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** Maximum open jobs fetched before filtering / scoring. */
const FETCH_LIMIT = 40;
/** Number of top-scored jobs to return. */
const RETURN_LIMIT = 5;

/**
 * Fetches open jobs and ranks them by relevance for the current helper.
 *
 * Scoring rubric (additive):
 *  +3  category match (helper has completed a job in this category)
 *  0-2  budget percentile (higher budget → more points)
 *  +2  posted in the last 6 hours
 *  +1  posted in the last 24 hours (inclusive; stacks with the 6h bonus via max)
 *  +1  recently boosted (boosted_at within last 48 hours)
 *
 * All Supabase calls are PGRST202-safe: failures return empty arrays /
 * default values so a missing column or table never breaks the Dashboard.
 */
export function useJobsForYou(
  userId: string | undefined,
  profile: Profile | null,
) {
  return useQuery({
    queryKey: ["jobs-for-you", userId],
    enabled: !!userId && !!profile,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<EnrichedJob[]> => {
      if (!userId || !profile) return [];

      // ── 1. Fetch open jobs ─────────────────────────────────────────────
      // Prefer the helper's location string (city / parish). If unavailable
      // fetch the most-recent open jobs platform-wide — a thin feed beats
      // an empty section.
      let jobsQuery = supabase
        .from("jobs")
        .select(
          "id, title, description, category, budget, date_needed, location, customer_id, status, created_at, boosted_at, credential_tier",
        )
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT);

      // Location filter — match on city/state fragment so "New Orleans, LA"
      // matches "New Orleans" jobs without an exact-string dependency.
      const locationFragment = (profile.parish ?? profile.location ?? "").trim();
      if (locationFragment) {
        jobsQuery = jobsQuery.ilike("location", `%${locationFragment}%`);
      }

      let jobs: EnrichedJob[];
      try {
        const { data, error } = await jobsQuery;
        if (error && (error as { code?: string }).code === "PGRST202") {
          return [];
        }
        if (error) return [];
        jobs = (data ?? []) as EnrichedJob[];
      } catch {
        return [];
      }

      // If location-filtered query returned nothing, fall back to global open jobs.
      if (jobs.length === 0 && locationFragment) {
        try {
          const { data, error } = await supabase
            .from("jobs")
            .select(
              "id, title, description, category, budget, date_needed, location, customer_id, status, created_at, boosted_at, credential_tier",
            )
            .eq("status", "open")
            .order("created_at", { ascending: false })
            .limit(FETCH_LIMIT);
          if (!error) jobs = (data ?? []) as EnrichedJob[];
        } catch {
          // Fall through with empty list.
        }
      }

      if (jobs.length === 0) return [];

      // ── 2. Filter out jobs the helper has already applied to ───────────
      let appliedJobIds = new Set<string>();
      try {
        const { data: applications, error: appsError } = await supabase
          .from("applications")
          .select("job_id")
          .eq("helper_id", userId);
        if (!appsError && applications) {
          appliedJobIds = new Set(
            applications.map((a: { job_id: string }) => a.job_id),
          );
        }
      } catch {
        // PGRST202-safe: if the query fails we just skip this filter.
      }

      // Also exclude the helper's own posts.
      const candidates = jobs.filter(
        (j) => !appliedJobIds.has(j.id) && j.customer_id !== userId,
      );

      if (candidates.length === 0) return [];

      // ── 3. Build category-match set from helper's past completed jobs ──
      let completedCategories = new Set<string>();
      try {
        const { data: completedJobs, error: completedError } = await supabase
          .from("jobs")
          .select("category")
          .eq("helper_id", userId)
          .in("status", ["completed", "accepted"]);
        if (!completedError && completedJobs) {
          completedCategories = new Set(
            completedJobs.map((j: { category: string }) => j.category),
          );
        }
      } catch {
        // Category matching just won't fire — degrade gracefully.
      }

      // ── 4. Score candidates ────────────────────────────────────────────
      const budgets = candidates.map((j) => j.budget ?? 0).sort((a, b) => a - b);
      const maxBudget = budgets[budgets.length - 1] ?? 1;

      const now = Date.now();
      const SIX_HOURS = 6 * 60 * 60 * 1000;
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

      const scored = candidates.map((job) => {
        let score = 0;

        // Category match
        if (job.category && completedCategories.has(job.category)) {
          score += 3;
        }

        // Budget percentile (0–2 pts)
        const budget = job.budget ?? 0;
        const budgetPct = maxBudget > 0 ? budget / maxBudget : 0;
        score += Math.round(budgetPct * 2);

        // Recency
        if (job.created_at) {
          const age = now - new Date(job.created_at).getTime();
          if (age <= SIX_HOURS) {
            score += 2;
          } else if (age <= TWENTY_FOUR_HOURS) {
            score += 1;
          }
        }

        // Boost signal — `boosted_at` lives directly on the jobs row.
        // PGRST202-safe: if the column doesn't exist it's simply undefined.
        const boostedAt = (job as EnrichedJob & { boosted_at?: string | null })
          .boosted_at;
        if (boostedAt) {
          const boostAge = now - new Date(boostedAt).getTime();
          if (boostAge <= FORTY_EIGHT_HOURS) {
            score += 1;
          }
        }

        return { job, score };
      });

      // Sort descending, take top N
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, RETURN_LIMIT).map((s) => s.job);
    },
  });
}

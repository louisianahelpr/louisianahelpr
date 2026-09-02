import { useCallback, useState } from "react";
import type { User as SupaUser } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fetchRatingStats } from "@/lib/reviewStats";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import type { Job, EnrichedApplication } from "@/components/activity/activityConstants";

/**
 * Applicant loading + enrichment state for the Activity page, extracted
 * verbatim from useActivityActions. Owns the dialog list (`applications`),
 * the inline per-job map (`inlineApplicants`) and their loading/error
 * flags, plus the shared `fetchApplicants` enrichment pipeline.
 *
 * `setApplications`/`setInlineApplicants` are returned so sibling handlers
 * (declineApplication, confirmAcceptWithDeadline) can patch the same lists.
 */
export function useApplicantsState(user: SupaUser | null) {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<EnrichedApplication[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsError, setApplicationsError] = useState(false);
  const [inlineApplicants, setInlineApplicants] = useState<Record<string, EnrichedApplication[]>>({});
  const [loadingApplicants, setLoadingApplicants] = useState<Record<string, boolean>>({});
  const [applicantErrors, setApplicantErrors] = useState<Record<string, boolean>>({});

  const fetchApplicants = async (jobId: string): Promise<EnrichedApplication[]> => {
    const { data: apps, error: appsError } = await supabase.from("applications").select("*").eq("job_id", jobId);
    if (appsError) throw appsError;
    if (apps && apps.length > 0) {
      // Filter out applicants the current user has blocked (or who blocked them)
      const { getBlockedUserIds } = await import("@/lib/userBlocks");
      // Throws on a failed read (see userBlocks). Let it propagate: this runs
      // inside the applicants loader, whose error path already renders a
      // retryable state — better than listing an applicant the poster blocked.
      const blockedSet = user ? await getBlockedUserIds(user.id) : new Set<string>();
      const visibleApps = apps.filter((a) => !blockedSet.has(a.helper_id));
      if (visibleApps.length === 0) return [];

      const helperIds = visibleApps.map((a) => a.helper_id);
      const [profilesRes, reviewStatsMap, availabilityRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: helperIds }),
        fetchRatingStats(helperIds),
        // "Available now" field — `available_until` is a new column the
        // generated types don't include yet, so the query builder is cast
        // to a minimal shape that accepts the select string and returns the
        // row we read. Errors are ignored so the panel never blocks on a
        // not-yet-deployed migration.
        (supabase.from("profiles") as unknown as {
          select: (cols: string) => {
            in: (col: string, vals: string[]) => Promise<{
              data: Array<{ user_id: string; available_until: string | null }> | null;
              error: unknown;
            }>;
          };
        }).select("user_id, available_until").in("user_id", helperIds),
      ]);
      // Map helper_id → available_until for O(1) merge below.
      const availabilityMap = new Map<string, string | null>();
      if (availabilityRes?.data) {
        for (const row of availabilityRes.data as Array<{ user_id: string; available_until: string | null }>) {
          availabilityMap.set(row.user_id, row.available_until);
        }
      }
      const enriched = visibleApps.map((app) => {
        const prof = profilesRes.data?.find((p) => p.user_id === app.helper_id) || null;
        const stats = reviewStatsMap.get(app.helper_id);
        const available_until = availabilityMap.get(app.helper_id) ?? null;
        return {
          ...app,
          profiles: prof ? { ...prof, available_until } : null,
          reviewCount: stats?.count ?? 0,
          avgRating: stats?.avg ?? 0,
        };
      });
      // NO tier sort here any more, deliberately.
      //
      // This function used to end with a descending `tierOrder()` sort —
      // elite 3, pro 2, basic 1, everyone else 0 — under a comment calling it
      // the Priority Placement perk. It never reached a poster's screen. Both
      // consumers of this array (ApplicantsPanel via useApplicantComparison,
      // and the inline per-job list) re-sort it by `scoreApplicant()`, so the
      // tier order was overwritten before the first render: the perk was
      // computed, then discarded, on every load, for every paying helper.
      //
      // Ordering now has exactly ONE owner — `useApplicantComparison`, which
      // ranks on `rankScore` = quality + a bounded tier boost capped below the
      // smallest quality increment (applicantScoring.ts explains the bound and
      // why a poster's list must not let money outrank merit). Re-adding a
      // sort here would not "reinforce" that; it would be silently thrown away
      // again, which is exactly how this shipped broken the first time.
      //
      // Applicants come back in application order (the `applications` select's
      // natural order), which the ranking sort — stable, like every V8 sort —
      // preserves within a tie.
      return enriched;
    }
    return [];
  };

  const loadApplications = async (job: Job) => {
    setSelectedJob(job);
    setApplicationsLoading(true);
    setApplicationsError(false);
    setApplications([]);
    try {
      const enriched = await fetchApplicants(job.id);
      setApplications(enriched);
    } catch {
      // A failed fetch must not read as "no applicants" — tell the truth.
      setApplicationsError(true);
      hapticError();
      toast.error("Couldn't pull up applicants right now — give it a second and try again?");
    } finally {
      setApplicationsLoading(false);
    }
  };

  const loadInlineApplicants = useCallback(async (jobId: string) => {
    // Clear any prior error and start loading (supports retry by always re-fetching).
    setApplicantErrors(prev => ({ ...prev, [jobId]: false }));
    setLoadingApplicants(prev => ({ ...prev, [jobId]: true }));
    try {
      const enriched = await fetchApplicants(jobId);
      setInlineApplicants(prev => ({ ...prev, [jobId]: enriched }));
      // Fire-and-forget — mark pending applications as viewed by the poster.
      // PGRST202-safe: if the migration isn't deployed yet, this silently does nothing.
      if (enriched.length > 0) {
        // `mark_applications_viewed` isn't in the generated RPC union yet
        // (migration lag). Cast the rpc fn so the args stay type-checked.
        const markViewed = supabase.rpc.bind(supabase) as unknown as (
          fn: "mark_applications_viewed",
          args: { p_job_id: string },
        ) => PromiseLike<unknown>;
        Promise.resolve(markViewed("mark_applications_viewed", { p_job_id: jobId })).then(() => {});
      }
    } catch {
      setApplicantErrors(prev => ({ ...prev, [jobId]: true }));
      hapticError();
      toast.error("Couldn't pull up applicants right now — give it a second and try again?");
    } finally {
      setLoadingApplicants(prev => ({ ...prev, [jobId]: false }));
    }
  }, [user]);

  return {
    // state
    selectedJob, setSelectedJob,
    applications, setApplications,
    applicationsLoading,
    applicationsError,
    inlineApplicants, setInlineApplicants,
    loadingApplicants,
    applicantErrors,
    // handlers
    fetchApplicants,
    loadApplications,
    loadInlineApplicants,
  };
}

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fetchRatingStats } from "@/lib/reviewStats";
// Static on purpose (Q239): the signed-in shell already loads this module
// (useNavUnreadCount), and a lazy import here could cost its own chunk round
// before the block-list read even started.
import { getBlockedUserIds } from "@/lib/userBlocks";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import type { Job, EnrichedApplication } from "@/components/activity/activityConstants";
import { prefetchApplicantSignals } from "@/components/activity/postedJobs/useApplicantSignals";

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

  const queryClient = useQueryClient();

  // ONE network round per dependency level (Q239). This was a 4-round
  // waterfall before the ranked list could render: applications, THEN the
  // block list, THEN profiles/ratings/availability, THEN (once the list had
  // rendered and useApplicantSignals mounted) the ranking signals. Now:
  //   round 1: applications + the block list (independent of each other);
  //   round 2: profiles, ratings, availability AND the ranking signals, which
  //            are prefetched into React Query under useApplicantSignals' own
  //            keys when `signalsJobId` is given (the Applicants panel), so
  //            the hook reads a warm cache.
  // Round 1 cannot go: every later read needs the applicant ids.
  // Guard: applicantsPanelRounds.test.tsx (counts the rounds).
  const fetchApplicants = async (jobId: string, signalsJobId?: string): Promise<EnrichedApplication[]> => {
    const appsReq = supabase.from("applications").select("*").eq("job_id", jobId);
    // Filter out applicants the current user has blocked (or who blocked them).
    // Throws on a failed read (see userBlocks). Let it propagate: this runs
    // inside the applicants loader, whose error path already renders a
    // retryable state — better than listing an applicant the poster blocked.
    const blockedReq = user ? getBlockedUserIds(user.id) : Promise.resolve(new Set<string>());
    const [{ data: apps, error: appsError }, blockedSet] = await Promise.all([appsReq, blockedReq]);
    if (appsError) throw appsError;
    if (apps && apps.length > 0) {
      const visibleApps = apps.filter((a) => !blockedSet.has(a.helper_id));
      if (visibleApps.length === 0) return [];

      const helperIds = visibleApps.map((a) => a.helper_id);
      // Same round as the enrichment reads below; never awaited here (each
      // query degrades to an empty signal on its own, see useApplicantSignals).
      if (signalsJobId) prefetchApplicantSignals(queryClient, visibleApps.map((a) => a.helper_id), signalsJobId);
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
      const enriched = await fetchApplicants(job.id, job.id);
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
        // `supabase.rpc(...)` returns a Postgrest builder — a thenable, not a
        // real Promise — so it is wrapped before being left unawaited.
        void Promise.resolve(
          supabase.rpc("mark_applications_viewed", { p_job_id: jobId }),
        ).then(() => {});
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

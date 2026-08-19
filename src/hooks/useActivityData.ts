import { useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { formatName } from "@/lib/utils";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Job, AppliedApp } from "@/components/activity/activityConstants";
import type { TrackingData } from "@/components/JobTracking";
import { queryKeys } from "@/lib/queryKeys";
import { validateResult } from "@/lib/validateResult";
import { helperApplicationsSchema } from "@/lib/schemas";
import { report } from "@/lib/errorLogger";

/** Pre-fetched per-job side data — replaces what used to be one Supabase
    round-trip per rendered card. `null` means "we looked and there is no
    row yet"; absent means "we never looked" (handled gracefully by the
    consumer components). */
export interface GroupHelperLite {
  id: string;
  job_id: string;
  helper_id: string;
  status: string;
  /** Nullable per the generated DB types (has a server default but the
      column accepts NULL). Forwarded as-is to the legacy GroupJobHelpers
      shape, which never read this field. */
  joined_at: string | null;
  helperName: string;
}

export interface ActivityData {
  postedJobs: Job[];
  appliedApps: AppliedApp[];
  applicantCounts: Record<string, number>;
  startRequestedJobIds: Set<string>;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  declinedJobIds: Set<string>;
  helperReviewedJobIds: Set<string>;
  /** Latest job_tracking row per job_id. Pre-fetched here so each
      <JobTracking> card on the page doesn't fire its own query (N+1
      across all active/in-progress jobs). `null` keys mean the job has
      no tracking row yet. */
  latestTracking: Record<string, TrackingData | null>;
  /** Enriched group-helper rows per job_id, only populated for the
      poster's active group jobs. Pre-fetched so <GroupJobHelpers> doesn't
      fire its 2-query waterfall (group_job_helpers + profiles) per
      rendered group-job card. */
  groupHelpersByJob: Record<string, GroupHelperLite[]>;
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
  latestTracking: {},
  groupHelpersByJob: {},
};

export async function fetchActivityData(userId: string): Promise<ActivityData> {
  const [postedRes, appsRes, directOffersRes] = await Promise.all([
    supabase.from("jobs").select("*").eq("customer_id", userId).order("created_at", { ascending: false }),
    supabase.from("applications").select("*").eq("helper_id", userId).order("created_at", { ascending: false }),
    supabase.from("jobs").select("*").eq("offered_to_helper_id", userId).eq("direct_offer_status", "pending").order("created_at", { ascending: false }),
  ]);

  // Surface a failed primary fetch so the screen can show an ErrorState
  // instead of a misleading "nothing here yet" empty state.
  const primaryError = postedRes.error || appsRes.error || directOffersRes.error;
  if (primaryError) throw primaryError;

  // Runtime Zod check at one of the app's highest-stakes Supabase reads —
  // see validateResult.ts. The applied-jobs list drives the entire helper
  // Activity tab; a schema mismatch here means wrong status badges, stale
  // proposed rates, or missing applications. Logged-only — the screen
  // still renders the raw payload on drift.
  if (appsRes.data) {
    validateResult(
      helperApplicationsSchema,
      appsRes.data,
      "useActivityData.applicationsForHelper",
    );
  }

  const startRequestedJobIds = new Set<string>();
  const postedJobs: Job[] = postedRes.data ?? [];
  const applicantCounts: Record<string, number> = {};
  const helperNames: Record<string, string> = {};
  const completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }> = {};

  if (postedJobs.length > 0) {
    const jobIds = postedJobs.map((j) => j.id);
    const [allAppsRes, startCheckinsRes] = await Promise.all([
      supabase.from("applications").select("job_id").in("job_id", jobIds),
      supabase.from("job_checkins").select("job_id").in("job_id", jobIds).eq("type", "start_request"),
    ]);
    // Enrichments — not fatal, but a silent drop means the poster sees 0
    // applicants and no start-request badge on jobs that actually have
    // them. Warn-report so we notice, then still degrade gracefully.
    if (allAppsRes.error) {
      report(allAppsRes.error, { severity: "warning", tags: { source: "useActivityData.applicantCounts" } });
    }
    if (startCheckinsRes.error) {
      report(startCheckinsRes.error, { severity: "warning", tags: { source: "useActivityData.startCheckins" } });
    }
    allAppsRes.data?.forEach((a) => {
      applicantCounts[a.job_id] = (applicantCounts[a.job_id] || 0) + 1;
    });
    (startCheckinsRes.data || []).forEach((c) => startRequestedJobIds.add(c.job_id));

    const helperIds = [...new Set(postedJobs.filter((j) => j.helper_id).map((j) => j.helper_id!))];
    if (helperIds.length > 0) {
      const { data: helperProfiles, error: helperProfilesError } = await supabase.rpc("get_safe_profiles", { user_ids: helperIds });
      // Enrichment, not primary data — a failed name lookup degrades to the
      // "Helpr" fallback rather than blanking the tab, but must still be
      // observable (this RPC's grant has silently vanished before).
      if (helperProfilesError) report(helperProfilesError, { severity: "warning", tags: { source: "useActivityData.helperNames" } });
      helperProfiles?.forEach((p) => {
        helperNames[p.user_id] = formatName(p.full_name, "Helpr");
      });
    }

    const completedIds = postedJobs.filter((j) => j.status === "completed").map((j) => j.id);
    if (completedIds.length > 0) {
      const [tipsRes, reviewsRes] = await Promise.all([
        supabase.from("tips").select("job_id").in("job_id", completedIds).eq("tipper_id", userId),
        supabase.from("reviews").select("job_id").in("job_id", completedIds).eq("reviewer_id", userId),
      ]);
      // Post-completion badges (tipped / reviewed) — a silent drop makes an
      // already-tipped job re-prompt the poster to tip. Warn-report and
      // degrade to the default (unchecked) state so the UI still renders.
      if (tipsRes.error) {
        report(tipsRes.error, { severity: "warning", tags: { source: "useActivityData.tipsBadge" } });
      }
      if (reviewsRes.error) {
        report(reviewsRes.error, { severity: "warning", tags: { source: "useActivityData.reviewsBadge" } });
      }
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
    // The applied-jobs list is meaningless without the job rows behind it —
    // a failed jobs fetch would leave every app with `job: null` and render
    // a blank tab. Surface it as a query error, like the primary fetches.
    if (jobsRes.error) throw jobsRes.error;
    // Enrichments — a dropped violations fetch would show declined jobs as
    // normal-pending, a dropped checkins fetch would hide start-request
    // badges, and a dropped reviews fetch would re-prompt for a review the
    // helper already left. Warn-report + degrade rather than crash.
    if (violationsRes.error) {
      report(violationsRes.error, { severity: "warning", tags: { source: "useActivityData.helperDeclinedJobs" } });
    }
    if (helperStartCheckins.error) {
      report(helperStartCheckins.error, { severity: "warning", tags: { source: "useActivityData.helperStartCheckins" } });
    }
    if (helperReviewsRes.error) {
      report(helperReviewsRes.error, { severity: "warning", tags: { source: "useActivityData.helperReviews" } });
    }
    (helperStartCheckins.data || []).forEach((c) => startRequestedJobIds.add(c.job_id));
    helperReviewedJobIds = new Set((helperReviewsRes.data || []).map((r) => r.job_id));
    const jobs = jobsRes.data;
    const jobMap = new Map(jobs?.map((j) => [j.id, j]) || []);
    const posterIds = [...new Set(jobs?.map((j) => j.customer_id) || [])];
    declinedJobIds = new Set<string>((violationsRes.data || []).map((v) => v.job_id).filter((id): id is string => Boolean(id)));
    let posterNameMap = new Map<string, string>();
    if (posterIds.length > 0) {
      const { data: profiles, error: posterProfilesError } = await supabase.rpc("get_safe_profiles", { user_ids: posterIds });
      if (posterProfilesError) report(posterProfilesError, { severity: "warning", tags: { source: "useActivityData.posterNames" } });
      posterNameMap = new Map(profiles?.map((p) => [p.user_id, formatName(p.full_name)]) || []);
    }
    appliedApps = appsRes.data.map((a) => {
      const job = jobMap.get(a.job_id) || null;
      return { ...a, job, posterName: job ? posterNameMap.get(job.customer_id) || "User" : "User" };
    });
  }

  if (directOffersRes.data && directOffersRes.data.length > 0) {
    const directPosterIds = [...new Set(directOffersRes.data.map((j) => j.customer_id))];
    const { data: directPosterProfiles, error: directPosterError } = await supabase.rpc("get_safe_profiles", { user_ids: directPosterIds });
    if (directPosterError) report(directPosterError, { severity: "warning", tags: { source: "useActivityData.directOfferPosterNames" } });
    const directPosterNames = new Map(directPosterProfiles?.map((p) => [p.user_id, formatName(p.full_name)]) || []);
    const synthetic: AppliedApp[] = directOffersRes.data.map((job) => ({
      id: `direct-${job.id}`,
      job_id: job.id,
      helper_id: userId,
      status: "pending",
      message: null,
      offer_message: null,
      attachment_urls: null,
      proposed_rate: null,
      poster_viewed_at: null,
      // Columns still exist on the applications row (feature removed from UI,
      // DB columns retained as harmless nullable) — set to satisfy the row shape.
      // The bid trio joined this list when accept_bids was removed
      // (PRICING_MODE_REMOVED in BudgetSection); nothing reads them.
      proposed_price: null,
      counter_price: null,
      negotiation_status: "none",
      stake_amount: null,
      stake_status: "none",
      created_at: job.created_at,
      updated_at: job.updated_at,
      job,
      posterName: directPosterNames.get(job.customer_id) || "User",
    }));
    const existingIds = new Set(appliedApps.map((a) => a.job_id));
    appliedApps = [...synthetic.filter((s) => !existingIds.has(s.job_id)), ...appliedApps];
  }

  // --- Batched per-job side-data, hoisted from per-card useEffects ---
  //
  // (1) Latest job_tracking row per active/in-progress job. Replaces the
  //     N per-card SELECTs that the old <JobTracking> mount triggered
  //     across every "Confirmed", "In Progress", "Disputed" card on the
  //     Activity tab (both helper and poster sides).
  //
  // (2) Group-helpers per active/in-progress group job on the poster
  //     side. Replaces the 2-query waterfall (group_job_helpers + then a
  //     profiles lookup) that <GroupJobHelpers> fired per card.
  const trackingJobIds = new Set<string>();
  const groupHelperJobIds = new Set<string>();
  const isActiveStatus = (s: string | null | undefined) =>
    s === "accepted" || s === "in_progress" || s === "disputed";
  for (const j of postedJobs) {
    if (isActiveStatus(j.status)) {
      trackingJobIds.add(j.id);
      if (j.is_group_job) groupHelperJobIds.add(j.id);
    }
  }
  for (const a of appliedApps) {
    if (a.job && isActiveStatus(a.job.status) && a.status === "accepted") {
      trackingJobIds.add(a.job_id);
    }
  }

  const latestTracking: Record<string, TrackingData | null> = {};
  const groupHelpersByJob: Record<string, GroupHelperLite[]> = {};

  if (trackingJobIds.size > 0 || groupHelperJobIds.size > 0) {
    const trackingPromise =
      trackingJobIds.size > 0
        ? supabase
            .from("job_tracking")
            // Pull every tracking row for the relevant job set in one query;
            // we'll keep just the latest per job_id below. Activity feeds
            // have small active-job counts, so the extra rows are cheap
            // compared with N round-trips.
            .select("id, job_id, status, latitude, longitude, eta_minutes, updated_at, created_at")
            .in("job_id", [...trackingJobIds])
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as Array<{
            id: string;
            job_id: string;
            status: string;
            latitude: number | null;
            longitude: number | null;
            eta_minutes: number | null;
            updated_at: string;
            created_at?: string;
          }>, error: null });

    const groupHelpersPromise =
      groupHelperJobIds.size > 0
        ? supabase
            .from("group_job_helpers")
            .select("id, job_id, helper_id, status, joined_at")
            .in("job_id", [...groupHelperJobIds])
        : Promise.resolve({ data: [] as Array<{
            id: string;
            job_id: string;
            helper_id: string;
            status: string;
            joined_at: string;
          }>, error: null });

    const [trackingRes, groupHelpersRes] = await Promise.all([
      trackingPromise,
      groupHelpersPromise,
    ]);

    // Pre-seed every active job with `null` so the consumer can tell
    // "not pre-fetched" (key absent) from "pre-fetched, no row yet"
    // (key present, value null) — that distinction is what lets
    // <JobTracking> skip its initial round-trip.
    for (const id of trackingJobIds) latestTracking[id] = null;
    if (!trackingRes.error) {
      for (const row of trackingRes.data ?? []) {
        // Rows arrive newest-first per `order("created_at", desc)`, so
        // the first row seen per job_id is the latest.
        if (latestTracking[row.job_id] == null) {
          latestTracking[row.job_id] = {
            id: row.id,
            status: row.status,
            latitude: row.latitude,
            longitude: row.longitude,
            eta_minutes: row.eta_minutes,
            // Generated types mark `updated_at` nullable (the column has a
            // server default), but every insert/update on this table writes
            // a fresh ISO string — so the value here is effectively
            // non-null. Fall back to the row's created_at (always set) to
            // satisfy the consumer's `string` shape.
            updated_at: row.updated_at ?? row.created_at ?? new Date().toISOString(),
          };
        }
      }
    }

    if (!groupHelpersRes.error && (groupHelpersRes.data ?? []).length > 0) {
      const rows = groupHelpersRes.data!;
      const helperIds = [...new Set(rows.map((r) => r.helper_id))];
      // Batch the profile lookup for every group helper across every job —
      // one round-trip, regardless of how many group-job cards are open.
      const { data: profiles, error: groupHelperProfilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", helperIds);
      if (groupHelperProfilesError) report(groupHelperProfilesError, { severity: "warning", tags: { source: "useActivityData.groupHelperNames" } });
      const nameMap = new Map(
        profiles?.map((p) => [p.user_id, formatName(p.full_name, "Helpr")]) ?? [],
      );
      for (const row of rows) {
        const enriched: GroupHelperLite = {
          ...row,
          helperName: nameMap.get(row.helper_id) || "Helpr",
        };
        if (!groupHelpersByJob[row.job_id]) groupHelpersByJob[row.job_id] = [];
        groupHelpersByJob[row.job_id].push(enriched);
      }
    }
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
    latestTracking,
    groupHelpersByJob,
  };
}

export function useActivityData(user: SupaUser | null) {
  const queryClient = useQueryClient();
  const userId = user?.id;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: userId ? queryKeys.activity.byUser(userId) : ["activity", "anon"],
    queryFn: () => fetchActivityData(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });

  // Realtime: invalidate the cache so React Query refetches in background.
  // Debounced so a burst of related changes (a job, its tracking row and an
  // application all updating together) collapses into one refetch instead of
  // firing fetchActivityData's full query waterfall per event.
  useEffect(() => {
    if (!userId) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.activity.byUser(userId) });
      }, 800);
    };
    const channel = supabase
      .channel(`activity-realtime-${channelNonce()}`)
      // jobs: scope to rows that can appear in this user's activity feed via
      // server-side filters, so platform-wide job churn never reaches this
      // client. postgres_changes filters are single-column — hence three.
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `customer_id=eq.${userId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `helper_id=eq.${userId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `offered_to_helper_id=eq.${userId}` }, invalidate)
      // job_tracking / applications / reviews / job_checkins — scoped to
      // rows involving this user so platform-wide write churn on these
      // high-volume tables never fans out to every connected client.
      // Each table has exactly one user-facing column that covers the
      // activity-feed perspective for the current user.
      .on("postgres_changes", { event: "*", schema: "public", table: "job_tracking", filter: `helper_id=eq.${userId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "applications", filter: `helper_id=eq.${userId}` }, invalidate)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reviews", filter: `reviewee_id=eq.${userId}` }, invalidate)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_checkins", filter: `user_id=eq.${userId}` }, invalidate)
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  const refresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const merged = data ?? EMPTY;
  return {
    loading: isLoading,
    loadError: isError,
    postedJobs: merged.postedJobs,
    appliedApps: merged.appliedApps,
    applicantCounts: merged.applicantCounts,
    startRequestedJobIds: merged.startRequestedJobIds,
    helperNames: merged.helperNames,
    completedJobMeta: merged.completedJobMeta,
    declinedJobIds: merged.declinedJobIds,
    helperReviewedJobIds: merged.helperReviewedJobIds,
    latestTracking: merged.latestTracking,
    groupHelpersByJob: merged.groupHelpersByJob,
    refresh,
  };
}

import { useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subscribeWithRecovery } from "@/lib/realtimeRecovery";
import { formatName } from "@/lib/utils";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Job, AppliedApp } from "@/components/activity/activityConstants";
import type { TrackingData } from "@/components/JobTracking";
import { queryKeys } from "@/lib/queryKeys";
import { validateResult } from "@/lib/validateResult";
import { helperApplicationsSchema } from "@/lib/schemas";
import { report } from "@/lib/errorLogger";

/* ============================================================================
   WHY THIS FILE IS FOUR QUERIES AND NOT ONE
   ----------------------------------------------------------------------------
   It used to be a single `useQuery` keyed on the USER — not on the tab — whose
   fetcher pulled everything both Activity tabs could possibly render, in nine
   dependent `await` points. Measured against a production build with the
   backend held at a fixed 200ms (Playwright + the happy-path fixtures, 375px),
   opening My Posts cost SEVEN dependent request waves and ~1.86s to the first
   card — and it paid for the My Jobs data on the way, and vice versa.

   The split:

     posted        what My Posts needs to paint a correct card   — ONE wave
     postedDetail  decoration that arrives after the list is up  — dependent
     applied       what My Jobs needs to paint a correct card    — TWO waves
     appliedDetail decoration that arrives after the list is up  — dependent

   The rule for which side of that line a field falls on is NOT "is it cheap" —
   it is "would the card render something WRONG without it". `applicantCounts`
   decides whether an open job sits in the "Needs you" bucket or "Waiting"
   (postedActivityBucket), and `helperReviewedJobIds`
   decides which primary button a card shows — so those stay in the core fetch
   even though each costs a query, and they were rewritten as embedded `!inner`
   filters on the user so they no longer have to WAIT for the job-id list
   first. Helper/poster names, tip+review badges, tracking rows and group-helper
   rosters only decorate a row that is already correct, and every consumer
   already guards on their absence, so those moved behind the paint.
   ========================================================================== */

/** Pre-fetched per-job side data — replaces what used to be one Supabase
    round-trip per rendered card. `null` means "we looked and there is no
    row yet"; absent means "we never looked" (handled gracefully by the
    consumer components). */
export interface GroupHelperLite {
  id: string;
  job_id: string;
  /** NULL once this roster member deletes their account — 20260902014651 kept
      the row and severed the identity, because the roster is the poster's
      record of who worked the job. Rendered as "Former Helpr", never as the
      generic "Helpr" fallback, which would be indistinguishable from a member
      whose profile lookup merely failed. */
  helper_id: string | null;
  status: string;
  /** Nullable per the generated DB types (has a server default but the
      column accepts NULL). Forwarded as-is to the legacy GroupJobHelpers
      shape, which never read this field. */
  joined_at: string | null;
  helperName: string;
}

/** What My Posts needs before it can paint a correct card. */
export interface PostedActivity {
  postedJobs: Job[];
  applicantCounts: Record<string, number>;
  /** Applications still awaiting the poster's decision — drives "Needs you". */
  pendingApplicantCounts: Record<string, number>;
}

/** Decoration for My Posts — resolves after the list is on screen. */
export interface PostedActivityDetail {
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  latestTracking: Record<string, TrackingData | null>;
  groupHelpersByJob: Record<string, GroupHelperLite[]>;
}

/** What My Jobs needs before it can paint a correct card. */
export interface AppliedActivity {
  /** `posterName` is deliberately absent here — it is decoration, is only
      rendered on an EXPANDED card, and every consumer already guards on it. */
  appliedApps: AppliedApp[];
  declinedJobIds: Set<string>;
  helperReviewedJobIds: Set<string>;
}

/** Decoration for My Jobs — resolves after the list is on screen. */
export interface AppliedActivityDetail {
  posterNames: Record<string, string>;
  latestTracking: Record<string, TrackingData | null>;
}

const EMPTY_POSTED: PostedActivity = {
  postedJobs: [],
  applicantCounts: {},
  pendingApplicantCounts: {},
};

const EMPTY_POSTED_DETAIL: PostedActivityDetail = {
  helperNames: {},
  completedJobMeta: {},
  latestTracking: {},
  groupHelpersByJob: {},
};

const EMPTY_APPLIED: AppliedActivity = {
  appliedApps: [],
  declinedJobIds: new Set(),
  helperReviewedJobIds: new Set(),
};

const EMPTY_APPLIED_DETAIL: AppliedActivityDetail = {
  posterNames: {},
  latestTracking: {},
};

const isActiveStatus = (s: string | null | undefined) =>
  s === "accepted" || s === "in_progress" || s === "disputed";

// ---------------------------------------------------------------------------
// MY POSTS — core
// ---------------------------------------------------------------------------

/**
 * ONE wave. The two enrichment reads are scoped to "rows belonging to a job I
 * posted" with an embedded `!inner` filter rather than an `.in(jobIds)` list,
 * so they no longer have to wait for the jobs query to come back first. That
 * server-side-join pattern is the same one useActivityBadgeCounts has used
 * against production since the nav badges shipped.
 */
export async function fetchPostedActivity(userId: string): Promise<PostedActivity> {
  // The third read here used to be `job_checkins WHERE type = 'start_request'`,
  // feeding a `startRequestedJobIds` set that gated the poster's "Confirm
  // Start" button. Nothing in this app has ever inserted a job_checkins row
  // (0 in prod), so the set was always empty and the button never rendered —
  // one query per Activity load, forever, for a control nobody could see.
  const [jobsRes, appCountRes] = await Promise.all([
    supabase.from("jobs").select("*").eq("customer_id", userId).order("created_at", { ascending: false }),
    // `status` rides along so the two counts below can be told apart. Without
    // it every application ever filed counted as an applicant, including the
    // ones already declined.
    supabase.from("applications").select("job_id, status, jobs!inner(customer_id)").eq("jobs.customer_id", userId),
  ]);

  // Surface a failed primary fetch so the screen can show an ErrorState
  // instead of a misleading "nothing here yet" empty state.
  if (jobsRes.error) throw jobsRes.error;

  // Enrichments — not fatal, but a silent drop means the poster sees 0
  // applicants and no start-request badge on jobs that actually have
  // them. Warn-report so we notice, then still degrade gracefully.
  if (appCountRes.error) {
    report(appCountRes.error, { severity: "warning", tags: { source: "useActivityData.applicantCounts" } });
  }
  /* TWO counts, deliberately.

     `applicantCounts` is EVERY application on the job. It is what the
     "Applicants (N)" button and the views→applications conversion rate in
     useJobAnalytics want: a declined applicant still applied, and dropping
     them would understate the funnel.

     `pendingApplicantCounts` is only the ones still awaiting a decision, and
     it is what the "Needs you" bucket wants. The bucket used to read the
     total, so an open job whose every applicant had been DECLINED sat under
     "Needs you" forever, insisting on a decision the poster had already made
     — and moved back out the moment any other field changed. Two different
     questions ("how many applied" vs "how many am I holding up"), so two
     different numbers. */
  const applicantCounts: Record<string, number> = {};
  const pendingApplicantCounts: Record<string, number> = {};
  (appCountRes.data ?? []).forEach((a) => {
    applicantCounts[a.job_id] = (applicantCounts[a.job_id] || 0) + 1;
    if (a.status === "pending") {
      pendingApplicantCounts[a.job_id] = (pendingApplicantCounts[a.job_id] || 0) + 1;
    }
  });

  return {
    postedJobs: jobsRes.data ?? [],
    applicantCounts,
    pendingApplicantCounts,
  };
}

// ---------------------------------------------------------------------------
// MY POSTS — deferred detail
// ---------------------------------------------------------------------------

export interface PostedDetailInputs {
  helperIds: string[];
  completedIds: string[];
  activeIds: string[];
  groupIds: string[];
}

/** The id sets `fetchPostedActivityDetail` needs, derived from the core data.
    Also the React Query key material, so the detail refetches exactly when the
    set of things it would look up has changed (including after an optimistic
    status patch moves a job into "completed" — its tip/review badge then
    genuinely matters). Sorted so key equality is order-independent. */
export function postedDetailInputs(postedJobs: Job[]): PostedDetailInputs {
  return {
    helperIds: [...new Set(postedJobs.filter((j) => j.helper_id).map((j) => j.helper_id!))].sort(),
    completedIds: postedJobs.filter((j) => j.status === "completed").map((j) => j.id).sort(),
    activeIds: postedJobs.filter((j) => isActiveStatus(j.status)).map((j) => j.id).sort(),
    groupIds: postedJobs
      .filter((j) => isActiveStatus(j.status) && j.is_group_job)
      .map((j) => j.id)
      .sort(),
  };
}

export async function fetchPostedActivityDetail(
  userId: string,
  inputs: PostedDetailInputs,
): Promise<PostedActivityDetail> {
  const { helperIds, completedIds, activeIds, groupIds } = inputs;

  const [helperProfilesRes, tipsRes, reviewsRes, trackingRes, groupHelpersRes] = await Promise.all([
    helperIds.length ? supabase.rpc("get_safe_profiles", { user_ids: helperIds }) : emptyResult<SafeProfileRow>(),
    completedIds.length
      // `payment_status = 'paid'` matters: without it ANY tips row counted as
      // "tipped", including the `pending` row create-payment writes before the
      // user reaches Stripe. So abandoning the checkout permanently locked the
      // Tip button to a disabled "Tipped" state for that job — the poster could
      // never tip, and the helper never got one, with nothing to show why.
      ? supabase.from("tips").select("job_id").in("job_id", completedIds).eq("tipper_id", userId).eq("payment_status", "paid")
      : emptyResult<{ job_id: string }>(),
    completedIds.length
      ? supabase.from("reviews").select("job_id").in("job_id", completedIds).eq("reviewer_id", userId)
      : emptyResult<{ job_id: string }>(),
    activeIds.length ? fetchTracking(activeIds) : emptyResult<TrackingRow>(),
    groupIds.length
      ? supabase.from("group_job_helpers").select("id, job_id, helper_id, status, joined_at").in("job_id", groupIds)
      : emptyResult<GroupHelperRow>(),
  ]);

  // Enrichment, not primary data — a failed name lookup degrades to the
  // "Helpr" fallback rather than blanking the tab, but must still be
  // observable (this RPC's grant has silently vanished before).
  if (helperProfilesRes.error) {
    report(helperProfilesRes.error, { severity: "warning", tags: { source: "useActivityData.helperNames" } });
  }
  // Post-completion badges (tipped / reviewed) — a silent drop makes an
  // already-tipped job re-prompt the poster to tip.
  if (tipsRes.error) report(tipsRes.error, { severity: "warning", tags: { source: "useActivityData.tipsBadge" } });
  if (reviewsRes.error) {
    report(reviewsRes.error, { severity: "warning", tags: { source: "useActivityData.reviewsBadge" } });
  }

  const helperNames: Record<string, string> = {};
  (helperProfilesRes.data ?? []).forEach((p) => {
    helperNames[p.user_id] = formatName(p.full_name, "Helpr");
  });

  const completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }> = {};
  completedIds.forEach((id) => {
    completedJobMeta[id] = { tipped: false, reviewed: false };
  });
  (tipsRes.data ?? []).forEach((t) => {
    if (completedJobMeta[t.job_id]) completedJobMeta[t.job_id].tipped = true;
  });
  (reviewsRes.data ?? []).forEach((r) => {
    if (completedJobMeta[r.job_id]) completedJobMeta[r.job_id].reviewed = true;
  });

  const groupHelpersByJob: Record<string, GroupHelperLite[]> = {};
  const groupRows = groupHelpersRes.error ? [] : (groupHelpersRes.data ?? []);
  if (groupRows.length > 0) {
    // Departed members (null helper_id) are filtered out before the `.in()`
    // list is built: a null inside a PostgREST `in.(...)` is a malformed
    // filter, not a no-match, and there is no profile to fetch for them.
    const groupHelperIds = [
      ...new Set(groupRows.map((r) => r.helper_id).filter((id): id is string => !!id)),
    ];
    // Batch the profile lookup for every group helper across every job —
    // one round-trip, regardless of how many group-job cards are open. Skipped
    // entirely when every member of every roster has departed, so we never
    // send `user_id=in.()`.
    const { data: profiles, error: groupHelperProfilesError } = groupHelperIds.length
      ? await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", groupHelperIds)
      : { data: [], error: null };
    if (groupHelperProfilesError) {
      report(groupHelperProfilesError, { severity: "warning", tags: { source: "useActivityData.groupHelperNames" } });
    }
    const nameMap = new Map(profiles?.map((p) => [p.user_id, formatName(p.full_name, "Helpr")]) ?? []);
    for (const row of groupRows) {
      (groupHelpersByJob[row.job_id] ??= []).push({
        ...row,
        helperName: row.helper_id
          ? nameMap.get(row.helper_id) || "Helpr"
          : "Former Helpr",
      });
    }
  }

  return {
    helperNames,
    completedJobMeta,
    latestTracking: latestTrackingByJob(activeIds, trackingRes),
    groupHelpersByJob,
  };
}

// ---------------------------------------------------------------------------
// MY JOBS — core
// ---------------------------------------------------------------------------

/**
 * TWO waves. Wave 1 is everything answerable from nothing but the user id —
 * the applications, the pending direct offers, the job-denial violations, the
 * reviews this helper has already written, and the start-request check-ins on
 * jobs assigned to them (again an embedded `!inner` filter rather than an id
 * list, so it doesn't have to wait). Wave 2 is the one genuinely dependent
 * read: the job rows behind the applications, without which there is no card.
 */
export async function fetchAppliedActivity(userId: string): Promise<AppliedActivity> {
  const [appsRes, directOffersRes, violationsRes, helperReviewsRes] = await Promise.all([
    supabase.from("applications").select("*").eq("helper_id", userId).order("created_at", { ascending: false }),
    // Pending direct offers come through an RPC, not the table. The street
    // address in `jobs.location` is withheld until the offer is ACCEPTED, and
    // RLS is row-level — a policy that grants the row hands over every column.
    // `get_my_pending_direct_offers()` returns the same rows (same filter,
    // same ordering) with `mask_job_location()` applied, exactly as the browse
    // RPCs already do. Accepting the offer stamps `helper_id = me`, and the
    // unchanged "Users can view their own jobs" policy then gives the full
    // address.
    supabase.rpc("get_my_pending_direct_offers"),
    supabase.from("user_violations").select("job_id").eq("user_id", userId).eq("violation_type", "job_denial"),
    // No `.in("job_id", …)` any more — one column, scoped to reviews this user
    // wrote, so it can be issued in wave 1 instead of waiting for the app list.
    supabase.from("reviews").select("job_id").eq("reviewer_id", userId),
  ]);

  const primaryError = appsRes.error || directOffersRes.error;
  if (primaryError) throw primaryError;

  // Runtime Zod check at one of the app's highest-stakes Supabase reads —
  // see validateResult.ts. The applied-jobs list drives the entire helper
  // Activity tab; a schema mismatch here means wrong status badges, stale
  // proposed rates, or missing applications. Logged-only — the screen
  // still renders the raw payload on drift.
  if (appsRes.data) {
    validateResult(helperApplicationsSchema, appsRes.data, "useActivityData.applicationsForHelper");
  }

  // Enrichments — a dropped violations fetch would show declined jobs as
  // normal-pending, a dropped checkins fetch would hide start-request
  // badges, and a dropped reviews fetch would re-prompt for a review the
  // helper already left. Warn-report + degrade rather than crash.
  if (violationsRes.error) {
    report(violationsRes.error, { severity: "warning", tags: { source: "useActivityData.helperDeclinedJobs" } });
  }
  if (helperReviewsRes.error) {
    report(helperReviewsRes.error, { severity: "warning", tags: { source: "useActivityData.helperReviews" } });
  }

  let appliedApps: AppliedApp[] = [];
  const apps = appsRes.data ?? [];
  if (apps.length > 0) {
    const jobIds = new Set(apps.map((a) => a.job_id));
    // Also an RPC rather than `.in("id", jobIds)`, for the same reason as the
    // direct offers above: a helper with a merely PENDING application is not
    // entitled to the poster's street address, and no RLS policy can withhold
    // one column. `get_jobs_for_my_applications()` returns the identical row
    // set (proven equal to the policy predicates over live data) with the
    // address masked to "City, ST" — unless I'm the poster or the assigned
    // helper, who still get it in full. The RPC is keyed off my applications
    // server-side, so it needs no id list; we still intersect with `jobIds`
    // to keep the map scoped to the apps in this payload.
    const jobsRes = await supabase.rpc("get_jobs_for_my_applications");
    // The applied-jobs list is meaningless without the job rows behind it —
    // a failed jobs fetch would leave every app with `job: null` and render
    // a blank tab. Surface it as a query error, like the primary fetches.
    if (jobsRes.error) throw jobsRes.error;
    const jobMap = new Map(
      (jobsRes.data ?? []).filter((j) => jobIds.has(j.id)).map((j) => [j.id, j]),
    );
    appliedApps = apps.map((a) => ({ ...a, job: jobMap.get(a.job_id) || null }));
  }

  const directOffers = directOffersRes.data ?? [];
  if (directOffers.length > 0) {
    const synthetic: AppliedApp[] = directOffers.map((job) => ({
      id: `direct-${job.id}`,
      job_id: job.id,
      helper_id: userId,
      status: "pending",
      message: null,
      offer_message: null,
      // A direct offer has NO `applications` row behind it — this literal is
      // the synthetic stand-in for one, and `get_my_pending_direct_offers()`
      // returns `jobs` rows, which carry no decline reason to copy. The offer
      // is pending by construction (that RPC returns only pending offers), so
      // it has never been declined and the column's own default, null, is the
      // truthful value — same as `message` / `offer_message` above. A real
      // decline goes through `useOfferHandlers`, which writes the reason onto
      // a real row.
      decline_reason: null,
      attachment_urls: null,
      poster_viewed_at: null,
      stake_amount: null,
      stake_status: "none",
      created_at: job.created_at,
      updated_at: job.updated_at,
      job,
    }));
    const existingIds = new Set(appliedApps.map((a) => a.job_id));
    appliedApps = [...synthetic.filter((s) => !existingIds.has(s.job_id)), ...appliedApps];
  }

  return {
    appliedApps,
    declinedJobIds: new Set(
      (violationsRes.data ?? []).map((v) => v.job_id).filter((id): id is string => Boolean(id)),
    ),
    helperReviewedJobIds: new Set((helperReviewsRes.data ?? []).map((r) => r.job_id)),
  };
}

// ---------------------------------------------------------------------------
// MY JOBS — deferred detail
// ---------------------------------------------------------------------------

export interface AppliedDetailInputs {
  posterIds: string[];
  activeIds: string[];
}

export function appliedDetailInputs(appliedApps: AppliedApp[]): AppliedDetailInputs {
  return {
    posterIds: [
      ...new Set(appliedApps.map((a) => a.job?.customer_id).filter((id): id is string => Boolean(id))),
    ].sort(),
    activeIds: appliedApps
      .filter((a) => a.job && isActiveStatus(a.job.status) && a.status === "accepted")
      .map((a) => a.job_id)
      .sort(),
  };
}

export async function fetchAppliedActivityDetail(
  inputs: AppliedDetailInputs,
): Promise<AppliedActivityDetail> {
  const { posterIds, activeIds } = inputs;
  const [profilesRes, trackingRes] = await Promise.all([
    posterIds.length ? supabase.rpc("get_safe_profiles", { user_ids: posterIds }) : emptyResult<SafeProfileRow>(),
    activeIds.length ? fetchTracking(activeIds) : emptyResult<TrackingRow>(),
  ]);
  if (profilesRes.error) {
    report(profilesRes.error, { severity: "warning", tags: { source: "useActivityData.posterNames" } });
  }
  const posterNames: Record<string, string> = {};
  (profilesRes.data ?? []).forEach((p) => {
    posterNames[p.user_id] = formatName(p.full_name);
  });
  return { posterNames, latestTracking: latestTrackingByJob(activeIds, trackingRes) };
}

// ---------------------------------------------------------------------------
// Shared query helpers
// ---------------------------------------------------------------------------

interface Result<T> {
  data: T[] | null;
  error: unknown;
}

/** A resolved "we didn't need to ask" result, shaped like a Supabase one. */
function emptyResult<T>(): Promise<Result<T>> {
  return Promise.resolve({ data: null, error: null });
}

type SafeProfileRow = { user_id: string; full_name: string | null };

type GroupHelperRow = {
  id: string;
  job_id: string;
  /** Nullable — see GroupHelperLite.helper_id. */
  helper_id: string | null;
  status: string;
  joined_at: string | null;
};

type TrackingRow = {
  id: string;
  job_id: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  eta_minutes: number | null;
  updated_at: string | null;
  created_at?: string | null;
};

/** Pull every tracking row for the relevant job set in one query; the caller
    keeps just the latest per job_id. Activity feeds have small active-job
    counts, so the extra rows are cheap compared with N round-trips. */
function fetchTracking(jobIds: string[]) {
  return supabase
    .from("job_tracking")
    .select("id, job_id, status, latitude, longitude, eta_minutes, updated_at, created_at")
    .in("job_id", jobIds)
    .order("created_at", { ascending: false });
}

function latestTrackingByJob(
  jobIds: string[],
  res: Result<TrackingRow>,
): Record<string, TrackingData | null> {
  const latestTracking: Record<string, TrackingData | null> = {};
  // Pre-seed every active job with `null` so the consumer can tell
  // "not pre-fetched" (key absent) from "pre-fetched, no row yet"
  // (key present, value null) — that distinction is what lets
  // <JobTracking> skip its initial round-trip.
  for (const id of jobIds) latestTracking[id] = null;
  if (res.error) return latestTracking;
  for (const row of res.data ?? []) {
    // Rows arrive newest-first per `order("created_at", desc)`, so the
    // first row seen per job_id is the latest.
    if (latestTracking[row.job_id] == null) {
      latestTracking[row.job_id] = {
        id: row.id,
        status: row.status,
        latitude: row.latitude,
        longitude: row.longitude,
        eta_minutes: row.eta_minutes,
        // Generated types mark `updated_at` nullable (the column has a
        // server default), but every insert/update on this table writes
        // a fresh ISO string — so the value here is effectively non-null.
        // Fall back to the row's created_at (always set) to satisfy the
        // consumer's `string` shape.
        updated_at: row.updated_at ?? row.created_at ?? new Date().toISOString(),
      };
    }
  }
  return latestTracking;
}

// ---------------------------------------------------------------------------
// Cache warming
// ---------------------------------------------------------------------------

const CORE_STALE = 60 * 1000;

/** Warm BOTH tabs' core caches (the Dashboard idle prefetch). The detail
    queries are deliberately NOT prefetched — they are keyed on the core data,
    so they cannot even be issued until the core has landed, and nothing on a
    first-paint path waits for them. */
export function prefetchActivityCores(queryClient: QueryClient, userId: string) {
  queryClient.prefetchQuery({
    queryKey: queryKeys.activity.posted(userId),
    queryFn: () => fetchPostedActivity(userId),
    staleTime: CORE_STALE,
  });
  queryClient.prefetchQuery({
    queryKey: queryKeys.activity.applied(userId),
    queryFn: () => fetchAppliedActivity(userId),
    staleTime: CORE_STALE,
  });
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * @param tab which Activity tab is on screen. ONLY that tab's data blocks the
 *        first paint; the other tab's core is warmed on idle so switching
 *        still comes out of cache.
 */
export function useActivityData(user: SupaUser | null, tab: "posted" | "applied" = "posted") {
  const queryClient = useQueryClient();
  const userId = user?.id;
  const isPosted = tab === "posted";

  const postedCore = useQuery({
    queryKey: userId ? queryKeys.activity.posted(userId) : ["activity", "posted", "anon"],
    queryFn: () => fetchPostedActivity(userId!),
    enabled: !!userId && isPosted,
    staleTime: CORE_STALE,
  });

  const appliedCore = useQuery({
    queryKey: userId ? queryKeys.activity.applied(userId) : ["activity", "applied", "anon"],
    queryFn: () => fetchAppliedActivity(userId!),
    enabled: !!userId && !isPosted,
    staleTime: CORE_STALE,
  });

  const postedJobs = postedCore.data?.postedJobs;
  const postedInputs = useMemo(() => postedDetailInputs(postedJobs ?? []), [postedJobs]);
  const postedDetail = useQuery({
    queryKey: userId
      ? queryKeys.activity.postedDetail(userId, postedInputs)
      : ["activity", "postedDetail", "anon"],
    queryFn: () => fetchPostedActivityDetail(userId!, postedInputs),
    enabled: !!userId && isPosted && !!postedJobs,
    staleTime: CORE_STALE,
  });

  const appliedApps = appliedCore.data?.appliedApps;
  const appliedInputs = useMemo(() => appliedDetailInputs(appliedApps ?? []), [appliedApps]);
  const appliedDetail = useQuery({
    queryKey: userId
      ? queryKeys.activity.appliedDetail(userId, appliedInputs)
      : ["activity", "appliedDetail", "anon"],
    queryFn: () => fetchAppliedActivityDetail(appliedInputs),
    enabled: !!userId && !isPosted && !!appliedApps,
    staleTime: CORE_STALE,
  });

  // Warm the OTHER tab's core once this one is painted. My Posts and My Jobs
  // are separate routes, so without this the switch would pay its own cold
  // wave; with it, it comes out of cache.
  const activeCoreSettled = (isPosted ? postedCore : appliedCore).isFetched;
  useEffect(() => {
    // Not until THIS tab's core has landed. requestIdleCallback fires happily
    // while the page is waiting on the network, and an early warm would put a
    // second tab's worth of requests alongside the ones the first card is
    // waiting for.
    if (!userId || !activeCoreSettled) return;
    const run = () => {
      if (isPosted) {
        queryClient.prefetchQuery({
          queryKey: queryKeys.activity.applied(userId),
          queryFn: () => fetchAppliedActivity(userId),
          staleTime: CORE_STALE,
        });
      } else {
        queryClient.prefetchQuery({
          queryKey: queryKeys.activity.posted(userId),
          queryFn: () => fetchPostedActivity(userId),
          staleTime: CORE_STALE,
        });
      }
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: object) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    // Safari / WKWebView has no requestIdleCallback — a plain timer past the
    // first-paint budget is the equivalent guarantee there.
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(run, { timeout: 2000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(run, 1200);
    return () => clearTimeout(t);
  }, [userId, activeCoreSettled, isPosted, queryClient]);

  // Realtime: invalidate the whole activity cache — both tabs' cores AND their
  // details, via the ["activity"] prefix — so React Query refetches in the
  // background. Debounced so a burst of related changes (a job, its tracking
  // row and an application all updating together) collapses into one refetch
  // instead of firing every query in the family per event.
  useEffect(() => {
    if (!userId) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
      }, 800);
    };
    // A failed channel is a SILENT failure — the app renders fine, it just
    // never hears about anyone else's writes.
    //
    // This was a local `observeStatus` that reported to Sentry and stopped
    // there: useful to us, invisible to the person holding a screen that had
    // quietly stopped updating, and it never reconnected. It is now
    // subscribeWithRecovery, which keeps the Sentry report, adds backoff,
    // publishes the outage to the global banner, and invalidates on the way
    // back so the writes made during the gap are actually read.
    // CORE channel — jobs / notifications / job_tracking / applications.
    // Every binding here MUST be on a table in the `supabase_realtime`
    // publication: Realtime rejects a channel containing ANY binding on an
    // unpublished table, and the whole channel dies — none of its bindings
    // deliver. That is exactly how the poster's My Posts card went
    // permanently stale (a `reviews` binding used to sit on this channel
    // while `reviews` was unpublished, killing the jobs bindings with it).
    // src/test/realtimePublication.test.ts now cross-checks every binding
    // against the migrations' publication set.
    const coreSub = subscribeWithRecovery(
      (name) => supabase
      .channel(name)
      // jobs: scope to rows that can appear in this user's activity feed via
      // server-side filters, so platform-wide job churn never reaches this
      // client. postgres_changes filters are single-column — hence three.
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `customer_id=eq.${userId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `helper_id=eq.${userId}` }, invalidate)
      // Pending direct offers are NOT covered by a `jobs` filter any more: the
      // helper has no RLS SELECT grant on an unaccepted offer (that policy
      // leaked the street address), and Realtime only delivers rows the
      // subscriber can read. The DB trigger that creates the offer also
      // inserts a notification addressed to the offered helper, so this
      // channel carries the same wake-up — and it is a row the helper is
      // genuinely entitled to.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, invalidate)
      // job_tracking / applications — scoped to rows involving this user so
      // platform-wide write churn on these high-volume tables never fans out
      // to every connected client.
      .on("postgres_changes", { event: "*", schema: "public", table: "job_tracking", filter: `helper_id=eq.${userId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "applications", filter: `helper_id=eq.${userId}` }, invalidate),
      { name: "activity-realtime", onRecovered: invalidate },
    );
    // reviews rides on its OWN channel: it was added to the publication by
    // migration 20260829061737, but isolating it means that if publication
    // membership ever regresses (or the deploy lags the code), only the
    // review-received invalidation dies — the jobs/applications/tracking
    // bindings above keep delivering.
    const reviewsSub = subscribeWithRecovery(
      (name) => supabase
      .channel(name)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reviews", filter: `reviewee_id=eq.${userId}` }, invalidate),
      { name: "activity-reviews", onRecovered: invalidate },
    );
    return () => {
      if (debounce) clearTimeout(debounce);
      coreSub.close();
      reviewsSub.close();
    };
  }, [userId, queryClient]);

  const postedRefetch = postedCore.refetch;
  const postedDetailRefetch = postedDetail.refetch;
  const appliedRefetch = appliedCore.refetch;
  const appliedDetailRefetch = appliedDetail.refetch;
  const refresh = useCallback(async () => {
    // Only the visible tab — the other one is warmed on idle and revalidated
    // by realtime; refetching it here would put its waterfall back in front of
    // the pull-to-refresh spinner this tab is showing.
    //
    // AWAITED, deliberately: pull-to-refresh awaits this callback to decide
    // when to drop its spinner. The old fire-and-forget version resolved
    // immediately, so the spinner vanished before the network round-trip —
    // and when a refetch failed (e.g. expired token after an iOS resume) the
    // gesture looked successful while the screen silently kept stale rows.
    // React Query's refetch() never rejects (errors land in query state), so
    // inspect the settled results and surface a failed pull-to-refresh.
    const results = isPosted
      ? await Promise.all([postedRefetch(), postedDetailRefetch()])
      : await Promise.all([appliedRefetch(), appliedDetailRefetch()]);
    const failed = results.find((r) => r.status === "error");
    if (failed) {
      report(failed.error ?? new Error("activity refresh refetch failed"), {
        severity: "warning",
        tags: { source: "useActivityData.refresh", tab: isPosted ? "posted" : "applied" },
      });
    }
  }, [isPosted, postedRefetch, postedDetailRefetch, appliedRefetch, appliedDetailRefetch]);

  const posted = postedCore.data ?? EMPTY_POSTED;
  const postedD = postedDetail.data ?? EMPTY_POSTED_DETAIL;
  const applied = appliedCore.data ?? EMPTY_APPLIED;
  const appliedD = appliedDetail.data ?? EMPTY_APPLIED_DETAIL;

  // Hydrate poster names onto the applied rows once the detail lands. Until
  // then `posterName` is undefined, and every consumer guards on that (the
  // "Posted by" line only renders on an expanded card, and the review dialog
  // falls back to "Poster") — so nothing paints a placeholder that then
  // changes under the reader.
  const appliedAppsList = applied.appliedApps;
  const posterNames = appliedD.posterNames;
  const appliedAppsWithNames = useMemo(() => {
    if (Object.keys(posterNames).length === 0) return appliedAppsList;
    return appliedAppsList.map((a) => {
      if (!a.job) return a;
      // `customer_id` is nullable since 20260901033011 — a poster who deleted
      // their account leaves the job standing with no owner. Null is not a
      // key: `posterNames` is only ever built from the non-null ids collected
      // at line 438, so an ownerless job simply falls through to the existing
      // "a neighbor" fallback rather than indexing the record with null.
      const posterId = a.job.customer_id;
      const name = posterId ? posterNames[posterId] : undefined;
      return { ...a, posterName: name ?? "a neighbor" };
    });
  }, [appliedAppsList, posterNames]);

  const activeCore = isPosted ? postedCore : appliedCore;

  return {
    loading: activeCore.isLoading,
    loadError: activeCore.isError,
    postedJobs: posted.postedJobs,
    appliedApps: appliedAppsWithNames,
    applicantCounts: posted.applicantCounts,
    pendingApplicantCounts: posted.pendingApplicantCounts,
    helperNames: postedD.helperNames,
    completedJobMeta: postedD.completedJobMeta,
    declinedJobIds: applied.declinedJobIds,
    helperReviewedJobIds: applied.helperReviewedJobIds,
    latestTracking: isPosted ? postedD.latestTracking : appliedD.latestTracking,
    groupHelpersByJob: postedD.groupHelpersByJob,
    refresh,
  };
}

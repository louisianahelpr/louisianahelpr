import { useMemo } from "react";
import type { Job, AppliedApp } from "@/components/activity/activityConstants";
import { jobStatusLabel } from "@/lib/statusLabels";
import { jobStatusColorClasses } from "@/lib/statusColors";

/**
 * activityFilters — status-filter definitions and the memoized list/count
 * derivations for the Activity page.
 *
 * Filter keys that match a `job_status` enum value pull their label from
 * `jobStatusLabel` (#46) AND their color classes from
 * `jobStatusColorClasses` (`src/lib/statusColors.ts`) so the filter
 * chip paints the same as the row chip a tap later. Keys that are
 * derived buckets ("direct_offer", "offered", "not_selected", "pending"
 * meaning "Applied") aren't enum values, so they keep a bespoke palette
 * intentionally distinct from any single enum state.
 */

export interface StatusFilter {
  key: string;
  label: string;
  color: string;
}

// Neutral palette for broad-bucket filters (All, Active).
const ALL_FILTER_COLOR = "bg-[hsl(var(--olivewood)/0.08)] text-[hsl(var(--olivewood))] border-[hsl(var(--olivewood)/0.18)]";

// Granular sub-status filters (Open, Accepted, In Progress, etc.) are
// intentionally omitted — those statuses are surfaced as colored banners
// on each job card, so the filter sheet stays at the high-level bucket level.
export const POSTED_STATUS_FILTERS: StatusFilter[] = [
  { key: "all",       label: "All",                      color: ALL_FILTER_COLOR },
  { key: "active",    label: "Active",                   color: ALL_FILTER_COLOR },
  { key: "completed", label: jobStatusLabel("completed"), color: jobStatusColorClasses("completed") },
  { key: "cancelled", label: jobStatusLabel("cancelled"), color: jobStatusColorClasses("cancelled") },
];

export const APPLIED_STATUS_FILTERS: StatusFilter[] = [
  { key: "active",       label: "Active",                    color: ALL_FILTER_COLOR },
  { key: "all",          label: "All",                       color: ALL_FILTER_COLOR },
  { key: "completed",    label: jobStatusLabel("completed"), color: jobStatusColorClasses("completed") },
];

/**
 * Section bucket — used by the grouped "All" view to fold every status
 * into Active / Completed / Cancelled. Each list/card on the screen
 * goes through one of these three buckets exactly once.
 */
export type Bucket = "active" | "completed" | "cancelled";

/** Classify a posted job into Active / Completed / Cancelled. */
export function bucketPostedJob(job: { status: string }): Bucket {
  switch (job.status) {
    case "completed": return "completed";
    case "cancelled":
    case "disputed":  return "cancelled";
    default:          return "active"; // open / accepted / in_progress / revision_requested / direct_offer holders
  }
}

/**
 * Is this card waiting on the helper right now?
 *
 * Two states qualify, and they are the two where the job is being HELD for
 * this helper and lapses if they do nothing:
 *   - a pending direct offer from a poster, and
 *   - an accepted application the helper has not yet confirmed.
 *
 * `helper_confirmed_at` is the discriminator for the second: an application
 * can read `accepted` while the helper still has to say yes.
 */
export function needsHelperResponse(app: {
  status: string;
  job?: { status?: string; direct_offer_status?: string | null; helper_confirmed_at?: string | null } | null;
}): boolean {
  if (app.job?.direct_offer_status === "pending") return true;
  return (
    app.status === "accepted" &&
    (app.job?.status === "accepted" || app.job?.status === "open") &&
    !app.job?.helper_confirmed_at
  );
}

export function bucketAppliedApp(app: { status: string; job?: { status: string } | null }): Bucket {
  const jobStatus = app.job?.status;
  if (jobStatus === "completed") return "completed";
  if (jobStatus === "cancelled") return "cancelled";
  if (app.status === "rejected") return "cancelled";
  return "active";
}

export interface UseActivityFiltersArgs {
  postedJobs: Job[];
  appliedApps: AppliedApp[];
  statusFilter: string;
  searchQuery: string;
  userId: string | undefined;
}

export function useActivityFilters({
  postedJobs,
  appliedApps,
  statusFilter,
  searchQuery,
  userId,
}: UseActivityFiltersArgs) {
  const searchLower = searchQuery.toLowerCase().trim();

  const filteredPostedJobs = useMemo(() =>
    postedJobs.filter((j) => {
      // Status filter — "all" disables the status gate; the page renders
      // groups instead. Search still applies in both modes.
      let statusMatch: boolean;
      if (statusFilter === "all") statusMatch = true;
      else if (statusFilter === "active") statusMatch = bucketPostedJob(j) === "active";
      else if (statusFilter === "direct_offer") statusMatch = !!j.offered_to_helper_id && j.direct_offer_status === "pending";
      else if (statusFilter === "offered") statusMatch = j.status === "accepted" && !j.helper_confirmed_at;
      else if (statusFilter === "accepted") statusMatch = j.status === "accepted" && !!j.helper_confirmed_at;
      else if (statusFilter === "cancelled") statusMatch = j.status === "cancelled" || j.status === "disputed";
      else statusMatch = j.status === statusFilter && !(statusFilter === "open" && j.direct_offer_status === "pending");
      if (!statusMatch) return false;
      // Search filter
      if (searchLower) {
        return j.title.toLowerCase().includes(searchLower) || j.description.toLowerCase().includes(searchLower) || j.location.toLowerCase().includes(searchLower);
      }
      return true;
    }), [postedJobs, statusFilter, searchLower]);

  const filteredAppliedApps = useMemo(() => {
    const query = searchLower;
    return appliedApps.filter((a) => {
      let statusMatch = false;
      if (statusFilter === "all") statusMatch = bucketAppliedApp(a) !== "cancelled";
      else if (statusFilter === "active") statusMatch = bucketAppliedApp(a) === "active";
      else if (statusFilter === "direct_offer") statusMatch = !!a.job?.offered_to_helper_id && a.job?.offered_to_helper_id === userId && a.job?.direct_offer_status === "pending";
      else if (statusFilter === "pending") statusMatch = a.status === "pending" && a.job?.status !== "cancelled";
      else if (statusFilter === "offered") statusMatch = a.status === "accepted" && a.job?.status === "accepted" && !a.job?.helper_confirmed_at;
      else if (statusFilter === "accepted") statusMatch = a.status === "accepted" && a.job?.status === "accepted" && !!a.job?.helper_confirmed_at;
      else if (statusFilter === "in_progress") statusMatch = a.status === "accepted" && a.job?.status === "in_progress";
      else if (statusFilter === "disputed") statusMatch = a.status === "accepted" && a.job?.status === "disputed";
      else if (statusFilter === "revision") statusMatch = a.status === "accepted" && a.job?.status === "revision_requested";
      else if (statusFilter === "completed") statusMatch = a.status === "accepted" && a.job?.status === "completed";
      else if (statusFilter === "not_selected") statusMatch = a.status === "rejected" || a.job?.status === "cancelled";
      if (!statusMatch) return false;
      if (query && a.job) {
        return a.job.title.toLowerCase().includes(query) || a.job.description.toLowerCase().includes(query) || a.job.location.toLowerCase().includes(query);
      }
      return true;
    })
      // Anything waiting on the HELPER floats to the top of the list.
      //
      // Owner: "Offered to you should always be shown first — I don't want them
      // to miss an offer." A direct offer and an unconfirmed booking are the
      // only two states where a job is being held for this helper and will be
      // given away if they do nothing. Everything else — applications out for
      // review, work already booked, jobs in progress — can wait its turn,
      // because nothing expires while the helper reads it.
      //
      // A STABLE partition, not a re-sort: within each group the existing
      // order is preserved untouched, so this only ever lifts the time-critical
      // cards past the ones that aren't.
      .sort((a, b) => Number(needsHelperResponse(b)) - Number(needsHelperResponse(a)));
    // Dep list intentionally matches the pre-refactor Activity.tsx exactly
    // (userId omitted) to preserve identical memo behavior — userId comes
    // from a stable session and the page only renders past `loading`.
  }, [appliedApps, statusFilter, searchLower]);

  const appliedCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, active: 0, pending: 0, direct_offer: 0, offered: 0, accepted: 0, in_progress: 0, revision: 0, completed: 0, disputed: 0, not_selected: 0 };
    appliedApps.forEach((a) => {
      const bucket = bucketAppliedApp(a);
      // "all" excludes not-selected (rejected / cancelled) — mirrors filteredAppliedApps.
      if (bucket !== "cancelled") counts.all++;
      // Counted separately from the chain below, not inside it: "active" is a
      // BUCKET that overlaps several of the single-status counters, so it must
      // not consume an `else if` branch and steal rows from them.
      if (bucket === "active") counts.active++;
      if (a.job?.offered_to_helper_id === userId && a.job?.direct_offer_status === "pending") counts.direct_offer++;
      if (a.status === "pending" && a.job?.status !== "cancelled") counts.pending++;
      else if (a.status === "accepted" && a.job?.status === "accepted" && !a.job?.helper_confirmed_at) counts.offered++;
      else if (a.status === "accepted" && a.job?.status === "accepted" && !!a.job?.helper_confirmed_at) counts.accepted++;
      else if (a.status === "accepted" && a.job?.status === "in_progress") counts.in_progress++;
      else if (a.status === "accepted" && a.job?.status === "disputed") counts.disputed++;
      else if (a.status === "accepted" && a.job?.status === "revision_requested") counts.revision++;
      else if (a.status === "accepted" && a.job?.status === "completed") counts.completed++;
      else if (a.status === "rejected" || a.job?.status === "cancelled") counts.not_selected++;
    });
    return counts;
  }, [appliedApps]);

  const postedCounts = useMemo(() => {
    const counts: Record<string, number> = { all: postedJobs.length, active: 0, open: 0, direct_offer: 0, offered: 0, accepted: 0, in_progress: 0, revision_requested: 0, completed: 0, cancelled: 0, disputed: 0 };
    postedJobs.forEach((j) => {
      if (bucketPostedJob(j) === "active") counts.active++;
      if (j.offered_to_helper_id && j.direct_offer_status === "pending") counts.direct_offer++;
      if (j.status === "accepted" && !j.helper_confirmed_at) counts.offered++;
      else if (j.status === "accepted" && !!j.helper_confirmed_at) counts.accepted++;
      else counts[j.status] = (counts[j.status] || 0) + 1;
    });
    // The Cancelled filter folds disputed in (mirroring bucketPostedJob),
    // so its chip count must include both terminal-negative states.
    counts.cancelled = (counts.cancelled || 0) + (counts.disputed || 0);
    return counts;
  }, [postedJobs]);

  return { filteredPostedJobs, filteredAppliedApps, appliedCounts, postedCounts };
}

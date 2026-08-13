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

// Derived-bucket palettes — these are NOT enum values, so they
// deliberately read different from any single job_status. Kept inline
// because the canonical statusColors map only covers enum values.
const DERIVED_DIRECT_OFFER =
  "bg-destructive/15 text-destructive border-destructive/30";
const DERIVED_OFFERED =
  "bg-warning/15 text-warning border-warning/30";
const DERIVED_PENDING_APPLIED = "bg-secondary text-secondary-foreground border-border";
const DERIVED_NOT_SELECTED = "bg-destructive/15 text-destructive border-destructive/30";

// "All" key — when active, the page swaps the single filtered list for
// the grouped/collapsible Active / Completed / Cancelled view defined
// below. Painted neutrally so it doesn't compete with the per-status
// dots that follow it in the dropdown.
const ALL_FILTER_COLOR = "bg-[hsl(var(--olivewood)/0.08)] text-[hsl(var(--olivewood))] border-[hsl(var(--olivewood)/0.18)]";

export const POSTED_STATUS_FILTERS: StatusFilter[] = [
  // "All" — the default landing view. Shows the grouped Active / Completed /
  // Cancelled sectioned layout so nothing is hidden on first open.
  { key: "all",          label: "All",                          color: ALL_FILTER_COLOR },
  // "Active" — folds every non-terminal status into one flat list.
  { key: "active",       label: "Active",                       color: ALL_FILTER_COLOR },
  { key: "open",         label: jobStatusLabel("open"),         color: jobStatusColorClasses("open") },
  { key: "direct_offer", label: "Direct Offers",                color: DERIVED_DIRECT_OFFER },
  // "Awaiting Helpr's Response" — the poster sent an offer; the helpr hasn't confirmed yet.
  { key: "offered",      label: "Awaiting Helpr's Response",    color: DERIVED_OFFERED },
  { key: "accepted",     label: jobStatusLabel("accepted"),     color: jobStatusColorClasses("accepted") },
  { key: "in_progress",  label: jobStatusLabel("in_progress"),  color: jobStatusColorClasses("in_progress") },
  { key: "completed",    label: jobStatusLabel("completed"),    color: jobStatusColorClasses("completed") },
  // Cancelled is a terminal bucket like Completed, so it gets its own
  // filter rather than living only inside the grouped "All" view. It
  // folds disputed in, mirroring `bucketPostedJob`.
  { key: "cancelled",    label: jobStatusLabel("cancelled"),    color: jobStatusColorClasses("cancelled") },
];

export const APPLIED_STATUS_FILTERS: StatusFilter[] = [
  // "Active" — the default landing view, mirroring POSTED_STATUS_FILTERS so
  // My Jobs and My Posts open on the same word instead of one saying "Active"
  // and the other "All". Folds every application that is still live (applied /
  // direct offer / awaiting my response / accepted / in progress) into one
  // flat list. Defined by `bucketAppliedApp`, so it means exactly what the
  // grouped view's ACTIVE section means — one definition, not two.
  { key: "active",       label: "Active",                       color: ALL_FILTER_COLOR },
  { key: "all",          label: "All",                          color: ALL_FILTER_COLOR },
  { key: "pending",      label: "Applied",                      color: DERIVED_PENDING_APPLIED },
  { key: "direct_offer", label: "Direct Offers",                color: DERIVED_DIRECT_OFFER },
  // "Respond to Offer" — the poster selected me; I need to accept or decline.
  { key: "offered",      label: "Respond to Offer",             color: DERIVED_OFFERED },
  { key: "accepted",     label: jobStatusLabel("accepted"),     color: jobStatusColorClasses("accepted") },
  { key: "in_progress",  label: jobStatusLabel("in_progress"),  color: jobStatusColorClasses("in_progress") },
  { key: "completed",    label: jobStatusLabel("completed"),    color: jobStatusColorClasses("completed") },
  { key: "not_selected", label: "Not Selected",                 color: DERIVED_NOT_SELECTED },
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

/** Classify an applied application into Active / Completed / Cancelled. */
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
      if (statusFilter === "all") statusMatch = true;
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
    });
    // Dep list intentionally matches the pre-refactor Activity.tsx exactly
    // (userId omitted) to preserve identical memo behavior — userId comes
    // from a stable session and the page only renders past `loading`.
  }, [appliedApps, statusFilter, searchLower]);

  const appliedCounts = useMemo(() => {
    const counts: Record<string, number> = { all: appliedApps.length, active: 0, pending: 0, direct_offer: 0, offered: 0, accepted: 0, in_progress: 0, revision: 0, completed: 0, disputed: 0, not_selected: 0 };
    appliedApps.forEach((a) => {
      // Counted separately from the chain below, not inside it: "active" is a
      // BUCKET that overlaps several of the single-status counters, so it must
      // not consume an `else if` branch and steal rows from them.
      if (bucketAppliedApp(a) === "active") counts.active++;
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

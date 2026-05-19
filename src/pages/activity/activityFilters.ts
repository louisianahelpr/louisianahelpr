import { useMemo } from "react";
import type { Job, AppliedApp } from "@/components/activity/activityConstants";

/**
 * activityFilters — status-filter definitions and the memoized list/count
 * derivations for the Activity page.
 */

export interface StatusFilter {
  key: string;
  label: string;
  color: string;
}

export const POSTED_STATUS_FILTERS: StatusFilter[] = [
  { key: "open", label: "Open", color: "bg-primary/15 text-primary border-primary/30" },
  { key: "direct_offer", label: "Direct Offers", color: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 dark:border-rose-500/40" },
  // "Awaiting Helpr's Response" — the poster sent an offer; the helpr hasn't confirmed yet.
  { key: "offered", label: "Awaiting Helpr's Response", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 dark:border-amber-500/40" },
  { key: "accepted", label: "Accepted", color: "bg-primary/15 text-primary border-primary/30" },
  { key: "in_progress", label: "In Progress", color: "bg-accent/15 text-accent-foreground border-accent/30" },
  { key: "completed", label: "Completed", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 dark:border-green-500/40" },
];

export const APPLIED_STATUS_FILTERS: StatusFilter[] = [
  { key: "pending", label: "Applied", color: "bg-secondary text-secondary-foreground border-border" },
  { key: "direct_offer", label: "Direct Offers", color: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 dark:border-rose-500/40" },
  // "Respond to Offer" — the poster selected me; I need to accept or decline.
  { key: "offered", label: "Respond to Offer", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 dark:border-amber-500/40" },
  { key: "accepted", label: "Accepted", color: "bg-primary/15 text-primary border-primary/30" },
  { key: "in_progress", label: "In Progress", color: "bg-accent/15 text-accent-foreground border-accent/30" },
  { key: "completed", label: "Completed", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 dark:border-green-500/40" },
  { key: "not_selected", label: "Not Selected", color: "bg-destructive/15 text-destructive border-destructive/30" },
];

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
      // Status filter
      let statusMatch: boolean;
      if (statusFilter === "direct_offer") statusMatch = !!j.offered_to_helper_id && j.direct_offer_status === "pending";
      else if (statusFilter === "offered") statusMatch = j.status === "accepted" && !j.helper_confirmed_at;
      else if (statusFilter === "accepted") statusMatch = j.status === "accepted" && !!j.helper_confirmed_at;
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
      if (statusFilter === "direct_offer") statusMatch = !!a.job?.offered_to_helper_id && a.job?.offered_to_helper_id === userId && a.job?.direct_offer_status === "pending";
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
    const counts: Record<string, number> = { pending: 0, direct_offer: 0, offered: 0, accepted: 0, in_progress: 0, revision: 0, completed: 0, disputed: 0, not_selected: 0 };
    appliedApps.forEach((a) => {
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
    const counts: Record<string, number> = { open: 0, direct_offer: 0, offered: 0, accepted: 0, in_progress: 0, revision_requested: 0, completed: 0, cancelled: 0, disputed: 0 };
    postedJobs.forEach((j) => {
      if (j.offered_to_helper_id && j.direct_offer_status === "pending") counts.direct_offer++;
      if (j.status === "accepted" && !j.helper_confirmed_at) counts.offered++;
      else if (j.status === "accepted" && !!j.helper_confirmed_at) counts.accepted++;
      else counts[j.status] = (counts[j.status] || 0) + 1;
    });
    return counts;
  }, [postedJobs]);

  return { filteredPostedJobs, filteredAppliedApps, appliedCounts, postedCounts };
}

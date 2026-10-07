import type { Stats } from "@/components/admin/dashboard/types";

/**
 * The admin rail's badge count for one view (the sidebar and the desktop nav
 * show the same numbers, AM-011). Q1071: Stuck Jobs counts the jobs escalated
 * to a person and not yet resolved, the same awaitingHuman rows its screen lists.
 */
export function adminBadgeFor(
  id: string,
  unreadCounts: Record<string, number>,
  stats: Stats,
  stalledOpen = 0,
): number | undefined {
  const uc = unreadCounts[id];
  if (uc && uc > 0) return uc;
  // Q1071: Stuck Jobs counts the jobs escalated to a person and not yet
  // resolved (the same awaitingHuman rows its screen lists).
  if (id === "stalled" && stalledOpen > 0) return stalledOpen;
  if (id === "disputes" && stats.disputedJobs > 0) return stats.disputedJobs;
  if (id === "reports" && stats.openReports > 0) return stats.openReports;
  if (id === "support" && stats.supportTickets > 0) return stats.supportTickets;
  return undefined;
}

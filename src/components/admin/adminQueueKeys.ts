/**
 * The query keys the Support and Reports screens list their tabs under, in a
 * zero-dependency module so the left nav's pending counts (useAdminPendingCounts
 * in adminRailBadges.ts) read the SAME cache entry as the screen's Pending/New
 * list without importing the screen itself. One key, one list, one number:
 * the nav badge, the Priority Alert and the pill all show its length.
 */
export type SupportQueueFilter = "pending" | "resolved" | "all";
export const supportQueueKey = (filter: SupportQueueFilter) => ["admin-support", filter] as const;

export type ReportQueueFilter = "pending" | "investigating" | "resolved" | "dismissed" | "all";
export const reportsQueueKey = (filter: ReportQueueFilter) => ["admin-reports", filter] as const;

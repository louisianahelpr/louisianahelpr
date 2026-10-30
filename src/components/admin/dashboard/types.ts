/**
 * The Dashboard's three Priority Alert numbers. NOT loaded with the rest of
 * Stats: Admin.tsx fills them from useAdminPendingCounts, the same hook (and,
 * for Support and Reports, the same cache entry as the screen's list) that
 * puts the red count on each queue in the left nav, so the alert, the nav
 * badge and the screen's Pending tab are one number (owner, 2026-10-27).
 */
interface PriorityAlertCounts {
  openReports: number;
  supportTickets: number;
  disputedJobs: number;
  /** Open ops_alert_ledger rows, critical or fatal (useOpenAlertCounts). */
  criticalAlerts: number;
  /** Open ops_alert_ledger rows, error. */
  errorAlerts: number;
}

/** What the Dashboard renders: the loaded stats plus the shared queue counts. */
export type DashboardStats = Stats & PriorityAlertCounts;

export interface Stats {
  totalUsers: number;
  activeJobs: number; completedJobs: number;
  totalRevenue: number; totalFees: number;
  lateCancellationRevenue: number;
  newUsersInRange: number; newUsersPrev: number;
  revenueInRange: number; revenuePrev: number;
  completedJobsInRange: number; completedJobsPrev: number;
  feesThisQuarter: number;
  // 10-point sparkline series, ranged by the selector. Newest at the end.
  newUsersSeries: number[];
  revenueSeries: number[];
  completedJobsSeries: number[];
  activeJobsSeries: number[];
}

export type DateRange = "7d" | "30d" | "90d" | "custom";

export interface RangeWindow {
  /** Range in days. Custom defaults to its current days. */
  days: number;
  label: string;
  prevLabel: string;
}

export const RANGE_PRESETS: Record<Exclude<DateRange, "custom">, RangeWindow> = {
  "7d": { days: 7, label: "last 7d", prevLabel: "prior 7d" },
  "30d": { days: 30, label: "last 30d", prevLabel: "prior 30d" },
  "90d": { days: 90, label: "last 90d", prevLabel: "prior 90d" },
};

export interface Stats {
  totalUsers: number; pendingApprovals: number; openReports: number;
  supportTickets: number; activeJobs: number; completedJobs: number;
  totalRevenue: number; totalFees: number;
  disputedJobs: number; activeSubscriptions: number;
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

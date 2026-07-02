export type ParishStat = { parish: string; openJobs: number; activeHelpers: number; ratio: number | null };

export type HealthData = {
  emailStats: { total: number; sent: number; failed: number; suppressed: number };
  pushStats: { total: number; ios: number; android: number; latestAt: string | null };
  fraudCount: number;
  adminPushTokenCount: number;
  recentJobs: { open: number; completed: number; disputed: number; cancelled: number };
  healthStatus: "ok" | "degraded" | "unknown";
  parishStats: ParishStat[];
  medianTimeToFirstAppMin: number | null;
  jobsAwaitingApps: number;
};

// ── Fill-rate metrics ─────────────────────────────────────────────────────
export type FillRateRow = {
  total_jobs: number | null;
  filled_jobs: number | null;
  fill_rate_pct: number | null;
  median_minutes_to_first_app: number | null;
  parish: string | null;
  parish_fill_rate_pct: number | null;
};

export type FillRateSummary = {
  total_jobs: number;
  filled_jobs: number;
  fill_rate_pct: number | null;
  median_minutes_to_first_app: number | null;
  parishes: { parish: string; total_jobs: number; filled_jobs: number; fill_rate_pct: number | null }[];
  available: boolean;
};

export type FillSortKey = "fill_rate_pct" | "total_jobs";

export const FILL_DAYS_OPTIONS = [7, 30, 90] as const;
export type FillDays = typeof FILL_DAYS_OPTIONS[number];

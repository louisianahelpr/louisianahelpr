// A single availability slot as the dashboard filter pipeline expects it.
// `helper_availability` selects nullable columns, so we narrow to the
// non-null shape `useDashboardFilters` requires.
export type HelperAvailabilitySlot = {
  day_of_week: number;
  is_available: boolean;
  start_time: string;
  end_time: string;
};

// The slice of the dashboard React Query context cache we mutate in the
// optimistic apply path. We only touch `appliedJobIds`; everything else is
// preserved verbatim.
export type DashboardContextSlice = {
  appliedJobIds?: Set<string>;
  [key: string]: unknown;
};

export type ApplyVars = {
  jobId: string;
  helperId: string;
  message: string;
  files: File[];
  /** When the poster enabled instant-book, confirm the booking immediately
      after the application INSERT — no poster review required. Reuses the
      same jobs UPDATE path as handleHelperResponse (helper_confirmed_at).
      Treated as false when the column isn't on prod yet (pre-push). */
  isInstantBook?: boolean;
};

export type ApplySnapshot = {
  previousContext: unknown;
  userId: string;
};

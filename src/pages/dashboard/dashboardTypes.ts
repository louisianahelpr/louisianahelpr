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
};

export type ApplySnapshot = {
  previousContext: unknown;
  userId: string;
};

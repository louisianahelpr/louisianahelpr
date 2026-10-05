// The number /home prints above the list ("N jobs").
//
// The header has two candidate numbers: the server's `count: exact` total
// (useDashboardJobsCount) and the length of the list actually on screen
// (`filteredJobs`). The server total exists for ONE reason: the list is
// paginated, so while more pages remain `filteredJobs.length` only counts what
// has been loaded so far.
//
// Once the last page is in, that reason is gone and the list IS the set. A
// server total that disagrees with it then is not "the true total", it is a
// second opinion about the same rows — and the owner saw exactly that on
// 2026-10-05: "1 job" printed over a list that said "Nothing today". So with
// the list complete the header prints the list's own length, and "N jobs"
// above an empty list cannot happen however the two layers drift.
export function headerJobCount({
  serverCount,
  listedCount,
  listComplete,
}: {
  /** useDashboardJobsCount's total, or null/undefined while unknown. */
  serverCount: number | null | undefined;
  /** `filteredJobs.length` — the rows the list renders. */
  listedCount: number;
  /** True when every page of the feed is loaded (no next page). */
  listComplete: boolean;
}): number {
  if (listComplete) return listedCount;
  return serverCount ?? listedCount;
}

/** Density preference for the job feed: comfortable (full cards) or compact (single-line rows). */
export type FeedDensity = "comfortable" | "compact";

/** The persisted density preference (`job-feed-density`); "comfortable" when unset, invalid or storage is blocked. */
export function readStoredFeedDensity(): FeedDensity {
  try {
    const stored = window.localStorage.getItem("job-feed-density");
    return stored === "compact" || stored === "comfortable" ? stored : "comfortable";
  } catch {
    // A feature probe: blocked storage (private mode) just means the default density.
    return "comfortable";
  }
}

/**
 * What a list screen should show for its PRIMARY query (Q332).
 *
 * `isLoading` is not "the data is not here yet". In TanStack Query v5 it is
 * `isPending && isFetching`, and a query that is PAUSED (offline, networkMode
 * "online", the default for queries here) is not fetching. So offline, with
 * nothing cached, `isLoading` is false while there is no data at all: /browse
 * treated that as "loaded", showed "Nothing today, neighbor. New jobs post
 * throughout the day" (a false empty state) under a banner promising "the
 * last data we have", after first holding its skeletons for ~23 s.
 * Measured on the preview build, Linux Chromium, 375, jobs request held then
 * offline: skeleton to +23.5 s, then the false empty state, never an offline
 * or error state.
 *
 *   ready         — the query has data (success)
 *   error         — it failed and we are online: the designed error card
 *   offline-empty — offline (or paused) with nothing to show: say so, never a
 *                   skeleton or an empty state
 *   loading       — online, in flight, nothing yet: skeleton
 */
export type FeedPhase = "loading" | "offline-empty" | "error" | "ready";

export function feedPhase(
  q: { status: "pending" | "error" | "success"; fetchStatus: "fetching" | "paused" | "idle" },
  online: boolean,
): FeedPhase {
  if (q.status === "success") return "ready";
  if (!online || q.fetchStatus === "paused") return "offline-empty";
  if (q.status === "error") return "error";
  return "loading";
}

/**
 * Whether the signed-in Browse (/jobs) holds its whole-page skeleton.
 *
 * Owner 10-31 (B41, mocked-session headless check at 375 and 1440): signed in,
 * offline, nothing cached, the profile read is PAUSED, so `!profile` held the
 * skeleton forever and the feed's "You're offline" card never showed. Offline
 * with nothing in hand is a phase of its own, never "loading": once the user is
 * known, the page renders and the feed says it is offline. useCurrentUser's own
 * isLoading stays true while that read is paused, so it cannot decide this.
 */
export function dashboardLoading(s: {
  /** The signed-in user is known (auth restored the session; no network needed). */
  hasUser: boolean;
  /** useCurrentUser's isLoading: stays TRUE while its profile read is paused offline. */
  userLoading: boolean;
  hasProfile: boolean;
  ctxLoading: boolean;
  jobsLoading: boolean;
  jobCount: number;
  phase: FeedPhase;
}): boolean {
  if (s.phase === "offline-empty" && s.hasUser) return false;
  return s.userLoading || !s.hasProfile || s.ctxLoading || (s.jobsLoading && s.jobCount === 0);
}

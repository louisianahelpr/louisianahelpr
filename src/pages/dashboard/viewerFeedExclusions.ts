// The viewer-local culls that narrow the Browse board — in ONE place.
//
// WHY THIS EXISTS (owner, 2026-09-19: "map shows 7 jobs. list shows 4"):
// /dashboard renders the same set of open jobs through THREE surfaces —
//   1. the LIST      (useDashboardFilters.filteredJobs → BrowseTasksFeed)
//   2. the HEADER    (useDashboardJobsCount, a `count: exact` query)
//   3. the MAP       (BrowseMap, its own unpaginated get_open_jobs_for_map)
// each of which builds its set from a DIFFERENT source (a paginated view
// read, a head-only count query, and an RPC). Server-side those three agree
// exactly — verified live on prod 2026-09-19 as the owner's account: the map
// RPC and the browse view both returned the same 8 ids, no diff either way.
// Every divergence the owner has ever reported on this screen has been a
// client-side cull that one surface applied and the others did not:
//
//   • 2026-09-15 (B1): `appliedJobIds` was applied by the feed only, so the
//     header counted a job the list had hidden. Fixed by threading the set
//     into the count and the map.
//   • 2026-09-19 (this): `dismissedJobIds` — the purely-local "Not interested"
//     set in localStorage `helpr_dismissed_jobs` — was applied ONLY inside
//     BrowseTasksFeed. The header count and the map pins knew nothing about
//     it, so dismissing three jobs left the map at 7 pins and the list at 4
//     cards. `savedOnly` ("Only saved jobs") was the same shape: list-only.
//
// The fix for one instance is not the fix for the class. This interface IS
// the class: every viewer-local cull is a field on it, the three surfaces all
// consume THIS object rather than loose props, and
// `src/test/dashboardSurfaceExclusionParity.test.ts` derives the field list
// from this file and fails if any surface has stopped honouring one (or is
// not named in that test's explicit, justified exemption table).
//
// Adding a new cull? Add a field here and the guard will tell you, by name,
// which of the three surfaces you have not taught about it.

/**
 * Every cull that depends on WHO IS LOOKING rather than on the job row.
 *
 * Deliberately NOT here: the filter-sheet predicates (category, budget,
 * search, urgent, boosted, ending-soon, radius, availability). Those already
 * live in `useDashboardFilters` and are mirrored into the count and the map
 * through `mapFilter` / `DashboardJobsCountFilters`; the gaps there are
 * documented per-filter in those two files and are over-counts by design.
 */
export interface ViewerFeedExclusions {
  /**
   * Jobs the viewer has already applied to. The feed hides them, so the
   * header must not count them and the map must not pin them (B1).
   */
  appliedJobIds: ReadonlySet<string>;
  /**
   * Posters the viewer has blocked. Applied by job → `customer_id`.
   *
   * EXEMPT ON THE MAP, permanently: `get_open_jobs_for_map` deliberately does
   * NOT return `customer_id` (it is the PII-safe row), so the map has no field
   * to test. Widening the RPC to close the gap is explicitly forbidden — the
   * privacy guarantee outranks a pin-count that is off by the number of jobs
   * a blocked poster has open. Named in the parity guard's exemption table.
   */
  blockedUserIds: ReadonlySet<string>;
  /**
   * Jobs the viewer swiped away with "Not interested". Purely local — it
   * lives in localStorage (`helpr_dismissed_jobs`, seeded by
   * useDashboardSideQueries), never on the server, so EVERY surface has to be
   * handed the set; none of them can derive it.
   */
  dismissedJobIds: ReadonlySet<string>;
  /**
   * The "Only saved jobs" toggle, as a set rather than a boolean:
   *   `null`  → the toggle is OFF, no restriction.
   *   a set   → show ONLY these ids (an EMPTY set means "nothing matches",
   *             not "no filter" — that distinction is the whole reason this
   *             is `Set | null` and not `Set`).
   */
  savedOnlyJobIds: ReadonlySet<string> | null;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** A viewer with nothing applied, blocked, dismissed or filtered to saved. */
export const EMPTY_VIEWER_FEED_EXCLUSIONS: ViewerFeedExclusions = {
  appliedJobIds: EMPTY_SET,
  blockedUserIds: EMPTY_SET,
  dismissedJobIds: EMPTY_SET,
  savedOnlyJobIds: null,
};

/**
 * The single predicate. `customer_id` is optional because the map row does
 * not carry it — see `blockedUserIds` above; when it is absent the blocked
 * cull simply cannot run, which is the documented asymmetry, not a silent
 * skip of the other three.
 */
export function isJobExcludedForViewer(
  job: { id: string; customer_id?: string | null },
  x: ViewerFeedExclusions,
): boolean {
  if (x.appliedJobIds.has(job.id)) return true;
  if (x.dismissedJobIds.has(job.id)) return true;
  if (x.savedOnlyJobIds !== null && !x.savedOnlyJobIds.has(job.id)) return true;
  if (job.customer_id && x.blockedUserIds.has(job.customer_id)) return true;
  return false;
}

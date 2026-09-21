// ONE definition of how the browse feed is divided into sections.
//
// WHY THIS EXISTS. The feed shows the same list through two bands — the
// "Recommended" picks and everything else — and it used to build them from two
// DIFFERENT arrays: the everything-else band was `filteredJobs` minus a set,
// and the recommended band was built from `recommendedJobs`, a separate list
// that is not viewer-culled. Two lists, two gate conditions, and a subtraction
// in one that only pays off if the other renders. Twice now the two gates have
// drifted apart and jobs fell down the gap:
//
//   2026-09-16  the subtraction removed `filters.nearbyJobs` for a "Nearby"
//               band that had already been deleted. Nothing rendered them.
//   2026-09-20  the subtraction ran whenever `!hasFilters`, but the band
//               rendered only when `!hasFilters && !savedOnly`. `savedOnly`
//               is not part of `activeFilterCount`, so "Only saved jobs" left
//               `hasFilters === false`: the subtraction ran, the band did not.
//               Every saved job that was also a recommended pick disappeared,
//               and a viewer whose saved jobs were ALL recommended picks got
//               "Nothing saved yet" over a full saved list.
//
// THE FIX IS STRUCTURAL, not another matched pair of conditions. Both bands
// are now drawn from `filteredJobs` and the split is a PARTITION: every job
// lands in exactly one band, whatever the gates say. `showRecommendedBand`
// can be wrong without losing a job — it only moves rows between bands.
// There is no subtraction left to get out of step with a render.
//
// The boundary this file sits on matters. `filteredJobs` is the SERVER's
// answer ("may a browser see this job") already narrowed by the VIEWER's
// answer ("do I want to see it" — applied/blocked/dismissed/saved-only, one
// registry in viewerFeedExclusions.ts). Neither question belongs here. This
// file only ARRANGES what those two layers already decided, and it must never
// shrink the set: `partitionBrowseFeed` is total over its input, by
// construction and by test (src/test/browseFeedRendersEveryJob.test.tsx).

/** The minimum a row needs for the split; the feed passes its EnrichedJobs. */
export interface PartitionableJob {
  id: string;
}

export interface BrowseFeedPartition<J extends PartitionableJob> {
  /** The "Recommended" picks, in recommendation order. Subset of the input. */
  band: J[];
  /** Everything else, in the input's own order. Subset of the input. */
  rest: J[];
}

/**
 * Split the already-filtered feed into the recommended band and the rest.
 *
 * INVARIANT, both directions: `band ∪ rest === filteredJobs` and
 * `band ∩ rest === ∅`. Nothing is lost and nothing is invented — in
 * particular, a recommended id that is NOT in `filteredJobs` (the viewer
 * dismissed it, unsaved it, or already applied) cannot re-enter the feed
 * through the band, because the band is selected FROM `filteredJobs` rather
 * than concatenated from the recommendation list.
 *
 * @param filteredJobs   the feed's list, server- and viewer-filtered already.
 * @param recommendedIds ids the recommender picked, in score order — an
 *                       ordering hint only; ids absent from `filteredJobs`
 *                       are ignored.
 * @param showRecommendedBand whether the band renders at all. When false every
 *                       job goes to `rest` — it is NOT dropped.
 */
export function partitionBrowseFeed<J extends PartitionableJob>({
  filteredJobs,
  recommendedIds,
  showRecommendedBand,
}: {
  filteredJobs: readonly J[];
  recommendedIds: readonly string[];
  showRecommendedBand: boolean;
}): BrowseFeedPartition<J> {
  // No band → one list. The old code still ran its subtraction here, which is
  // exactly how the 2026-09-20 instance lost rows.
  if (!showRecommendedBand) return { band: [], rest: filteredJobs.slice() };

  // Band membership is decided ONCE and both halves read that one decision,
  // so they cannot disagree about who renders a given row.
  const byId = new Map(filteredJobs.map((j) => [j.id, j] as const));
  const band: J[] = [];
  const bandIds = new Set<string>();
  for (const id of recommendedIds) {
    if (bandIds.has(id)) continue;
    const job = byId.get(id);
    // A recommended id the viewer has culled is simply not in `filteredJobs`;
    // skipping it here is what keeps the band from re-inventing it.
    if (!job) continue;
    band.push(job);
    bandIds.add(id);
  }

  const rest = filteredJobs.filter((j) => {
    const inBand = bandIds.has(j.id);
    return !inBand;
  });

  return { band, rest };
}

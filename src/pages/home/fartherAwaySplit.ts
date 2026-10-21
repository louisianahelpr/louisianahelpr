// Board 6 (spec §10 "Few nearby jobs"): after the nearby list, a divider
// "Farther away · 25–N mi" and then the farther jobs, never mixed in.
//
// A pure ORDERING of the list the feed already decided to show: every job
// comes back exactly once (near ∪ far === input, in each half's input order).
// Distance is the same parish-centroid estimate the card's own "~X mi" pill
// uses (JobCard): open_jobs_browse masks precise coordinates. A job whose
// distance cannot be measured stays with the nearby list rather than being
// pushed under a "farther" label it may not deserve.
import { haversineMiles, tripMiles } from "@/lib/geo";
import { getCentroidFromLocation, getParishCentroid } from "@/lib/parishCentroids";

/** The board's nearby radius (and the filter sheet's default distance, spec §3). */
export const NEARBY_MILES = 25;

interface SplittableJob {
  id: string;
  location?: string | null;
  parish?: string | null;
}

/** The job's approximate distance from the viewer, or null when either side is unknown. */
function approxJobMiles(job: SplittableJob, userLat: number | null, userLng: number | null): number | null {
  if (userLat == null || userLng == null) return null;
  const c = getParishCentroid(job.parish) ?? getCentroidFromLocation(job.location ?? null);
  return c ? tripMiles(haversineMiles(userLat, userLng, c.lat, c.lng)) : null;
}

export interface FartherAwaySplit<J> {
  /** The list in its new order: nearby (and unmeasured) first, then farther. */
  ordered: J[];
  /** Index in `ordered` of the first farther job, or null when there is no divider. */
  fartherFrom: number | null;
  /** The divider's words, from the real distances ("Farther away · 25–60 mi"). */
  label: string | null;
}

export function splitFartherAway<J extends SplittableJob>(
  jobs: readonly J[],
  userLat: number | null,
  userLng: number | null,
): FartherAwaySplit<J> {
  const near: J[] = [];
  const far: J[] = [];
  let maxFar = 0;
  for (const j of jobs) {
    const miles = approxJobMiles(j, userLat, userLng);
    if (miles != null && miles > NEARBY_MILES) {
      far.push(j);
      maxFar = Math.max(maxFar, miles);
    } else {
      near.push(j);
    }
  }
  // No divider when nothing is nearby (the divider would head the whole list)
  // or nothing is far: the list is then one band and reads as it always did.
  if (far.length === 0 || near.length === 0) return { ordered: jobs.slice(), fartherFrom: null, label: null };
  const top = Math.ceil(maxFar);
  return {
    ordered: [...near, ...far],
    fartherFrom: near.length,
    label: top <= 100 ? `Farther away · ${NEARBY_MILES}–${top} mi` : `Farther away · over ${NEARBY_MILES} mi`,
  };
}

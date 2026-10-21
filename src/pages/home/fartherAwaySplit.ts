// Board 6 (spec §10 "Few nearby jobs"): after the nearby list, a divider
// "Farther away · 25–N mi" and then the farther jobs, never mixed in.
//
// A pure ORDERING of the list the feed already decided to show: every job
// comes back exactly once (near ∪ far === input, in each half's input order).
// Distance is the same parish-centroid estimate the card's own "~X mi" pill
// uses (JobCard): open_jobs_browse masks precise coordinates. A job whose
// distance cannot be measured stays with the nearby list rather than being
// pushed under a "farther" label it may not deserve.
//
// QUIET NEAR YOU (owner 2026-10-21, additive, under "Any" distance only; the
// caller passes `splitFarther` only with no distance filter and the default
// order, so a radius the member set is never widened): when fewer than
// QUIET_NEAR_MIN jobs are within NEARBY_MILES, the jobs 25-50 mi out come
// right after the nearby ones, NEAREST FIRST, under the QUIET_LINE, each with
// its distance and place ("~32 mi away · Lafayette"). Nothing is hidden and
// nothing is invented: they are the same rows the feed already holds (the
// open_jobs_browse read), only ordered and labelled. Jobs beyond 50 mi keep
// the "Farther away" divider after them. The distance is the parish-centroid
// ESTIMATE, hence the "~".
import { haversineMiles, tripMiles } from "@/lib/geo";
import { getCity } from "@/lib/locationUtils";
import { getCentroidFromLocation, getParishCentroid } from "@/lib/parishCentroids";

/** The board's nearby radius (and the filter sheet's default distance, spec §3). */
export const NEARBY_MILES = 25;
/** Fewer nearby jobs than this is "quiet near you". */
export const QUIET_NEAR_MIN = 5;
/** How far out the quiet band reaches. */
export const QUIET_MAX_MILES = 50;
export const QUIET_LINE = "Showing jobs farther out while it's quiet near you";

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
  /** Index in `ordered` of the first quiet-band job (QUIET_LINE goes above it), or null. */
  quietFrom: number | null;
  /** Job id -> "~32 mi away · Lafayette", for each quiet-band job. */
  distanceLabels: Map<string, string>;
}

/** "~32 mi away · Lafayette": the estimate and the job's town (or parish). */
function awayLabel(job: SplittableJob, miles: number): string {
  const place = getCity(job.location ?? "") || job.parish || "";
  return place ? `~${Math.round(miles)} mi away · ${place}` : `~${Math.round(miles)} mi away`;
}

function dividerLabel(from: number, maxFar: number): string {
  const top = Math.ceil(maxFar);
  return top <= 100 ? `Farther away · ${from}–${top} mi` : `Farther away · over ${from} mi`;
}

export function splitFartherAway<J extends SplittableJob>(
  jobs: readonly J[],
  userLat: number | null,
  userLng: number | null,
): FartherAwaySplit<J> {
  const near: J[] = [];
  const far: { job: J; miles: number }[] = [];
  let maxFar = 0;
  for (const j of jobs) {
    const miles = approxJobMiles(j, userLat, userLng);
    if (miles != null && miles > NEARBY_MILES) {
      far.push({ job: j, miles });
      maxFar = Math.max(maxFar, miles);
    } else {
      near.push(j);
    }
  }
  const none = { quietFrom: null, distanceLabels: new Map<string, string>() };

  // Quiet near you: the 25-50 mi band, nearest first, labelled.
  if (near.length < QUIET_NEAR_MIN) {
    const band = far.filter((f) => f.miles <= QUIET_MAX_MILES).sort((a, b) => a.miles - b.miles);
    if (band.length > 0) {
      const beyond = far.filter((f) => f.miles > QUIET_MAX_MILES);
      const maxBeyond = beyond.reduce((m, f) => Math.max(m, f.miles), 0);
      return {
        ordered: [...near, ...band.map((f) => f.job), ...beyond.map((f) => f.job)],
        fartherFrom: beyond.length > 0 ? near.length + band.length : null,
        label: beyond.length > 0 ? dividerLabel(QUIET_MAX_MILES, maxBeyond) : null,
        quietFrom: near.length,
        distanceLabels: new Map(band.map((f) => [f.job.id, awayLabel(f.job, f.miles)])),
      };
    }
  }

  // No divider when nothing is nearby (the divider would head the whole list)
  // or nothing is far: the list is then one band and reads as it always did.
  if (far.length === 0 || near.length === 0) return { ordered: jobs.slice(), fartherFrom: null, label: null, ...none };
  return {
    ordered: [...near, ...far.map((f) => f.job)],
    fartherFrom: near.length,
    label: dividerLabel(NEARBY_MILES, maxFar),
    ...none,
  };
}

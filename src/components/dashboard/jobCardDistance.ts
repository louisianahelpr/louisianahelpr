/**
 * Display strings for the JobCard meta row (extracted from JobCard.tsx, a
 * baselined god component, so a money-display change there does not grow it).
 * Pure functions; no money, no data access.
 */

/**
 * EVERY distance value is approximate and the visible text says so.
 *
 * open_jobs_browse masks precise job coordinates on purpose, so the
 * destination is a PARISH CENTROID in every case — the pill has never been able
 * to mean "1634 miles", only "about that far". A viewer cannot audit an
 * origin, so the only honest answer is to mark the claim, and a tilde costs
 * ~4px on the one no-wrap row. "<1 mi" keeps its own wording — "~<1 mi" reads
 * as noise, and "less than a mile" is already a range rather than a point.
 */
export function formatDistanceLabel(distanceMiles: number | null): string | null {
  if (distanceMiles == null) return null;
  if (distanceMiles < 1) return "<1 mi";
  if (distanceMiles < 10) return `~${distanceMiles.toFixed(1)} mi`;
  return `~${Math.round(distanceMiles)} mi`;
}

/** "12 min" under an hour, "1h 5m" from an hour up; null when there is no estimate. */
export function formatDrivingLabel(drivingMinutes: number | null): string | null {
  if (drivingMinutes == null) return null;
  if (drivingMinutes < 60) return `${drivingMinutes} min`;
  return `${Math.floor(drivingMinutes / 60)}h ${drivingMinutes % 60}m`;
}

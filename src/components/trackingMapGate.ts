/** Whether JobTracking's map mounts (split out of JobTracking.tsx, componentSizeRatchet; re-exported there). */

/**
 * The tracking-row steps the map is drawn on.
 *
 * KEEP THE MAP UNTIL DONE (owner, 2026-09-14, VN-20 pop-up: "Keep map until
 * done"). This reverses the map being en-route only ("this should show map
 * tracker when they're on the way"): it now stays from On the way through
 * Arrived and Working, so the arrival label on its job pin is actually seen,
 * and hides once the job is marked done.
 */
const MAP_TRACKING_STATUSES = new Set(["on_the_way", "arrived", "working"]);

/**
 * THE CONTESTED SET (owner, 2026-09-16: "the tracker shoudl not go away for a
 * dispute ir revisio").
 *
 * A job in `revision_requested` or `disputed` has already been submitted, so
 * its tracking row carries `done` — which is why keeping the map for those two
 * statuses needs BOTH halves: `markedDone` has to stop hiding it, and `done`
 * has to be an allowed tracking status. With only the first half the map
 * stayed hidden and the fix would have measured as a no-op.
 *
 * Deliberately NOT a change to the plain path: a normally-completed job still
 * loses its map on the same terms as before.
 */
const CONTESTED_MAP_TRACKING_STATUSES = new Set([...MAP_TRACKING_STATUSES, "done"]);

/**
 * Whether the map mounts. Shared by the render and by the arrival-label
 * placement (VN-20) so "the map shows the arrival" and "the map is on screen"
 * can never be two different answers.
 *
 * DRAWING THE MAP STARTS NO TRACKING. After On the way the helper pin is the
 * last position already on the `job_tracking` row; the position watch
 * (`startEnRouteWatch`, the effect gated on `tracking.status === "on_the_way"`)
 * still stops at arrival exactly as before.
 *
 * `markedDone` hides it once completion is submitted or settled — the helper's
 * Done, the poster's approval, a completed job.
 *
 * EXCEPT WHEN THE WORK IS CONTESTED (`contested`, owner 2026-09-16: "the
 * tracker shoudl not go away for a dispute ir revisio"). This reverses the
 * earlier reading that a job sent back for revision or disputed after
 * submission should lose its map with every other done job. It should not: a
 * revision or a dispute is the one moment where where the Helpr actually WENT
 * is the evidence under discussion, and the rail is deliberately clamped to
 * Working for exactly the same reason. The map goes with it.
 */
export function shouldShowTrackingMap(
  tracking: { status: string; latitude: number | null; longitude: number | null } | null | undefined,
  jobLatitude: number | null | undefined,
  jobLongitude: number | null | undefined,
  markedDone = false,
  /** `jobStatus` is `revision_requested` or `disputed` — see above. Scoped to
   *  those two statuses so a plainly-completed job is untouched. */
  contested = false,
): boolean {
  return (
    (contested || !markedDone) &&
    !!tracking &&
    (contested ? CONTESTED_MAP_TRACKING_STATUSES : MAP_TRACKING_STATUSES).has(tracking.status) &&
    tracking.latitude != null &&
    tracking.longitude != null &&
    jobLatitude != null &&
    jobLongitude != null
  );
}

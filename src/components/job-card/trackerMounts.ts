import type { Job, AppliedApp } from "./activityConstants";

/**
 * Which activity cards mount a <JobTracking>, in ONE place, so the batched
 * `job_tracking` prefetch (useActivityData) covers exactly the cards that
 * would otherwise run their own query.
 *
 * <JobTracking> skips its per-card SELECT only when the parent hands it
 * `initialTracking` (a row or `null`). A card whose job id is missing from the
 * batch gets `undefined` and fetches for itself. The batch used to cover only
 * accepted / in_progress / disputed while the poster's card also mounts the
 * tracker on `completed` and `revision_requested` (and the Helpr's card on
 * `revision_requested` and a part-staffed group job still `open`). So a poster
 * with 50 finished jobs paid 50 extra round trips per /posts load, and the
 * press audit, which reloads before every press, multiplied that into the
 * #1582 time-budget failure (run 36275729414).
 *
 * Guard: src/test/trackerPrefetchCoversEveryMount.test.ts.
 */

/** The poster's card (PostedJobCard) shows the tracker on these. */
export function postedCardShowsTracker(job: Pick<Job, "status" | "helper_id">): boolean {
  return (
    ((job.status === "accepted" ||
      job.status === "in_progress" ||
      job.status === "revision_requested" ||
      job.status === "disputed" ||
      // Completed keeps it too (owner: "remove [the stripe]. should show
      // tracker"): a finished job's history is the most useful thing on the
      // card once the actions are done.
      job.status === "completed") &&
      !!job.helper_id) ||
    job.status === "open"
  );
}

/** <JobTracking> only queries when it has a helper, so only these need a
    prefetched row. */
export function postedCardTrackerQueries(job: Pick<Job, "status" | "helper_id">): boolean {
  return postedCardShowsTracker(job) && !!job.helper_id;
}

/** The Helpr's card (AppliedJobCard) mounts HelperTrackerPanel when it is
    Confirmed, Active (in_progress / revision_requested) or Disputed; all of
    those need an accepted application. `open` is a part-staffed group job the
    Helpr is already on (see deriveAppliedJobCardState). */
export function appliedCardMountsTracker(
  app: Pick<AppliedApp, "status">,
  job: Pick<Job, "status"> | null | undefined,
): boolean {
  if (!job || app.status !== "accepted") return false;
  const s = job.status;
  return (
    s === "accepted" ||
    s === "open" ||
    s === "in_progress" ||
    s === "revision_requested" ||
    s === "disputed"
  );
}

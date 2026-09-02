/**
 * Where does tapping this notification take you?
 *
 * WHY THIS IS A FUNCTION AND NOT `n.link`.
 *
 * `notifications.link` has been the only carrier of job identity since the
 * table was created, and a URL string cannot be checked against anything. That
 * is the root cause behind three separate sweeps (20260831232514,
 * 20260901021929, and the one before them) that each believed they had fixed
 * every producer and each had not:
 *
 *   * ~40 producers wrote a bare `/my-posts` / `/my-jobs`, which opens the
 *     "Needs you" bucket — essentially never where the job is.
 *   * Others wrote a fixed `?filter=`, which is a claim about the job's LIVE
 *     state ("whose move is it?") frozen at write time. It is wrong the moment
 *     the bucket changes while the notification sits unread, and 66 prod rows
 *     named a legacy key with no chip on the strip at all.
 *
 * `notifications.job_id` (20260901035600) is a real reference, so the
 * destination is now DERIVED at tap time from the job rather than guessed at
 * write time. This function is the one place that derivation happens, shared
 * by the in-app panel and the native push handler so the two can never
 * disagree about where the same row goes.
 *
 * `link` is deliberately NOT redundant and is NOT going away: plenty of
 * notifications legitimately point somewhere that is not a job (admin, the
 * profile tabs, support, membership), and every row written before this column
 * existed still has nothing else.
 */

/** The two Activity surfaces whose bucket is resolved from the job at open time. */
const ACTIVITY_PATHS = new Set(["/my-posts", "/my-jobs"]);

export type DestinationInput = {
  link: string | null;
  /** Optional so a caller holding a pre-migration row shape still type-checks. */
  job_id?: string | null;
};

/**
 * Returns a root-relative path to navigate to, or `null` when the row has
 * nowhere to go (which is a real state — 6 prod rows carry `link: null`).
 */
export function notificationDestination(n: DestinationInput): string | null {
  // Only a root-relative path is navigable in-app. An absolute URL and a
  // `javascript:` string are equally un-followable, and both are already
  // rejected server-side by create-notification's sanitizeLink.
  const link = typeof n.link === "string" && n.link.startsWith("/") && !n.link.startsWith("//")
    ? n.link
    : null;
  const jobId = n.job_id ?? null;

  // No reference: the URL is all there is, and it must keep working. Every row
  // written before 20260901035600 is in this branch, plus every row whose job
  // has since been deleted (the FK is ON DELETE SET NULL, so job_id drops to
  // null and the row degrades to exactly this path — 582 prod rows already
  // point at a job that no longer exists).
  if (!jobId) return link;

  // Split explicitly rather than destructuring with a default: a `[null]`
  // fallback types `query` as `string | null`, and a `= ""` default only
  // fires for `undefined`, so the null flowed straight into URLSearchParams.
  const path = link ? link.split("?", 2)[0] : null;
  const query = link ? (link.split("?", 2)[1] ?? "") : "";

  if (path && ACTIVITY_PATHS.has(path)) {
    // THE FIX. Rebuild the query string around the job reference:
    //
    //   `job`    is set from the column, not read back out of the string.
    //   `filter` is DROPPED. Not merely ignored — dropped. Activity gives an
    //            explicit `?filter=` precedence over `?job=` resolution, so
    //            carrying a stale bucket alongside the job actively defeats
    //            the resolution it is meant to enable. Passing both is worse
    //            than passing neither.
    //   others   survive; `highlight` in particular still names the card to
    //            pulse on the applied tab.
    const params = new URLSearchParams(query);
    params.delete("filter");
    params.delete("job");
    params.set("job", jobId);
    return `${path}?${params.toString()}`;
  }

  // A job we know about, and no link at all. Before job_id there was nothing
  // to do with these but mark them read (reject_pending_job writes no link
  // while holding p_job_id in scope); now they can go to the job itself.
  if (!link) return `/jobs/${encodeURIComponent(jobId)}`;

  // A job we know about, and a link that deliberately points elsewhere —
  // `/earnings` for a payout, `/messages?jobId=…` for a message, `/admin` for
  // an operator alert, `/dashboard?quickApply=…` to open the apply sheet. The
  // link is the right destination; job_id is the reference, not an override.
  return link;
}

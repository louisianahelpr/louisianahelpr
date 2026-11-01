/**
 * HAS THE WORK STARTED. The one rule behind three things that must agree (lead decision 2026-10-31, B43's open item 1):
 *  - the tracker's Working step colour (JobProgressState.begun: white while waiting, yellow while it happens),
 *  - the tracker's line under the bar ("Your Helpr is working" vs "Your Helpr is at the job"),
 *  - the poster's card line for the same state (POSTER_NAMED.working / the unnamed "working" detail).
 * Before this, the bar turned yellow the moment the job was in progress past arrival, while both lines still read
 * "is at the job" until the poster tapped the optional working vouch.
 *
 * Work has started when the job is in progress (or back for a fix) and neither the Helpr's own card nor the
 * surface's tracking row says it has not: the Helpr's card still asking for Start working / the before photo
 * (JOBS3-48), or `workUnderway` false (the job page and the open card pass helperProgress, where the Helpr's own
 * tracking row wins over the poster's arrival confirm). The poster's own "they're working" vouch always counts.
 * A surface that cannot see the tracking row passes no `workUnderway` and reads the job row alone.
 * Guard: src/test/workingLineMatchesTheBar.test.ts.
 */
type WorkJob = { status?: string | null; poster_confirmed_working_at?: string | null };

/** The Helpr's card lines for a job they are at but have not started. */
export const HELPR_NOT_STARTED: ReadonlySet<string> = new Set<string>(["start_working", "before_photo"]);

export function workHasBegun(job: WorkJob, o: { workUnderway?: boolean; lineId?: string | null } = {}): boolean {
  if (job.status !== "in_progress" && job.status !== "revision_requested") return false;
  if (job.poster_confirmed_working_at) return true;
  if (o.lineId && HELPR_NOT_STARTED.has(o.lineId)) return false;
  return o.workUnderway !== false;
}

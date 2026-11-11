import { APPROVAL_WINDOW_HOURS, hoursToMs } from "../../../../supabase/functions/_shared/escrowTiming";

/**
 * When the poster's review window ends, in ms; null when there is no approve clock. F274 (audit 11-10, Scrub a back
 * deck): after a fix was sent the page still timed the FIRST "done" (helper_completed_at + 24 h) and read "24 hours
 * passed" while the poster had until revision_acceptance_deadline to check the fix. A fix sent is timed by that
 * deadline (the window auto-release-payment escalates on); a fix asked for and not sent yet has no approve clock.
 */
export function approveDeadlineMs(job: {
  helper_completed_at?: string | null;
  revision_requested_at?: string | null;
  revision_completed_at?: string | null;
  revision_acceptance_deadline?: string | null;
}): number | null {
  const asked = job.revision_requested_at ? Date.parse(job.revision_requested_at) : NaN;
  const sent = job.revision_completed_at ? Date.parse(job.revision_completed_at) : NaN;
  if (Number.isFinite(asked) && !(sent >= asked)) return null;
  if (Number.isFinite(sent) && job.revision_acceptance_deadline) {
    const until = Date.parse(job.revision_acceptance_deadline);
    if (Number.isFinite(until)) return until;
  }
  if (!job.helper_completed_at) return null;
  const done = Date.parse(job.helper_completed_at);
  return Number.isFinite(done) ? done + hoursToMs(APPROVAL_WINDOW_HOURS) : null;
}

/** "23h 52m left, then Helpr support steps in", or, once the window passed, that support reaches out. */
export function reviewTimeLeft(deadlineMs: number, now = Date.now()): string {
  const ms = deadlineMs - now;
  // F273: past the window the poster can still approve (the admin alert closes itself on approval, 20261023143240),
  // so the line says so, never a bare "24 hours passed" that read as too late.
  if (ms <= 0) return "You can still approve. Helpr support will check in; your payment stays held";
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h > 0 ? `${h}h ${m}m` : `${m}m`} left, then Helpr support steps in`;
}

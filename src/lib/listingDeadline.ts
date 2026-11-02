/**
 * A3-94 (audit 11-01): an open job's real deadline for a Helpr is whichever comes FIRST, its start or the listing's
 * close (expires_at). On prod every dated open job closed after it started (all 115, read-only), so "Closes · 4 days
 * left" sat on work starting in 30 minutes. The browse card's countdown chip and the job dialog's tile both read this.
 * Guard: src/test/listingDeadline.test.tsx, JobStatTiles.test.tsx.
 */
import { formatTimeLeft, jobStartDateTime } from "@/lib/dateUtils";

/** The instant a job starts: its start time in the job's zone, or the END of
 *  its day when it has none ("sometime that day" has not run out until the
 *  day has). The same target JobCountdown counts to. */
export function jobStartTarget(dateNeeded: string | null | undefined, startTime?: string | null): Date | null {
  if (!dateNeeded) return null;
  if (startTime) return jobStartDateTime(dateNeeded, startTime);
  const midnight = jobStartDateTime(dateNeeded, null);
  return midnight ? new Date(midnight.getTime() + 86_400_000 - 1_000) : null;
}

export type ListingDeadline = { at: Date; startsFirst: boolean };

/** The start or the close, whichever is first; no close (expires_at): null, and nothing is drawn. */
export function listingDeadline(job: { expires_at?: string | null; date_needed?: string | null; start_time?: string | null }): ListingDeadline | null {
  const closeMs = job.expires_at ? Date.parse(job.expires_at) : NaN;
  if (!Number.isFinite(closeMs)) return null;
  const startMs = jobStartTarget(job.date_needed, job.start_time)?.getTime() ?? NaN;
  const startsFirst = Number.isFinite(startMs) && startMs < closeMs;
  return { at: new Date(startsFirst ? startMs : closeMs), startsFirst };
}

/**
 * The browse card's countdown chip (dashboard/JobCard.tsx). Expiry is an URGENCY signal, not a permanent meta line:
 * every job is created with the same 14-day window, so an unconditional countdown printed the identical string
 * ("14 days left") on every card in the feed, in the one no-wrap meta slot a browsing Helpr reads. It renders only
 * inside a 48 h horizon (or once expired); under 24 h it is `soon` (destructive red).
 * A3-94: it counts to the START when that comes first ("Starts · 5 hours left"); once the start has passed with the
 * listing still open, it counts to the close as before (never "Starts · Expired").
 */
export function listingChip(job: Parameters<typeof listingDeadline>[0], now: Date): { text: string; soon: boolean } | null {
  const first = listingDeadline(job);
  if (!first) return null;
  const startPassed = first.startsFirst && first.at.getTime() <= now.getTime();
  const at = startPassed ? new Date(Date.parse(job.expires_at!)) : first.at;
  // Whole hours, truncated (date-fns differenceInHours' default). Plain math on purpose: date-fns here put its 7.9 KB gz
  // "dates" chunk on /home's critical path (CountdownRows -> browse-home-shared; Q178 budget, train 2 11-02).
  const hours = Math.trunc((at.getTime() - now.getTime()) / 3_600_000);
  const expired = at.getTime() <= now.getTime();
  if (!expired && hours >= 48) return null;
  // formatTimeLeft owns "Expired" too: one rule for when a listing has closed.
  const text = formatTimeLeft(at, now);
  return { text: first.startsFirst && !startPassed ? `Starts · ${text}` : text, soon: expired || hours < 24 };
}

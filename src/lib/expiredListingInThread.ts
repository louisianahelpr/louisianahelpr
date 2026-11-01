/**
 * Expired is not cancelled, in Messages too (owner 10-31 ~18:30, OWNER-DECISIONS "Expired jobs are not
 * cancellations": a job that expired with no Helpr hired never shows as Cancelled or counts as a cancellation to
 * anyone else; the poster alone sees it as Expired).
 *
 * A thread that names a job read the job's raw status: auto-expire-jobs closes an unfilled listing as
 * status 'cancelled', so the inbox chip and the chat header said "Cancelled", the closed-thread notice said "the job
 * was cancelled", and the derived pill said "Job was cancelled." to the applicant who messaged about it. Now:
 *   - the poster reads "Expired" / "Your listing expired with no Helpr hired.";
 *   - everyone else reads "Closed" / "This job is no longer open." (never Cancelled, never Expired), the same words
 *     the applicant's job card uses (B41 91a16d5ca3, "Closed · No longer open").
 * The expiry marker (jobIsExpiredListing below): cancelled, no Helpr, no cancelled_by, and the sweep's reason.
 * auto-expire-jobs/index.ts never sets cancelled_by and poster_cancel_job always does, so a poster who TYPES the
 * sweep's reason is still a cancellation. It is the same rule as isExpiredListing in src/lib/expiredListing.ts on
 * wip/b3-1031 (e29358ec15); that file is not on main yet, so once both have landed this should call it instead
 * (B44 handoff). Guard: src/test/expiredListingInMessages.test.ts.
 */
import { jobStatusLabel } from "@/lib/statusLabels";

/** auto-expire-jobs' cancellation_reason starts with this (supabase/functions/auto-expire-jobs/index.ts). */
const EXPIRED_REASON_PREFIX = "Job listing expired";

/** A listing that expired with no Helpr hired: closed by the sweep, never cancelled by a person. */
export function jobIsExpiredListing(job: {
  status?: string | null;
  helper_id?: string | null;
  cancellation_reason?: string | null;
  cancelled_by?: string | null;
}): boolean {
  return (
    job.status === "cancelled" &&
    !job.helper_id &&
    !job.cancelled_by &&
    (job.cancellation_reason ?? "").startsWith(EXPIRED_REASON_PREFIX)
  );
}

export const EXPIRED_IN_THREAD = {
  poster: {
    chip: "Expired",
    event: "Your listing expired with no Helpr hired.",
    notice: "This conversation is closed — your listing expired with no Helpr hired. You can still read everything here.",
    toast: "Your listing expired, so the conversation is closed and the message wasn't sent.",
  },
  other: {
    chip: "Closed",
    event: "This job is no longer open.",
    notice: "This conversation is closed — the job is no longer open. You can still read everything here.",
    toast: "This job is no longer open, so the conversation is closed and the message wasn't sent.",
  },
} as const;

export type ExpiredView = { jobExpired?: boolean | null; viewerIsPoster?: boolean | null };

/** The copy set for an expired listing as THIS viewer reads it, or null when the job did not expire. */
export function expiredCopyFor(view: ExpiredView | null | undefined) {
  if (!view?.jobExpired) return null;
  return view.viewerIsPoster ? EXPIRED_IN_THREAD.poster : EXPIRED_IN_THREAD.other;
}

/** The status chip's label in the inbox row and the chat header. */
export function threadJobChipLabel(status: string, view: ExpiredView | null | undefined): string {
  if (status === "cancelled") {
    const expired = expiredCopyFor(view);
    if (expired) return expired.chip;
  }
  return jobStatusLabel(status);
}

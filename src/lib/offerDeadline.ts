import { jobStartDateTime } from "@/lib/dateUtils";

/**
 * A hire offer's answer-by time — the client's copy of the SERVER rule in
 * `accept_application` (supabase/migrations/20261005184940_offer_deadline_before_start.sql).
 *
 * The server is the source of truth: it writes `jobs.response_deadline` and the
 * cards read that column back. This module exists so the hire dialog can SAY
 * the window the server will set, and the optimistic card patch shows the same
 * instant the refetch will, instead of "23h 58m left" on a job that starts in 4
 * minutes (owner, 2026-10-05).
 *
 *   deadline = min(the poster's chosen window, 48 h, the job's start)
 *
 * The job's start is date_needed + start_time in the job's zone; a job with no
 * start time ("any time that day") runs to the END of its day. A hire into a
 * job that starts within OFFER_MIN_LEAD_MS is refused (`job_starts_too_soon`).
 * src/lib/offerDeadline.test.ts pins both constants to the migration.
 */
export const OFFER_MAX_WINDOW_HOURS = 48;
export const OFFER_MIN_LEAD_MINUTES = 15;

/** The instant an offer on this job must be answered by at the latest. */
export function jobOfferCutoff(dateNeeded: string | null | undefined, startTime?: string | null): Date | null {
  if (startTime) return jobStartDateTime(dateNeeded, startTime);
  const midnight = jobStartDateTime(dateNeeded, null);
  if (!midnight) return null;
  // The NEXT day's midnight in the job's zone (DST-safe: resolve that day's own
  // wall clock rather than adding 24 h).
  const [y, m, d] = (dateNeeded as string).split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const iso = next.toISOString().slice(0, 10);
  return jobStartDateTime(iso, null);
}

export type OfferDeadline =
  | { ok: true; deadline: Date; cappedByStart: boolean; cutoff: Date | null }
  | { ok: false; reason: "job_starts_too_soon"; cutoff: Date };

export function offerResponseDeadline(
  requestedHours: number,
  job: { date_needed?: string | null; start_time?: string | null },
  now: Date = new Date(),
): OfferDeadline {
  const cutoff = jobOfferCutoff(job.date_needed, job.start_time);
  if (cutoff && cutoff.getTime() <= now.getTime() + OFFER_MIN_LEAD_MINUTES * 60_000) {
    return { ok: false, reason: "job_starts_too_soon", cutoff };
  }
  const hours = Math.min(Math.max(requestedHours, 0), OFFER_MAX_WINDOW_HOURS);
  const chosen = now.getTime() + hours * 3_600_000;
  const cappedByStart = !!cutoff && cutoff.getTime() < chosen;
  return { ok: true, deadline: new Date(cappedByStart ? cutoff!.getTime() : chosen), cappedByStart, cutoff };
}

/** What a poster reads when the hire is refused for `job_starts_too_soon`
 *  (the dialog's pre-check and the RPC's refusal say the same sentence). */
export const JOB_STARTS_TOO_SOON_COPY =
  "This job starts too soon for your Helpr to answer an offer. Change its date or time first, then hire.";

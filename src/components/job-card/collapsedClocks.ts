import { confirmationOpensClock } from "./confirmationOpensClock";
import { jobStartTarget, type CountdownClock } from "./CountdownRows";

/**
 * The clocks a COLLAPSED booked card draws under its status line, beside the
 * line's own (owner, 2026-10-07, Q1399): "until the job starts" and, once the
 * Helpr has accepted and while the day-before window is shut, "until
 * confirmation opens". CountdownRows orders them soonest first.
 */
export function collapsedClocks(
  job: { date_needed: string | null; start_time: string | null; status: string; helper_confirmed_at?: string | null },
  isOwner: boolean,
): CountdownClock[] {
  if (!job.date_needed) return [];
  const opens = job.helper_confirmed_at ? confirmationOpensClock(job.date_needed, job.status, isOwner, undefined, job.start_time ?? null) : null;
  return [
    { id: "start", at: jobStartTarget(job.date_needed, job.start_time), text: "until the job starts", expiredText: "Job time has arrived" },
    ...(opens ? [opens.clock] : []),
  ];
}

import { confirmationOpensClock } from "./confirmationOpensClock";
import { jobStartTarget, type CountdownClock } from "./CountdownRows";

/**
 * The clocks a COLLAPSED booked card draws under its status line, beside the
 * line's own (owner, 2026-10-07, Q1399): "until the job starts" and, once the
 * Helpr has accepted and while the day-before window is shut, "until
 * confirmation opens". CountdownRows orders them soonest first.
 *
 * ONE CLOCK, THE NEXT ONE (owner, 2026-10-23, card critique items 7 and 8): "18d 17h 13m until confirmation opens"
 * over "20d 8h 13m until the job starts" was two minute-precise timers for one fact. Now only the next clock (the
 * confirm window, while it is shut; else the start), more than 2 days out as a date ("Starts Thu, Nov 12",
 * CountdownRows `farLabel`), and no start clock once the job is more than 12 hours past its start ("Job time has
 * arrived" eight days later). A strip whose line carries its own clock adds none of these (PosterStatusStrip,
 * HelperCollapsedStrip).
 */
const PAST_START_DROP_MS = 12 * 60 * 60 * 1000;
export function collapsedClocks(
  job: { date_needed: string | null; start_time: string | null; status: string; helper_confirmed_at?: string | null },
  isOwner: boolean,
): CountdownClock[] {
  if (!job.date_needed) return [];
  const opens = job.helper_confirmed_at ? confirmationOpensClock(job.date_needed, job.status, isOwner, undefined, job.start_time ?? null) : null;
  if (opens) return [{ ...opens.clock, farLabel: "Confirm opens" }];
  const start = jobStartTarget(job.date_needed, job.start_time);
  if (!start || Date.now() - start.getTime() > PAST_START_DROP_MS) return [];
  return [{ id: "start", at: start, text: "until the job starts", expiredText: "Job time has arrived", farLabel: "Starts" }];
}

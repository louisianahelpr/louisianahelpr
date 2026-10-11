import { CONFIRM_DEADLINE_HOURS_BEFORE_START, confirmDeadlineMs, confirmOpensMs } from "@/lib/jobDate";
import { JOB_TIMEZONE } from "../../../supabase/functions/_shared/cancellationFee";
import type { CountdownClock } from "./CountdownRows";

/**
 * JobConfirmation's not-yet-open state ("Confirmation opens in ...") as a clock row (owner, 2026-10-07, Q1399): the
 * same window, the same shared helpers the sweep calls, for a card that draws
 * all its clocks in one CountdownRows. Null outside that state (the job is not
 * live, or the window is already open and the confirm control itself shows).
 */
export function confirmationOpensClock(
  dateNeeded: string | null | undefined,
  jobStatus: string | null | undefined,
  isOwner: boolean,
  now: Date = new Date(),
  /** The job's start time: the confirm is owed until 2 hours before it. */
  startTime: string | null = null,
): { clock: CountdownClock; note: string } | null {
  if (!dateNeeded || (jobStatus !== "accepted" && jobStatus !== "in_progress")) return null;
  // Opens at midnight the day before; owed until 2 hours before the start, then
  // the job is reposted (owner, 2026-10-08; sweep_confirm_reminders_and_repost).
  // Both from supabase/functions/_shared/confirmDeadline.ts (Q1647).
  const opensMs = confirmOpensMs(dateNeeded);
  if (now.getTime() >= opensMs) return null;
  const confirmBy = new Date(confirmDeadlineMs(dateNeeded, startTime)).toLocaleString("en-US", {
    timeZone: JOB_TIMEZONE,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    clock: { id: "confirm-opens", at: new Date(opensMs), text: "until confirmation opens", expiredText: "Confirmation is open" },
    note: isOwner
      ? "The day before, we ask you both to confirm you're still on."
      : `The day before, we ask you both to confirm you're still on. Confirm by ${confirmBy} (${CONFIRM_DEADLINE_HOURS_BEFORE_START} hours before it starts), or it's reposted to other Helprs.`,
  };
}

import { confirmOpensMs, jobDayStart } from "@/lib/jobDate";
import { jobStartDateTime } from "@/lib/dateUtils";
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
  const hoursUntilJob = (jobDayStart(dateNeeded).getTime() - now.getTime()) / 3_600_000;
  if (hoursUntilJob <= 24) return null;
  // Owed until 2 hours before the start; then the job is reposted (owner,
  // 2026-10-08; sweep_confirm_reminders_and_repost).
  const startMs = (jobStartDateTime(dateNeeded, startTime) ?? jobDayStart(dateNeeded)).getTime();
  const confirmBy = new Date(startMs - 2 * 3_600_000).toLocaleString("en-US", {
    timeZone: JOB_TIMEZONE,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    clock: { id: "confirm-opens", at: new Date(confirmOpensMs(dateNeeded)), text: "until confirmation opens", expiredText: "Confirmation is open" },
    note: isOwner
      ? "The day before, we ask you both to confirm you're still on."
      : `The day before, we ask you both to confirm you're still on. Confirm by ${confirmBy} (2 hours before it starts), or it's reposted to other Helprs.`,
  };
}

import { CONFIRM_WINDOW_HOURS, confirmDeadlineMs, confirmOpensMs, jobDayStart } from "@/lib/jobDate";
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
): { clock: CountdownClock; note: string } | null {
  if (!dateNeeded || (jobStatus !== "accepted" && jobStatus !== "in_progress")) return null;
  const hoursUntilJob = (jobDayStart(dateNeeded).getTime() - now.getTime()) / 3_600_000;
  if (hoursUntilJob <= 24) return null;
  const confirmBy = new Date(confirmDeadlineMs(dateNeeded)).toLocaleString("en-US", {
    timeZone: JOB_TIMEZONE,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    clock: { id: "confirm-opens", at: new Date(confirmOpensMs(dateNeeded)), text: "until confirmation opens", expiredText: "Confirmation is open" },
    note: isOwner
      ? "The day before, we ask you both to confirm you're still on."
      : `The day before, we ask you both to confirm you're still on. Then you'll have ${CONFIRM_WINDOW_HOURS} hours: confirm by ${confirmBy}, or the job re-opens to other Helprs.`,
  };
}

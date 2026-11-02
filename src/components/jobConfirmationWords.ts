/** JobConfirmation's words, as pure helpers (moved out of JobConfirmation.tsx to keep it under its size ratchet). */
import { FLEXIBLE_TIME_LABEL } from "@/lib/jobDate";
import { JOB_TIMEZONE } from "../../supabase/functions/_shared/cancellationFee";

/** How long until the job, for the confirm dialog. */
export function confirmUrgencyText(hoursUntilJob: number): string {
  if (hoursUntilJob <= 0) return "Job date has passed";
  if (hoursUntilJob < 24) return "less than 24 hours";
  const h = Math.round(hoursUntilJob);
  return `${h} hour${h !== 1 ? "s" : ""}`;
}

/** "Thursday, October 22, 2037 at 9:00 AM": the day being confirmed, and the time when the job has one. */
export function confirmScheduledFor(jobDate: Date, timeLabel: string | null): string {
  // timeLabel is jobStartTimeLabel(start_time) (the one rule, jobStartTimeClass): a Louisiana wall-clock "9:00 AM";
  // nothing for a flexible or unset time (the old toLocaleTimeString path also printed nothing then).
  const at = timeLabel && timeLabel !== FLEXIBLE_TIME_LABEL ? ` at ${timeLabel}` : "";
  return `${jobDate.toLocaleDateString("en-US", { timeZone: JOB_TIMEZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" })}${at}`;
}

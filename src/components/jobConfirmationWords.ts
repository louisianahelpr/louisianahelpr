/** JobConfirmation's words, as pure helpers (moved out of JobConfirmation.tsx to keep it under its size ratchet). */
import { jobStartDateTime } from "@/lib/dateUtils";
import { JOB_TIMEZONE } from "../../supabase/functions/_shared/cancellationFee";

/** How long until the job, for the confirm dialog. */
export function confirmUrgencyText(hoursUntilJob: number): string {
  if (hoursUntilJob <= 0) return "Job date has passed";
  if (hoursUntilJob < 24) return "less than 24 hours";
  const h = Math.round(hoursUntilJob);
  return `${h} hour${h !== 1 ? "s" : ""}`;
}

/** "Thursday, October 22, 2037 at 9:00 AM": the day being confirmed, and the time when the job has one. */
export function confirmScheduledFor(jobDate: Date, dateNeeded: string, startTime: string | null | undefined): string {
  const scheduledStart = startTime ? jobStartDateTime(dateNeeded, startTime) : null;
  return `${jobDate.toLocaleDateString("en-US", { timeZone: JOB_TIMEZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" })}${
    scheduledStart ? ` at ${scheduledStart.toLocaleTimeString("en-US", { timeZone: JOB_TIMEZONE, hour: "numeric", minute: "2-digit" })}` : ""
  }`;
}

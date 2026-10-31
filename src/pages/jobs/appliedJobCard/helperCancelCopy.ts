import { jobStartDateTime } from "@/lib/dateUtils";
import { CANCEL_OVER_24H_NOT_A_STRIKE, RELIABILITY_LADDER_SENTENCE } from "@/lib/reliabilityLadder";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What cancelling costs the Helpr, said before and after the tap (JOBS-13). helper_cancel_booking files a strike only
 * within 24 hours of the start (is_late_cancellation, owner decisions Q407 (6) and (11)) and otherwise returns
 * { action: "none" }; the dialog and the toast said it was a strike either way.
 */
export function helperCancelCallout(dateNeeded: string | null | undefined, startTime: string | null | undefined, nowMs = Date.now()): string {
  const start = jobStartDateTime(dateNeeded, startTime);
  if (start && start.getTime() - nowMs >= DAY_MS) {
    return CANCEL_OVER_24H_NOT_A_STRIKE;
  }
  return `Cancelling a job you committed to counts as a reliability strike — ${RELIABILITY_LADDER_SENTENCE}.`;
}

/** The server's own answer (`action`), never the clock on this device. */
export function helperCancelToast(action: string | undefined): string {
  if (action === "temp_ban") return "Job cancelled — third strike: your account is suspended for 7 days.";
  if (action === "warning") return "Job cancelled — final warning. One more strike is a 7-day suspension.";
  if (action === "none") return "Job cancelled. No strike: the start was more than 24 hours away.";
  return "Job cancelled. This counts as a reliability strike.";
}

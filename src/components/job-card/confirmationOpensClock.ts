import { CONFIRM_DEADLINE_HOURS_BEFORE_START, confirmDeadlineMs, confirmOpensMs } from "@/lib/jobDate";
import { JOB_TIMEZONE } from "../../../supabase/functions/_shared/cancellationFee";
import type { CountdownClock } from "./CountdownRows";

/** Beyond this the words name the date too ("Thu, Nov 12"): a bare weekday 8 days out reads as this week's. */
const WEEKDAY_ONLY_MS = 6 * 86_400_000;

/**
 * PLAIN WORDS, NO RUNNING CLOCK (owner 11-11, F270): "1d 10h 23m until you can confirm" became
 * "Confirm opens Thu at 12:00 AM." The day and the time, in the job's own timezone (JOB_TIMEZONE), so the
 * reader sees the moment, not a number to do arithmetic on. The shared CountdownRows row, the Posted
 * card's collapsed line and JobConfirmation's strip all print this.
 */
export function confirmOpensWords(opensMs: number, now: Date = new Date()): string {
  const at = new Date(opensMs);
  const far = opensMs - now.getTime() > WEEKDAY_ONLY_MS;
  const day = at.toLocaleDateString("en-US", { timeZone: JOB_TIMEZONE, weekday: "short", ...(far ? { month: "short", day: "numeric" } : {}) });
  const time = at.toLocaleTimeString("en-US", { timeZone: JOB_TIMEZONE, hour: "numeric", minute: "2-digit" });
  return `Confirm opens ${day} at ${time}.`;
}

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
    // Q2597 (Jobs audit 1102b row 11, JA-5 seen again): "until confirmation opens" was app jargon on a countdown.
    // F270 (owner 11-11): a plain row ("Confirm opens Thu at 12:00 AM."), never a d/h/m clock.
    clock: { id: "confirm-opens", at: new Date(opensMs), text: confirmOpensWords(opensMs, now), plain: true, expiredText: "You can confirm now" },
    note: isOwner
      ? "The day before, we ask you both to confirm you're still on."
      : `The day before, we ask you both to confirm you're still on. Confirm by ${confirmBy} (${CONFIRM_DEADLINE_HOURS_BEFORE_START} hours before it starts), or it's reposted to other Helprs.`,
  };
}

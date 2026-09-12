import { jobLocalMidnightMs } from "./cancellationFee.ts";

/**
 * ONE number for "the helper must confirm by", enforced and displayed.
 *
 * WHY THIS EXISTS. `auto-expire-jobs` re-opened any `accepted` job whose
 * acceptance was 24h old and unconfirmed, with NO predicate on `date_needed`.
 * `JobConfirmation` only renders a confirm control once the job is inside 24
 * hours. So a helper who accepted a job five days out was un-booked at hour
 * 24 — four days before the button that would have saved them existed — and
 * told "You didn't start … within 24 hours", which was not something they
 * were ever permitted to do.
 *
 * THE RULE. The confirmation window OPENS at midnight the day before the job
 * (`date_needed` is a bare DATE; midnight is resolved in America/Chicago, see
 * below) and the helper gets `CONFIRM_WINDOW_HOURS` to answer — so for a job
 * accepted in advance the deadline is NOON THE DAY BEFORE, leaving the poster
 * the rest of that day plus the job day to re-fill. A helper who accepts
 * INSIDE the window gets the same 12 hours measured from their acceptance
 * instead, because a clock that has already run out is not a window.
 *
 * TIMEZONE. Deliberately NOT `toISOString().slice(0, 10)`. `date_needed` is a
 * bare `YYYY-MM-DD` that only means anything in Louisiana's zone; a UTC date
 * string is 5-6 hours off, which on a 12-hour window is half of it. This
 * resolves midnight through `jobLocalMidnightMs` — the same DST-correct,
 * explicitly-zoned helper the cancellation ladder and `src/lib/jobDate.ts`
 * already use — so the cron (Deno, UTC) and the browser (whatever zone the
 * reader is in) compute the identical instant.
 *
 * Both the sweep and the card import from here. That is the point: the UI may
 * never imply a window longer than the one the cron enforces.
 */
export const CONFIRM_WINDOW_HOURS = 12;
export const CONFIRM_OPENS_HOURS_BEFORE = 24;

const HOUR_MS = 3_600_000;

/**
 * The calendar day before `dateNeeded`, as another bare `YYYY-MM-DD`.
 *
 * Done on the DATE, not by subtracting 24h from the job's midnight epoch —
 * because two days a year are not 24 hours long. Central's spring-forward day
 * is 23 hours, so `midnight(Mar 9) − 24h` is 23:00 on Mar 7, not midnight on
 * Mar 8; the fall-back day is 25 hours and lands on 01:00. Caught by
 * `confirmDeadline.boundary.test.ts`, which asserts the wall clock rather than
 * an offset. `Date.UTC` is safe here precisely because it is pure calendar
 * arithmetic with no zone in it — the zone is applied afterwards, once, by
 * `jobLocalMidnightMs`.
 */
function previousDay(dateNeeded: string): string {
  const [y, m, d] = dateNeeded.split("-").map(Number);
  const prev = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) - 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
}

/** Epoch ms at which the confirm control appears — midnight the day before. */
export function confirmOpensMs(dateNeeded: string): number {
  return jobLocalMidnightMs(previousDay(dateNeeded));
}

/**
 * Epoch ms by which the helper must have confirmed.
 *
 * `acceptedAt` is optional because the two card call sites do not pass the
 * column through; omitting it yields the EARLIER (window-open) deadline, which
 * is never later than the one the cron computes with it. Erring early is the
 * only safe direction — the card must not promise time the sweep will not give.
 */
export function confirmDeadlineMs(dateNeeded: string, acceptedAt?: string | null): number {
  const opens = confirmOpensMs(dateNeeded);
  const accepted = acceptedAt ? new Date(acceptedAt).getTime() : Number.NaN;
  const from = Number.isFinite(accepted) ? Math.max(opens, accepted) : opens;
  return from + CONFIRM_WINDOW_HOURS * HOUR_MS;
}

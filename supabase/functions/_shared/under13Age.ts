// Q1803 (OWNER RULING 2026-10-21, COPPA): the pure half of _shared/under13.ts
// (imports only the zero-import louisianaDate.ts): the ruling's sentence and
// the under-13 test, on the America/Chicago calendar the database's own age
// rules use. complete-signup and the edge harness read it directly.

import { louisianaToday } from "./louisianaDate.ts";

export const UNDER_13_MESSAGE = "You must be 13 or older to use Louisiana Helpr";
export const UNDER_13_CODE = "under_13";

/** "YYYY-MM-DD" for `now` on the America/Chicago calendar (the database's own rule for 18). */
function chicagoToday(now: Date = new Date()): string {
  return louisianaToday(now);
}

/** True when a YYYY-MM-DD birthday is after today in America/Chicago (a typo, never a child). */
export function isFutureBirthday(dob: unknown, now: Date = new Date()): boolean {
  if (typeof dob !== "string") return false;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(dob);
  return !!m && m[1] > chicagoToday(now);
}

/**
 * True when a birthday (YYYY-MM-DD, or any string starting with one) makes the
 * member under 13 today in America/Chicago, the same test as the trigger's
 * `date_of_birth + interval '13 years' > today`. A string that is not a date
 * answers false: complete-signup refuses it as an invalid date on its own.
 */
export function isUnder13(dob: unknown, now: Date = new Date()): boolean {
  if (typeof dob !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  if (isFutureBirthday(dob, now)) return false;
  // The 13th birthday. Postgres's `date + interval '13 years'` clamps Feb 29 to Feb 28 in a
  // non-leap year; clamp the same way so the edge and the trigger agree on that one day.
  const year13 = y + 13;
  const lastDay = new Date(Date.UTC(year13, mo, 0)).getUTCDate();
  const thirteenth = `${year13}-${String(mo).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
  return thirteenth > chicagoToday(now);
}

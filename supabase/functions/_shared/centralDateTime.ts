/**
 * A moment as members read it in every message: Louisiana time, the house style "Mon, Nov 16 at 7:42 PM".
 *
 * Owner's message review 11-09, F183: the suspension email built its restore date with `toLocaleDateString()` on the
 * server, which runs in UTC, so a strike given after 6 PM Central showed the next day's date, written "11/16/2026"
 * unlike every other message. Pure (no Deno, no I/O) so a unit test runs the real function.
 */
export const MEMBER_TIMEZONE = "America/Chicago";

export function centralDateTimeLabel(when: Date): string {
  const day = when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: MEMBER_TIMEZONE });
  const time = when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: MEMBER_TIMEZONE });
  return `${day} at ${time}`;
}

/** A day as members read it, in Louisiana time: "Nov 16". */
export function centralDayLabel(when: Date): string {
  return when.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: MEMBER_TIMEZONE });
}

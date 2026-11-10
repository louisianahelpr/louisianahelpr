/**
 * A moment as members read it in every message: Louisiana time, the house style "Mon, Nov 16 at 7:42 PM Central".
 * F476/F481 (audit 11-10): the zone is named, so a member travelling or reading late is never left guessing.
 *
 * Owner's message review 11-09, F183: the suspension email built its restore date with `toLocaleDateString()` on the
 * server, which runs in UTC, so a strike given after 6 PM Central showed the next day's date, written "11/16/2026"
 * unlike every other message. Pure (no Deno, no I/O) so a unit test runs the real function.
 */
const MEMBER_TIMEZONE = "America/Chicago";

export function centralDateTimeLabel(when: Date): string {
  const day = when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: MEMBER_TIMEZONE });
  const time = when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: MEMBER_TIMEZONE });
  return `${day} at ${time} Central`;
}

/** A day as members read it, in Louisiana time: "Nov 16". */
export function centralDayLabel(when: Date): string {
  return when.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: MEMBER_TIMEZONE });
}

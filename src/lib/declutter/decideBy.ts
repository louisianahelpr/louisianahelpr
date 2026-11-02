/**
 * A3-74 (lead 11-01): a refund Louisiana Helpr decides usually by decide_by (when it reached Louisiana Helpr + 48 h,
 * 20261102041000). Display only: nothing happens on its own at that time.
 */

/** "Tue 11/3, 9 PM" (or "9:30 PM"), Louisiana time. */
export function decideByWords(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "America/Chicago" }).replace(",", "");
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Chicago" }).format(d);
  return `${day}, ${time.replace(":00", "")}`;
}

/** The time-frame sentence (with a leading space) for a refund Louisiana Helpr decides, or "" before it has one. */
export function decidesBy(decideBy: string | null | undefined): string {
  return decideBy ? ` Louisiana Helpr usually decides within 2 days (by ${decideByWords(decideBy)}).` : "";
}

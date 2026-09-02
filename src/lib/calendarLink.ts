import { isNativePlatform } from "@/lib/nativeInit";

/**
 * An "add to calendar" URL that opens the device's OWN calendar app on
 * native, not a browser tab (owner, 2026-08-30: "what if they're on the
 * app? then app should open the calendar on their phone" — the job-detail
 * date chip only ever built a Google Calendar web URL, the same gap
 * `mapsSearchUrl` closed for the location chip).
 *
 * Provider by platform:
 *   - Native (iOS/Android) → a `data:text/calendar` .ics payload. The
 *     WebView hands that MIME type to the OS, which opens it in the
 *     device's own calendar app's "add event" sheet — there is no scheme
 *     equivalent to `maps://`/`geo:` for calendars, but the .ics MIME type
 *     is the universal one every calendar app registers for.
 *   - Web → Google Calendar's documented template URL, same as before.
 */
export function calendarEventUrl(
  title: string,
  startIso: string,
  endIso: string,
  details: string,
  location: string,
): string {
  if (isNativePlatform) {
    // VALUE=DATE all-day format (YYYYMMDD) — matches the granularity the
    // web branch's `dates=` param already used.
    const toIcsDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
    const escapeIcs = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      `SUMMARY:${escapeIcs(title)}`,
      `DTSTART;VALUE=DATE:${toIcsDate(startIso)}`,
      `DTEND;VALUE=DATE:${toIcsDate(endIso)}`,
      `DESCRIPTION:${escapeIcs(details)}`,
      `LOCATION:${escapeIcs(location)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  }
  const dateStartIso = startIso.slice(0, 10).replace(/-/g, "");
  const dateEndIso = endIso.slice(0, 10).replace(/-/g, "");
  return `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dateStartIso}/${dateEndIso}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
}

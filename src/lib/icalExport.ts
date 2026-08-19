/**
 * Generates an iCalendar (.ics) string for a single job event.
 * Works cross-platform: iOS/Android import via native share/download,
 * web browsers via an <a download> link.
 */
export interface CalendarJobEvent {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  dateNeeded: string;        // "YYYY-MM-DD"
  startTime: string | null;  // "HH:MM:SS" or "HH:MM"
  estimatedHours: number | null;
}

function toIcsDate(date: Date): string {
  // UTC compact format: 20260615T140000Z
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    // CR (alone or as CRLF) FIRST. Properties are joined with "\r\n" below, so
    // a bare \r inside a title/location/description that only escaped \n let a
    // poster end the property and inject their own — a second VEVENT, a forged
    // URL:, an ATTENDEE: — into a file the helper imports because it came from
    // Helpr. Most parsers split on /\r\n|\r|\n/ regardless of RFC 5545.
    .replace(/\r\n?/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function buildIcsString(job: CalendarJobEvent): string {
  const dateStr = job.dateNeeded; // "YYYY-MM-DD"
  const [year, month, day] = dateStr.split("-").map(Number);

  let startHour = 9, startMin = 0;
  if (job.startTime) {
    const parts = job.startTime.split(":").map(Number);
    startHour = parts[0] ?? 9;
    startMin = parts[1] ?? 0;
  }

  const start = new Date(year, month - 1, day, startHour, startMin, 0);
  const durationHours = job.estimatedHours ?? 2;
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

  const dtStart = toIcsDate(start);
  const dtEnd = toIcsDate(end);
  const now = toIcsDate(new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Louisiana Helpr//Helpr//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${job.id}@louisianahelpr.com`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcs(job.title)}`,
    job.location ? `LOCATION:${escapeIcs(job.location)}` : null,
    job.description ? `DESCRIPTION:${escapeIcs(job.description.slice(0, 500))}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");

  return lines;
}

/** What actually happened, so the caller can tell the user the truth. */
export type CalendarExportResult = "shared" | "downloaded" | "cancelled" | "failed";

/**
 * Hand the job to the user's calendar.
 *
 * The old implementation was a bare `<a download>` blob click, which is the
 * one technique that does NOT work where most of this app's users are: iOS
 * Safari and the Capacitor WKWebView both ignore the `download` attribute on a
 * blob URL. Tapping "Add to Calendar" on an iPhone did nothing at all, and
 * because the function returned `void` the button had no way to know or say so
 * — the reported "I added to calendar but it still says add to".
 *
 * Order matters:
 *  1. Web Share with a file — on iOS this opens the share sheet with the .ics
 *     attached, and "Add to Calendar" is one of the offered actions. This is
 *     the only path that genuinely reaches the iOS calendar from a web app.
 *  2. Anchor download — correct on desktop browsers and Android, where the
 *     file lands in Downloads and opens in the calendar app.
 * A caller that gets "failed" must say so rather than pretending.
 */
export async function addJobToCalendar(job: CalendarJobEvent): Promise<CalendarExportResult> {
  const ics = buildIcsString(job);
  const filename = `helpr-job-${job.id.slice(0, 8)}.ics`;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });

  // `canShare({ files })` is the real capability probe — `navigator.share`
  // alone exists on browsers that reject file payloads.
  try {
    const file = new File([blob], filename, { type: "text/calendar" });
    const nav = navigator as Navigator & {
      canShare?: (data: { files?: File[] }) => boolean;
      share?: (data: { files?: File[]; title?: string }) => Promise<void>;
    };
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: job.title });
      return "shared";
    }
  } catch (err) {
    // A user who dismisses the share sheet lands here as AbortError. That is a
    // deliberate cancel, not a failure — report it as its own outcome so the
    // caller stays silent instead of accusing the device of breaking. Anything
    // else falls through to the download attempt below.
    if ((err as { name?: string })?.name === "AbortError") return "cancelled";
  }

  // Reaching here means Web Share is unavailable or was refused. On iOS —
  // Safari AND the Capacitor WKWebView — the anchor below runs without
  // throwing and does NOTHING: `download` on a blob: URL is ignored. Reporting
  // "downloaded" there is the same false success this function was written to
  // eliminate, just moved one branch over. Say "failed" instead so the caller
  // can tell the truth.
  if (isDownloadUnsupported()) return "failed";

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return "downloaded";
  } catch {
    return "failed";
  }
}

/**
 * True where `<a download>` on a blob: URL is silently ignored — every iOS
 * browser (all of them are WKWebView) and the Capacitor iOS shell.
 *
 * Feature-detected as far as it can be: `"download" in a` is TRUE on iOS
 * Safari even though the attribute does nothing, so there is no honest probe
 * and platform sniffing is the only option. iPadOS reports "MacIntel", hence
 * the touch-point check.
 */
function isDownloadUnsupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  if (cap?.getPlatform?.() === "ios") return true;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ masquerades as desktop Safari; a "Mac" with a touchscreen is one.
  return ua.includes("Macintosh") && (navigator.maxTouchPoints ?? 0) > 1;
}

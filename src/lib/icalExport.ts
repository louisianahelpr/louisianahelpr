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
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
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
export type CalendarExportResult = "shared" | "downloaded" | "failed";

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
  } catch {
    // A user who dismisses the share sheet lands here too. Fall through to the
    // download rather than reporting a failure they caused on purpose — the
    // worst case is an extra file in Downloads.
  }

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

import { toast } from "sonner";
import { isNativePlatform } from "@/lib/nativeInit";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

/** Minutes a scheduled job is assumed to run when the job carries no
 *  `estimated_hours` — long enough to be useful on a calendar without
 *  implying a false level of precision. */
const DEFAULT_DURATION_MINUTES = 120;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Format a Date as a floating (no trailing "Z") local iCal timestamp,
 * `YYYYMMDDTHHMMSS`. Floating time is deliberate: a job's `date_needed` +
 * `start_time` are wall-clock values with no stored timezone, so the event
 * should read the same hour on the device regardless of which timezone the
 * device is currently in — exactly what a floating DTSTART/DTEND does.
 */
function toICalLocal(date: Date): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

/** Escape text per RFC 5545 §3.3.11 — backslash, semicolon, comma, then
 *  newlines, in that order (escaping the backslash first prevents it from
 *  re-escaping the slashes just inserted for the later characters). */
function escapeICalText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Fold a content line at 75 octets per RFC 5545 §3.1 — long lines (a job
 *  description easily exceeds this) must be split across multiple physical
 *  lines, each continuation starting with a single space, or strict
 *  calendar parsers (notably iOS Calendar) reject or truncate the event. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  let first = true;
  while (rest.length > 0) {
    const limit = first ? 75 : 74; // continuation lines lose 1 char to the leading space
    chunks.push(rest.slice(0, limit));
    rest = rest.slice(limit);
    first = false;
  }
  return chunks.join("\r\n ");
}

export interface CalendarEventInput {
  id: string;
  title: string;
  location: string;
  description: string;
  /** ISO date, "YYYY-MM-DD". */
  dateNeeded: string;
  /** "HH:MM" 24-hour, "flexible", or null. */
  startTime: string | null;
  /** Job's estimated duration in hours, if the poster provided one. */
  estimatedHours: number | null;
}

/** Build the raw .ics file content for a single job. Exported separately
 *  from `exportJobToCalendar` so it's unit-testable without the
 *  share/download side effects. */
export function buildJobICS(job: CalendarEventInput): string {
  const [year, month, day] = job.dateNeeded.split("-").map(Number);
  const hasClockTime = !!job.startTime && job.startTime !== "flexible";
  const [hour, minute] = hasClockTime ? job.startTime!.split(":").map(Number) : [9, 0];

  const start = new Date(year, (month ?? 1) - 1, day ?? 1, hour, minute, 0);
  const durationMinutes = job.estimatedHours && job.estimatedHours > 0
    ? Math.round(job.estimatedHours * 60)
    : DEFAULT_DURATION_MINUTES;
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  // All-day event when the job has no real clock time — an "9:00 AM"
  // fabricated start would otherwise show up on the device calendar as if
  // the poster had actually specified a time.
  const dtLines = hasClockTime
    ? [`DTSTART:${toICalLocal(start)}`, `DTEND:${toICalLocal(end)}`]
    : [
        `DTSTART;VALUE=DATE:${toICalLocal(start).slice(0, 8)}`,
        `DTEND;VALUE=DATE:${toICalLocal(new Date(start.getTime() + 24 * 60 * 60_000)).slice(0, 8)}`,
      ];

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Louisiana Helpr//Job Schedule//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:job-${job.id}@louisianahelpr.com`,
    `DTSTAMP:${toICalLocal(new Date())}Z`,
    ...dtLines,
    `SUMMARY:${escapeICalText(job.title)}`,
    `LOCATION:${escapeICalText(job.location)}`,
    `DESCRIPTION:${escapeICalText(job.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function safeFileName(title: string): string {
  const slug = title.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${slug || "job"}.ics`;
}

/**
 * Export a job as an .ics calendar event and hand it to the device.
 *
 * There is no Capacitor calendar plugin in this app (checked
 * package.json — @capacitor/calendar-style plugins aren't installed, and
 * adding one is out of scope: it needs an Xcode/Android project
 * regeneration this environment can't verify). This is the web-compatible
 * fallback instead:
 *
 *  1. Native (Capacitor @capacitor/share, already a dependency, same
 *     plugin `nativeShare.ts` uses elsewhere) — hand the OS share sheet a
 *     `data:text/calendar` URI. iOS/Android both recognize the
 *     text/calendar MIME + .ics-shaped payload and offer "Add to Calendar"
 *     as a share target, with no Filesystem plugin needed to stage a real
 *     file on disk.
 *  2. Web — a plain `<a download>` anchor on an object URL, which every
 *     desktop/mobile browser turns into a normal file download that the
 *     OS calendar app can then open.
 */
export async function exportJobToCalendar(job: CalendarEventInput): Promise<void> {
  const ics = buildJobICS(job);
  const fileName = safeFileName(job.title);

  try {
    if (isNativePlatform) {
      const { Share } = await import("@capacitor/share");
      const dataUrl = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
      await Share.share({
        title: job.title,
        text: `Calendar event for ${job.title}`,
        url: dataUrl,
        dialogTitle: "Add to Calendar",
      });
      return;
    }

    // Web fallback: a real file download the OS calendar app can open.
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Object URLs aren't auto-revoked — this one is short-lived and only
    // referenced by the click that just fired, so it's safe to free once
    // the browser has had a tick to start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    toast.success("Calendar event downloaded", { description: `${fileName} — open it to add to your calendar.` });
  } catch (err) {
    const isCancel =
      err instanceof Error &&
      (err.name === "AbortError" || /cancel/i.test(err.message) || /dismiss/i.test(err.message));
    if (isCancel) return;
    toast.error("Couldn't export to calendar — try again.");
  }
}

/** Convenience wrapper that pulls the fields `exportJobToCalendar` needs
 *  straight off a `jobs` row, so call sites don't have to hand-build a
 *  `CalendarEventInput`. */
export function exportJobRowToCalendar(job: Job): Promise<void> {
  return exportJobToCalendar({
    id: job.id,
    title: job.title,
    location: job.location,
    description: job.description,
    dateNeeded: job.date_needed,
    startTime: job.start_time,
    estimatedHours: job.estimated_hours,
  });
}

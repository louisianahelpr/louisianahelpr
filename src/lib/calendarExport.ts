import { toast } from "sonner";
import { isNativePlatform } from "@/lib/nativeInit";
import { report } from "@/lib/errorLogger";
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

/**
 * Format a Date as a UTC iCal timestamp, `YYYYMMDDTHHMMSSZ`.
 *
 * Only DTSTAMP uses this. DTSTAMP is defined by RFC 5545 §3.8.7.2 as a UTC
 * value — the trailing "Z" is not decoration, it is the assertion that the
 * digits before it are UTC. This used to be `toICalLocal(...) + "Z"`, i.e.
 * LOCAL wall-clock digits with a UTC marker glued on, which is a lie of up to
 * a day either side of midnight. It never moved the event (DTSTART/DTEND are
 * deliberately floating and are built separately) but strict parsers are
 * entitled to reject the object over it.
 */
function toICalUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
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
  /** Null once the poster deletes their account and the job is anonymised
   *  (20260901033011). The LOCATION property is then OMITTED from the .ics
   *  rather than written empty — see `buildJobICS`. */
  location: string | null;
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
    `DTSTAMP:${toICalUtc(new Date())}`,
    ...dtLines,
    `SUMMARY:${escapeICalText(job.title)}`,
    // A missing address OMITS the property. This file leaves the app and
    // lands in someone's real calendar, where a `LOCATION:` line reading
    // "" or "null" outlives every bit of context that would explain it.
    // An absent property is what iCalendar means by "unknown"; an empty
    // one asserts the event has no location, which is a different claim.
    ...(job.location ? [`LOCATION:${escapeICalText(job.location)}`] : []),
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
 * Did the user simply dismiss the share sheet? That is a normal "no thanks",
 * not a failure, and must not toast.
 *
 * @capacitor/share's iOS implementation rejects with the literal string
 * "Share canceled" from `completionWithItemsHandler` when the sheet is
 * dismissed without picking a target (see SharePlugin.swift); the Web Share
 * API rejects with an `AbortError`. Everything else is a real fault.
 */
function isUserCancellation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /cancel/i.test(err.message) || /dismiss/i.test(err.message))
  );
}

/**
 * Export a job as an .ics calendar event and hand it to the device.
 *
 * WHY THIS IS A REAL FILE ON NATIVE, AND NOT A `data:` URL
 * -------------------------------------------------------
 * This used to hand `Share.share({ url: "data:text/calendar;…" })` to the OS
 * on native. On iOS that is inert for the one thing it exists to do. The
 * plugin does `URL(string: url)` and appends the result to
 * `UIActivityViewController`'s items (SharePlugin.swift), so what iOS receives
 * is *a URL* — and iOS decides which share targets to offer from an item's
 * UTI. A `data:` URL has no UTI; the Calendar app registers as a handler for
 * the `com.apple.ical.ics` **file** type. So the sheet opened, offered Copy /
 * Messages / Mail on an opaque percent-encoded blob, and never offered "Add to
 * Calendar" — the tap appeared to work and produced nothing. It also passed a
 * `text:` item alongside, which makes the share a mixed text+URL activity and
 * suppresses document-handler extensions outright.
 *
 * The fix is the idiom iOS actually acts on: stage the .ics as a real file
 * with @capacitor/filesystem, then share the `file://` URI (and *only* that
 * item). iOS resolves the `.ics` extension to `com.apple.ical.ics`, and the
 * sheet offers the Calendar app's "Add to Calendar" / "Add All" action.
 *
 * @capacitor/filesystem was added for this (and registered in the iOS SPM
 * package via `npx cap update ios`). There is still no Capacitor *calendar*
 * plugin in the project — none is installed and none is needed: EventKit
 * plugins require a `NSCalendarsUsageDescription` prompt and write silently
 * into a calendar the user didn't choose, whereas the share sheet lets them
 * pick the calendar and see the event before it lands.
 *
 * Branches:
 *  1. Native (`isNativePlatform`) — Filesystem.writeFile → Share.share({files}).
 *  2. Web — an `<a download>` on an object URL. Kept exactly as it was: it
 *     works, and a share sheet would be strictly worse on desktop.
 *
 * Every failure is BOTH toasted and `report`ed. The original defect was not
 * only that the native path did nothing — it was that it did nothing
 * *silently*, with no toast and no telemetry to notice it by.
 */
export async function exportJobToCalendar(job: CalendarEventInput): Promise<void> {
  const ics = buildJobICS(job);
  const fileName = safeFileName(job.title);

  if (isNativePlatform) {
    let fileUri: string;
    // Staging the file and presenting the sheet fail for different reasons and
    // deserve different copy, so they get their own try/catch. A write failure
    // is never a user cancellation; collapsing them let a disk error be
    // swallowed by the `/cancel/i` test below.
    try {
      const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
      const written = await Filesystem.writeFile({
        path: fileName,
        data: ics,
        // Caches, not Documents: this file exists only long enough for the
        // share sheet to read it, and Documents is user-visible + iCloud-backed
        // on iOS, so a stray .ics per tap would accumulate in the user's Files.
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      fileUri = written.uri;
    } catch (err) {
      report(err, { severity: "error", tags: { source: "calendarExport.writeFile" } });
      toast.error("Couldn't build the calendar event", {
        description: "Your device wouldn't let the app save the file. Try again.",
      });
      return;
    }

    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({
        // FILES ONLY. No `text`, no `url`: any extra activity item turns this
        // into a mixed share and iOS stops offering the Calendar action — the
        // exact thing that made this button do nothing. `title` is not an
        // activity item (the plugin sets it as the sheet's `subject`), so it
        // is safe to keep.
        title: job.title,
        files: [fileUri],
        dialogTitle: "Add to Calendar",
      });
    } catch (err) {
      if (isUserCancellation(err)) return;
      report(err, { severity: "error", tags: { source: "calendarExport.share" } });
      toast.error("Couldn't open your calendar", {
        description: "The share sheet didn't open. Try again.",
      });
    }
    return;
  }

  try {
    // Web: a real file download the OS calendar app can open.
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
    // The bare callable, NOT `toast.success`. `src/lib/toastPolicy.ts` no-ops
    // every action-less `toast.success` app-wide, and this branch is precisely
    // the case that cannot afford it: `<a download>` leaves the page pixel-
    // identical, the "Add to calendar" button has no busy/done state, and the
    // browser's download UI is silent on desktop Safari and absent on iOS
    // Safari. Written as `toast.success` it rendered NOTHING, so the only
    // outcome the user could ever perceive from this button was a failure.
    toast(`${fileName} downloaded`, { description: "Open it to add the job to your calendar." });
  } catch (err) {
    if (isUserCancellation(err)) return;
    report(err, { severity: "error", tags: { source: "calendarExport.download" } });
    toast.error("Couldn't export to calendar — try again.");
  }
}

/**
 * Longest job description carried into the event body.
 *
 * A calendar event's notes field is a glance surface, and a job description
 * can run to several paragraphs — every one of which gets 75-octet line-folded
 * into the .ics. Truncating keeps the file small and the event readable; the
 * full description is one tap away in the app, which the trailing line says.
 */
const DESCRIPTION_MAX_CHARS = 600;

/** Compose the event body from the job row. */
function jobEventDescription(job: Job): string {
  const parts: string[] = [];
  const body = (job.description ?? "").trim();
  if (body) {
    parts.push(body.length > DESCRIPTION_MAX_CHARS ? `${body.slice(0, DESCRIPTION_MAX_CHARS).trimEnd()}…` : body);
  }
  // The full street address, spelled out. LOCATION is the field a calendar app
  // hands to Maps, but several (iOS's own event list included) only show it on
  // the detail screen — repeating it in the body means the address is legible
  // wherever the event is read.
  if (job.location) parts.push(`Address: ${job.location}`);
  // Deliberately no money. This same row is exported by BOTH the poster (for
  // whom `budget` is what they pay) and the assigned helper (for whom the real
  // number is budget minus the platform fee — see `helperTakeHomeDollars`).
  // One figure cannot be correct for both, and a wrong number in someone's
  // calendar is worse than no number.
  parts.push("Scheduled through Louisiana Helpr.");
  return parts.join("\n\n");
}

/** Convenience wrapper that pulls the fields `exportJobToCalendar` needs
 *  straight off a `jobs` row, so call sites don't have to hand-build a
 *  `CalendarEventInput`. */
export function exportJobRowToCalendar(job: Job): Promise<void> {
  return exportJobToCalendar({
    id: job.id,
    title: job.title,
    location: job.location,
    description: jobEventDescription(job),
    dateNeeded: job.date_needed,
    startTime: job.start_time,
    estimatedHours: job.estimated_hours,
  });
}

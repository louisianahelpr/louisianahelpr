/**
 * 25 Days sponsor page: the countdown to December 1 and the "Add to calendar"
 * file. Louisiana time (America/Chicago): December is always Central Standard
 * Time (UTC-6), so midnight on Dec N is 06:00 UTC that day.
 */
import { sponsorPage } from "@/content/sponsorPage";

const { year, firstDay, lastDay } = sponsorPage.event;

/** Midnight Louisiana time at the start of December `day`. */
export function dayStartUtc(day: number): number {
  return Date.UTC(year, 11, day, 6, 0, 0);
}

export interface CountdownState {
  phase: "before" | "live" | "over";
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** During the giveaway: which day (1-25) it is in Louisiana. */
  liveDay: number | null;
}

export function countdown(nowMs: number): CountdownState {
  const start = dayStartUtc(firstDay);
  const end = dayStartUtc(lastDay + 1);
  if (nowMs >= end) return { phase: "over", days: 0, hours: 0, minutes: 0, seconds: 0, liveDay: null };
  if (nowMs >= start) {
    const liveDay = Math.min(lastDay, firstDay + Math.floor((nowMs - start) / 86_400_000));
    return { phase: "live", days: 0, hours: 0, minutes: 0, seconds: 0, liveDay };
  }
  let left = Math.floor((start - nowMs) / 1000);
  const days = Math.floor(left / 86_400);
  left -= days * 86_400;
  const hours = Math.floor(left / 3600);
  left -= hours * 3600;
  const minutes = Math.floor(left / 60);
  const seconds = left - minutes * 60;
  return { phase: "before", days, hours, minutes, seconds, liveDay: null };
}

/** "December 3" style label for a giveaway day. */
export function dayLabel(day: number): string {
  return `December ${day}`;
}

/** Lists days as "December 3, 7 and 12". */
export function daysLabel(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return dayLabel(sorted[0]);
  return `December ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

function icsDate(day: number): string {
  return `${year}12${String(day).padStart(2, "0")}`;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * An .ics calendar file with one all-day event per chosen day (or one on
 * December 1 for "Any day is fine"). Built on the device: no third-party
 * calendar service is called.
 */
export function buildIcs(opts: { brand: string; days: readonly number[]; anyDay: boolean; nowMs?: number }): string {
  const t = sponsorPage.thankYou;
  const stamp = new Date(opts.nowMs ?? Date.now()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const days = opts.anyDay || opts.days.length === 0 ? [firstDay] : [...opts.days].sort((a, b) => a - b);
  const title = opts.anyDay || opts.days.length === 0
    ? t.calendarEventAnyDay
    : t.calendarEventTitle.replace("{brand}", opts.brand);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Louisiana Helpr//25 Days of Louisiana Giveaways//EN", "CALSCALE:GREGORIAN"];
  for (const d of days) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:25days-${year}-${d}-${stamp}@louisianahelpr.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(d)}`,
      `DTEND;VALUE=DATE:${icsDate(d + 1)}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(t.calendarEventBody)}`,
      `URL:${sponsorPage.links.website}/sponsor`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

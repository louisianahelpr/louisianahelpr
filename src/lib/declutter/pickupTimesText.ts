/**
 * The pickup times in words (Q2707/Q2708, Builder 3 11-05): pure text helpers, split out of DeclutterPickupTimes so
 * the Declutter item page (ItemPickupDisplay, DeclutterPorchPlaces) shows a place's hours without fetching the times
 * editor, whose NativeSelect import pulled Radix Select and its deps (~25 KB gz) onto every cold item page.
 * DeclutterPickupTimes re-exports them for the editor's other readers.
 */
import type { PickupWindow } from "@/lib/declutter/api";

const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "09:00" -> "9:00 AM", "17:30" -> "5:30 PM". */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** True when every chosen day has exactly one window and they all share one range. */
export function sameHoursEveryDay(windows: PickupWindow[]): boolean {
  if (windows.length === 0) return true;
  const days = new Set(windows.map((w) => w.weekday));
  return days.size === windows.length && windows.every((w) => w.starts === windows[0].starts && w.ends === windows[0].ends);
}

/** "Sat, Sun": short weekday names, in week order. */
export function shortDays(days: readonly number[] | null | undefined): string {
  // A row missing its days (an older server, a mocked read) shows nothing rather than blanking the page (review 2026-10-31).
  if (!Array.isArray(days)) return "";
  return [...days].sort((a, b) => a - b).map((d) => SHORT_DAY[d]).filter(Boolean).join(", ");
}

export const byDayThenStart = (a: PickupWindow, b: PickupWindow) => a.weekday - b.weekday || a.starts.localeCompare(b.starts);

/**
 * One place's days and hours in words (LEAD-POST-PLACES): "Every day 7:00 AM–9:00 PM", "Mon, Wed 9:00 AM–12:00 PM",
 * or per day when they differ: "Sat 9:00 AM–12:00 PM; Sun 1:00 PM–3:00 PM". No hours (an older server): the days.
 */
export function placeHoursLine(windows: PickupWindow[] | null | undefined, weekdays: number[] | null | undefined): string {
  const ws = (windows ?? []).filter((w) => w && typeof w.starts === "string" && typeof w.ends === "string");
  if (ws.length === 0) return shortDays(weekdays);
  const range = (w: PickupWindow) => `${timeLabel(w.starts)}–${timeLabel(w.ends)}`;
  if (sameHoursEveryDay(ws)) {
    const days = [...new Set(ws.map((w) => w.weekday))];
    return `${days.length === 7 ? "Every day" : shortDays(days)} ${range(ws[0])}`;
  }
  const byDay = new Map<number, PickupWindow[]>();
  for (const w of [...ws].sort(byDayThenStart)) byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), w]);
  return [...byDay.entries()].map(([d, list]) => `${SHORT_DAY[d]} ${list.map(range).join(", ")}`).join("; ");
}

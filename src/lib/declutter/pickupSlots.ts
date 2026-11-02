/**
 * The seller's pickup windows, for the people who need them (deep audit #2 + #58, lead 2026-10-28):
 *  - windowsSummary: one line for the item page, "Mon–Fri 5–8 PM; Sat 9 AM–12 PM".
 *  - pickupDays: the buyer's picker, day chips and half-hour time chips that are all bookable.
 * The rule is the server's own, declutter_slot_in_windows (20261015042253): a 30-minute slot that starts
 * at or after the window's start and no later than 30 minutes before its end, in America/Chicago, on the
 * window's weekday (0 = Sunday); and declutter_book_pickup's: in the future, ending by the 7-day deadline.
 * Pure (no React, no network), so the picker and its tests share one rule.
 */
export type SellerWindow = { weekday: number; starts: string; ends: string };

const ZONE = "America/Chicago";
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLOT_MIN = 30;

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** "17:00" -> "5", "17:30" -> "5:30"; the AM/PM goes on separately. */
function clock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min % 60 === 0 ? String(h12) : `${h12}:${String(min % 60).padStart(2, "0")}`;
}
const meridiem = (min: number) => (Math.floor(min / 60) % 24 >= 12 ? "PM" : "AM");

/** "17:00"-"20:00" -> "5–8 PM"; "09:30"-"13:00" -> "9:30 AM–1 PM". */
function rangeLabel(starts: string, ends: string): string {
  const a = minutes(starts);
  const b = minutes(ends);
  return meridiem(a) === meridiem(b) ? `${clock(a)}–${clock(b)} ${meridiem(b)}` : `${clock(a)} ${meridiem(a)}–${clock(b)} ${meridiem(b)}`;
}

/** "17:00" -> "5:00 PM" (a time chip). */
function timeChipLabel(min: number): string {
  const h = Math.floor(min / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(min % 60).padStart(2, "0")} ${meridiem(min)}`;
}

/** Weekdays as runs: [1,2,3,4,5] -> "Mon–Fri", [0,6] -> "Sun, Sat", [1,3] -> "Mon, Wed". */
function dayRuns(days: number[]): string {
  const sorted = [...new Set(days)].sort((x, y) => x - y);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j - i >= 2 ? `${DAY[sorted[i]]}–${DAY[sorted[j]]}` : sorted.slice(i, j + 1).map((d) => DAY[d]).join(", "));
    i = j + 1;
  }
  return runs.join(", ");
}

/** One line for the item page: the days that share a range, then the range; "" when the seller set none. */
export function windowsSummary(windows: readonly SellerWindow[]): string {
  const byRange = new Map<string, number[]>();
  for (const w of [...windows].sort((x, y) => x.weekday - y.weekday || minutes(x.starts) - minutes(y.starts))) {
    const key = `${w.starts.slice(0, 5)}|${w.ends.slice(0, 5)}`;
    byRange.set(key, [...(byRange.get(key) ?? []), w.weekday]);
  }
  return [...byRange.entries()]
    .sort((x, y) => Math.min(...x[1]) - Math.min(...y[1]) || minutes(x[0]) - minutes(y[0]))
    .map(([key, days]) => {
      const [s, e] = key.split("|");
      return `${dayRuns(days)} ${rangeLabel(s, e)}`;
    })
    .join("; ");
}

/** The offset of America/Chicago from UTC at an instant, in ms (local - UTC). */
function zoneOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(utcMs / 1000) * 1000;
}

/** A Chicago wall-clock time on a Chicago date, as a UTC instant (DST-safe: the offset is read at the instant). */
function chicagoInstant(ymd: string, min: number): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(min / 60), min % 60);
  const first = wall - zoneOffsetMs(wall);
  const second = wall - zoneOffsetMs(first);
  return second;
}

/** The Chicago date (YYYY-MM-DD) and weekday of an instant. */
function chicagoDay(utcMs: number): { ymd: string; weekday: number } {
  const local = new Date(utcMs + zoneOffsetMs(utcMs));
  const ymd = local.toISOString().slice(0, 10);
  return { ymd, weekday: local.getUTCDay() };
}

type PickupSlot = { iso: string; label: string };
export type PickupDay = { ymd: string; label: string; slots: PickupSlot[] };

/**
 * Every bookable 30-minute slot from now to the deadline, by Chicago day: inside a window on that weekday
 * (start >= window start, start + 30 min <= window end), starting after `nowMs`, ending by `deadlineMs`.
 * Days with no slot are left out. `deadlineMs` null (no deadline known) looks 7 days ahead.
 */
export function pickupDays(windows: readonly SellerWindow[], nowMs: number, deadlineMs: number | null): PickupDay[] {
  const end = deadlineMs ?? nowMs + 7 * 86_400_000;
  const out: PickupDay[] = [];
  const seen = new Set<string>();
  for (let t = nowMs; t <= end + 86_400_000; t += 86_400_000) {
    const { ymd, weekday } = chicagoDay(t);
    if (seen.has(ymd)) continue;
    seen.add(ymd);
    const starts = new Set<number>();
    for (const w of windows) {
      if (w.weekday !== weekday) continue;
      for (let m = minutes(w.starts); m + SLOT_MIN <= minutes(w.ends); m += SLOT_MIN) starts.add(m);
    }
    const slots = [...starts].sort((a, b) => a - b)
      .map((m) => ({ m, at: chicagoInstant(ymd, m) }))
      .filter(({ at }) => at > nowMs && at + SLOT_MIN * 60_000 <= end)
      .map(({ m, at }) => ({ iso: new Date(at).toISOString(), label: timeChipLabel(m) }));
    if (slots.length === 0) continue;
    const date = new Date(chicagoInstant(ymd, 12 * 60));
    const label = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "short", month: "short", day: "numeric" }).format(date);
    out.push({ ymd, label, slots });
  }
  return out;
}


/** The porch window a checkout books (lead 11-01: a porch pickup is a 2-hour window the seller leaves it out for). */
const PORCH_WINDOW_MIN = 120;

/**
 * B110: the porch pickup WINDOWS from now to the deadline, by Chicago day: from each window's start in 2-hour steps,
 * each cut at the window's end (at least 30 minutes; the server's declutter_checkout_pickup_end, 20261101191500).
 * The chip reads "3–5 PM"; its ISO is the window's start (what checkout sends).
 */
export function porchWindowDays(windows: readonly SellerWindow[], nowMs: number, deadlineMs: number | null): PickupDay[] {
  const end = deadlineMs ?? nowMs + 7 * 86_400_000;
  const out: PickupDay[] = [];
  const seen = new Set<string>();
  for (let t = nowMs; t <= end + 86_400_000; t += 86_400_000) {
    const { ymd, weekday } = chicagoDay(t);
    if (seen.has(ymd)) continue;
    seen.add(ymd);
    const spans = new Map<number, number>();
    for (const w of windows) {
      if (w.weekday !== weekday) continue;
      const wEnd = minutes(w.ends);
      const wStart = minutes(w.starts);
      for (let m = wStart; m + SLOT_MIN <= wEnd; m += PORCH_WINDOW_MIN) {
        // A3-65 (audit 7, 11-01): the last window slides back to end at the close ("10 AM-12 PM", not a 1-hour
        // "11 AM-12 PM"), so every chip is 2 hours; only hours shorter than 2 hours keep their own length. The server
        // ends a porch window at start + 2 h cut at the close (declutter_checkout_pickup_end), so it books the same.
        const s = m + PORCH_WINDOW_MIN > wEnd ? Math.max(wStart, wEnd - PORCH_WINDOW_MIN) : m;
        spans.set(s, Math.max(spans.get(s) ?? 0, Math.min(s + PORCH_WINDOW_MIN, wEnd)));
      }
    }
    const slots = [...spans.entries()].sort((a, b) => a[0] - b[0])
      .map(([m, e]) => ({ m, e, at: chicagoInstant(ymd, m) }))
      .filter(({ at }) => at > nowMs && at + SLOT_MIN * 60_000 <= end)
      .map(({ m, e, at }) => ({ iso: new Date(at).toISOString(), label: rangeLabel(hhmm(m), hhmm(e)) }));
    if (slots.length === 0) continue;
    const date = new Date(chicagoInstant(ymd, 12 * 60));
    const label = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "short", month: "short", day: "numeric" }).format(date);
    out.push({ ymd, label, slots });
  }
  return out;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Today's weekday in Louisiana (0 = Sun). */
export function chicagoWeekday(now: Date = new Date()): number {
  return DAY.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "short" }).format(now));
}

/**
 * A3-47: one way's hours on the item page, in ONE time format ("Sat 9 AM–12 PM"). Days that all share one range read
 * as a run ("Mon–Fri 5–8 PM", "Every day 7 AM–9 PM"); otherwise each day says its own hours, in week order starting
 * today ("Sun 1–5 PM, Sat 9 AM–12 PM" on a Sunday). With no hours, only the days ("Sat, Sun"); "" when nothing is set.
 */
export function weekHoursLine(windows: readonly SellerWindow[] | null | undefined, weekdays: readonly number[] | null | undefined = null,
  today: number = chicagoWeekday()): string {
  const ws = (windows ?? []).filter((w) => w && typeof w.starts === "string" && typeof w.ends === "string");
  const fromToday = (d: number) => (d - today + 7) % 7;
  if (ws.length === 0) {
    const days = [...new Set(weekdays ?? [])];
    return days.length === 7 ? "Every day" : days.sort((a, b) => fromToday(a) - fromToday(b)).map((d) => DAY[d]).join(", ");
  }
  const key = (w: SellerWindow) => `${w.starts.slice(0, 5)}|${w.ends.slice(0, 5)}`;
  const ranges = new Set(ws.map(key));
  if (ranges.size === 1) {
    const days = [...new Set(ws.map((w) => w.weekday))];
    return `${days.length === 7 ? "Every day" : dayRuns(days)} ${rangeLabel(ws[0].starts.slice(0, 5), ws[0].ends.slice(0, 5))}`;
  }
  const byDay = new Map<number, SellerWindow[]>();
  for (const w of [...ws].sort((x, y) => fromToday(x.weekday) - fromToday(y.weekday) || minutes(x.starts) - minutes(y.starts))) {
    byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), w]);
  }
  return [...byDay.entries()]
    .map(([d, list]) => `${DAY[d]} ${list.map((w) => rangeLabel(w.starts.slice(0, 5), w.ends.slice(0, 5))).join(" and ")}`)
    .join(", ");
}

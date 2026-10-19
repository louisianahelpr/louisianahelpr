/**
 * A shop's hours in Louisiana time: "Open now · until 5 PM" or "Closed ·
 * opens Tuesday 9 AM". Shared by the shop page (ShopProfile) and the Browse
 * card (ShopsHomeView), so the two never disagree.
 */
import type { ShopHour } from "@/lib/shops/api";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function fmtTime(t: string): string {
  const [hh, mm] = t.split(":").map(Number);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
}

/** Weekday (0 = Sunday) and HH:MM in Louisiana, whatever the device's zone. */
export function louisianaNow(now: Date): { weekday: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, hhmm: `${get("hour")}:${get("minute")}` };
}

/** "Open now · until 5 PM", "Closed · opens Tuesday 9 AM", or null when the shop set no hours. */
export function openStatus(hours: ShopHour[], now: Date = new Date()): { open: boolean; label: string } | null {
  if (hours.length === 0) return null;
  const { weekday, hhmm } = louisianaNow(now);
  const current = hours.find((h) => h.weekday === weekday && h.opens <= hhmm && hhmm < h.closes);
  if (current) return { open: true, label: `Open now · until ${fmtTime(current.closes)}` };
  for (let d = 0; d < 7; d++) {
    const day = (weekday + d) % 7;
    const next = hours
      .filter((h) => h.weekday === day && (d > 0 || h.opens > hhmm))
      .sort((a, b) => a.opens.localeCompare(b.opens))[0];
    if (next) {
      const when = d === 0 ? "today" : d === 1 ? "tomorrow" : WEEKDAYS[day];
      return { open: false, label: `Closed · opens ${when} ${fmtTime(next.opens)}` };
    }
  }
  return { open: false, label: "Closed" };
}

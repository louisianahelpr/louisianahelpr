/**
 * The Louisiana wall clock (America/Chicago), whatever the device's zone. A leaf with no imports: hours.ts (the shop
 * page) and orders.ts (Home's home-shop-reads chunk, S2-044 cancel cutoff) both read it, and orders.ts must not pull
 * hours.ts's signed-in chunk onto /home (src/test/homeLazyReadsStayLight.test.ts).
 */
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

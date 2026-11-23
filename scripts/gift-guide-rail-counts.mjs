#!/usr/bin/env node
/**
 * The gift guides menu's numbers that the guide pages cannot read for free (owner 2026-11-22, 7:52 PM: "should we put the
 * number of items in each section on the right of the section name?"; pop-up 7:55 PM: "Number on the right"). Writes
 * src/content/giftGuideRailCounts.json, which the menu loads in its own small chunk after the page draws (never on a
 * guide page's first paint: the critical path had ~283 B left):
 *   hub: what /holidays lists with no filter, as a schedule, because the Hub hides an item once it is over (isOver: the
 *     day after its last day) and a one-day item once its simple hours have closed (endedEarlierToday). `from` is the
 *     first day of the window, `days` its length; `stay` counts the items listed all window long; `gone` is, for every
 *     other item listed on `from`, the minute (since `from` 00:00 Louisiana time) it leaves the list, sorted. The count at
 *     a moment inside the window = stay + the `gone` entries still ahead of it (hubCountAt in railCounts.ts). Outside the
 *     window the row shows no number.
 * Each item's leaving minute comes from the Hub's own functions (filterHolidayItems, endedEarlierToday), stepping day by
 * day and, on its last listed day, minute by minute, so it is the page's rule, not a copy of it.
 * Her, Him, Kids and the 25 Days sponsors read CHUNK_PICK_COUNTS (giftGuidePicks.ts, already in the menu's bundle), the
 * printables pages read printables.ts, and Black Friday and Cyber Monday are counted from the deals file when the chunk
 * loads. Small Business Saturday gets no number: under its sponsors it lists the approved "Featured local" businesses
 * read live from the database (sbs_public_featured, 1 on 2026-11-22), which only that page's Supabase chunk can count.
 * Registered in scripts/check-generated-current.mjs (gift-guide-rail-counts). Guard: src/test/giftGuideRailCounts1122.test.tsx.
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HOLIDAY_LIGHTS } from "../src/content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "../src/content/holidayHub/events.mjs";
import { endedEarlierToday, filterHolidayItems } from "../src/content/holidayHub/holidayHub.mjs";

const REPO = resolve(import.meta.dirname, "..");
const OUT = join(REPO, "src/content/giftGuideRailCounts.json");
/** The Hub's window: the season's lists, Nov 1 through Mar 31 (after that the row shows no number until regenerated). */
export const HUB_FROM = "2026-11-01";
export const HUB_DAYS = 151;

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The Hub's schedule (see the header). */
export function buildHub(lights = HOLIDAY_LIGHTS, events = HOLIDAY_EVENTS) {
  const days = Array.from({ length: HUB_DAYS }, (_, d) => addDays(HUB_FROM, d));
  const listed = days.map((day) => new Set(filterHolidayItems(lights, events, {}, day)));
  let stay = 0;
  const gone = [];
  for (const item of listed[0]) {
    let at = null;
    for (let d = 0; d < HUB_DAYS && at === null; d++) {
      if (!listed[d].has(item)) at = d * 1440;
      // Only a one-day item on its own day can close early (endedEarlierToday is false on every other day).
      else if (item.start === days[d]) for (let m = 0; m < 1440; m++) if (endedEarlierToday(item, days[d], m)) { at = d * 1440 + m; break; }
    }
    if (at === null) stay++;
    else gone.push(at);
  }
  return { from: HUB_FROM, days: HUB_DAYS, stay, gone: gone.sort((a, b) => a - b) };
}

export function buildRailCounts() {
  return { hub: buildHub() };
}

export const railCountsText = (c) => `${JSON.stringify(c)}\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = buildRailCounts();
  writeFileSync(OUT, railCountsText(c));
  console.log(`gift-guide-rail-counts: hub stay ${c.hub.stay} + ${c.hub.gone.length} leaving -> src/content/giftGuideRailCounts.json`);
}

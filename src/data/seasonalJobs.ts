/**
 * LOUISIANA SEASONS (Q2016, owner order 2026-10-17): storm prep and cleanup, crawfish boil help, Mardi Gras and
 * festival help, back-to-school moves. In season, these templates lead "Pick a template" on Post a job, marked
 * "In season"; out of season they are not shown. A template fills category, title and description only, like
 * every template (useJobEntry.applyTemplateFields): the poster names the price.
 *
 * NO SEASON OR STORM PRICING, EVER. La. R.S. 29:732(A) (legis.la.gov, read 2026-11-02): during a state of
 * emergency declared by the governor or a parish president, "the prices charged or value received for goods and
 * services sold within the designated emergency area may not exceed the prices ordinarily charged for comparable
 * goods and services in the same market area at or immediately before the time of the state of emergency"; each
 * sale or offer is a separate offense (29:732(C)). So these entries carry NO price field, no multiplier and no
 * "storm rate" words, and nothing in the app prices a job by season or by a declared emergency: the price hint a
 * poster sees (PriceGuidance) is the same ordinary figure all year. Guard: src/test/seasonalJobs.test.ts.
 */
import type { SampleJob } from "./sampleJobs";

/** A seasonal template: a SampleJob's fields minus any price (R.S. 29:732, above). */
export interface SeasonalJob extends Pick<SampleJob, "id" | "category" | "icon" | "title" | "description" | "typical_duration_minutes"> {
  /** Inclusive month-day windows ("MM-DD"), Louisiana calendar. A window may not wrap past Dec 31. */
  seasons: ReadonlyArray<{ from: string; to: string }>;
}

export const seasonalJobs: SeasonalJob[] = [
  {
    id: "storm-prep-yard",
    category: "yard_work",
    icon: "🌀",
    title: "Get the yard ready for a storm",
    description:
      "Bring in patio furniture, pots and the grill, clear leaves out of the gutters and storm drain, and stack a few sandbags by the back door. Sandbags are already here.",
    typical_duration_minutes: 120,
    // Atlantic hurricane season.
    seasons: [{ from: "06-01", to: "11-30" }],
  },
  {
    id: "storm-cleanup-debris",
    category: "yard_work",
    icon: "🪵",
    title: "Storm cleanup: branches to the curb",
    description:
      "Pick up fallen branches and limbs and stack them at the curb for parish pickup, then rake the yard. Nothing needs a chainsaw.",
    typical_duration_minutes: 180,
    seasons: [{ from: "06-01", to: "11-30" }],
  },
  {
    id: "crawfish-boil-help",
    category: "events",
    icon: "🦞",
    title: "Help at a backyard crawfish boil",
    description:
      "Set up tables and the boil station, help rinse and serve, then break everything down and bag the trash. About 40 people. Pot and burner are ours.",
    typical_duration_minutes: 300,
    // Crawfish season.
    seasons: [{ from: "02-01", to: "05-31" }],
  },
  {
    id: "mardi-gras-festival-help",
    category: "events",
    icon: "🎭",
    title: "Mardi Gras or festival help",
    description:
      "Help set up a tent, chairs and a cooler on the parade route or at the festival, and pack it all back up after. Everything fits in one truck.",
    typical_duration_minutes: 240,
    // Carnival (Twelfth Night to the latest possible Mardi Gras), then the fall festival season.
    seasons: [
      { from: "01-06", to: "03-10" },
      { from: "09-15", to: "11-15" },
    ],
  },
  {
    id: "back-to-school-move",
    category: "moving",
    icon: "🎒",
    title: "Back-to-school move",
    description:
      "Load boxes, a mini fridge and a twin bed into a truck and carry them up to a dorm or apartment. Two flights of stairs at the other end.",
    typical_duration_minutes: 180,
    seasons: [{ from: "07-15", to: "09-10" }],
  },
];

/** "MM-DD" of a date in Louisiana (America/Chicago), so the season turns at local midnight, not UTC's. */
export function louisianaMonthDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}-${get("day")}`;
}

/** The seasonal templates in season on `now` (Louisiana date), in list order. */
export function inSeasonJobs(now: Date = new Date()): SeasonalJob[] {
  const md = louisianaMonthDay(now);
  return seasonalJobs.filter((j) => j.seasons.some((s) => s.from <= md && md <= s.to));
}

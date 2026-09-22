/**
 * TWO WRITERS, ONE WEEK — and they must agree ON PAPER, not on prod.
 *
 * ─── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 * `helper_availability` for the shared helper-e2e account has two writers:
 *
 *   1. `scripts/audit/prod-seed.mjs` upserts the weekly grid at DETERMINISTIC
 *      ids (`sid("avail:<day>")`), one row per day it decides to seed.
 *   2. `e2e/journeys/03-account.spec.ts` writes the week through the app's own
 *      `save_weekly_availability` RPC, which DELETEs the whole week and
 *      re-inserts it with RANDOM ids — and then requires exactly the seven
 *      rows it documents.
 *
 * Because the seeder's ids are deterministic and the journey's are not, the
 * two do not overwrite each other: they ACCUMULATE. The seeder seeded SIX days
 * (Mon-Sat), the journey wrote SEVEN, and on 2026-09-21 helper-e2e held THIRTEEN
 * rows. J7 then failed on its own precondition:
 *
 *     expect(week.length, "the helper has no saved weekly hours to start from")
 *       Expected: 7
 *       Received: 13
 *
 * The 13 rows were the SYMPTOM. The defect is that two writers of one table
 * disagreed about its shape, and nothing in the repo could say so until the
 * disagreement had already been written to the production database and a
 * journey had tripped over it at 3 a.m.
 *
 * ─── WHAT THIS GUARD ASSERTS ───────────────────────────────────────────────
 * It derives BOTH sides from their own source and fails on the difference:
 *
 *   • the seeder's day list, its start time and its end time, read out of
 *     `prod-seed.mjs`;
 *   • the journey's expected row count and its DEFAULT_WEEK shape, read out of
 *     `03-account.spec.ts`.
 *
 * Neither number is written down here. A guard that restated "7" would be a
 * third writer with its own opinion — which is the very thing being guarded
 * against. (Owner ruling, 2026-09-21: "Seeder owns it, seeds all 7.")
 *
 * It also checks that the seeder's upsert, its teardown and its --verify count
 * all go through the SAME constant, because a seeder that seeds seven days and
 * tears down six leaves exactly the orphan row this whole class is about.
 *
 * A third reader, `e2e/journeys/time-travel.spec.ts`, wants a 09:00-17:00
 * every-day grid too, but for the POSTER account, which this seeder does not
 * write — so it is deliberately not coupled here.
 */
// Shown able to fail on the ORIGINAL bug: put the seeder back to the six days
// it seeded on 2026-09-21 and this guard reds on the day count, without any
// prod row having to be written.
// @mutate scripts/audit/prod-seed.mjs | const SEED_AVAILABILITY_DAYS = [0, 1, 2, 3, 4, 5, 6]; | const SEED_AVAILABILITY_DAYS = [1, 2, 3, 4, 5, 6];
// And on the hours, which is the other half of "the same seven rows".
// @mutate scripts/audit/prod-seed.mjs | const SEED_AVAILABILITY_START = "09:00:00"; | const SEED_AVAILABILITY_START = "08:00:00";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

const SEEDER = "scripts/audit/prod-seed.mjs";
const JOURNEY = "e2e/journeys/03-account.spec.ts";

/** The seeder's own declaration of the week it owns. */
function seederWeek() {
  const src = read(SEEDER);
  const days = /const SEED_AVAILABILITY_DAYS\s*=\s*\[([^\]]*)\]/.exec(src);
  const start = /const SEED_AVAILABILITY_START\s*=\s*"([^"]+)"/.exec(src);
  const end = /const SEED_AVAILABILITY_END\s*=\s*"([^"]+)"/.exec(src);
  expect(
    days && start && end,
    `${SEEDER} no longer declares SEED_AVAILABILITY_DAYS / _START / _END. ` +
      `Those three constants are what makes the seeder's week readable without ` +
      `running it; inlining them back into the upsert puts this table back to ` +
      `"whichever writer ran last wins".`,
  ).toBeTruthy();
  return {
    src,
    days: days![1]
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .map(Number),
    start: start![1],
    end: end![1],
  };
}

/** The journey's own expectation, read out of the spec, never restated here. */
function journeyWeek() {
  const src = read(JOURNEY);
  // The precondition: `expect(week.length, "…").toBe(N)`.
  const count = /week\.length[\s\S]{0,400}?\)\s*\.toBe\(\s*(\d+)\s*\)/.exec(src);
  // The shape it writes when it finds the account empty.
  const def = /const DEFAULT_WEEK\s*=\s*\[([^\]]*)\]([\s\S]{0,400}?)\}\)\)/.exec(src);
  expect(
    count && def,
    `${JOURNEY} no longer states its weekly-hours precondition in a form this ` +
      `guard can read (an \`expect(week.length …).toBe(N)\` and a DEFAULT_WEEK ` +
      `day array). Without both, nothing compares the two writers of ` +
      `helper_availability until prod has already been left with a mixed week.`,
  ).toBeTruthy();
  const body = def![2];
  return {
    count: Number(count![1]),
    days: def![1]
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .map(Number),
    start: /start_time:\s*"([^"]+)"/.exec(body)?.[1],
    end: /end_time:\s*"([^"]+)"/.exec(body)?.[1],
  };
}

describe("helper_availability: the seeder and the account journey seed the same week", () => {
  it("seeds as many days as the journey requires rows", () => {
    const seeder = seederWeek();
    const journey = journeyWeek();
    expect(
      seeder.days.length,
      `${SEEDER} seeds ${seeder.days.length} weekday rows (${seeder.days.join(", ")}), but ` +
        `${JOURNEY} requires exactly ${journey.count} rows to be present before it will run. ` +
        `These two writers do not overwrite each other — the seeder writes at deterministic ` +
        `ids and save_weekly_availability re-inserts at random ones — so a mismatch ACCUMULATES ` +
        `on prod: 6 + 7 = the 13 rows helper-e2e held on 2026-09-21, and J7 failed its own ` +
        `precondition. Seeder owns the week (owner, 2026-09-21); seed all ${journey.count} days.`,
    ).toBe(journey.count);
  });

  it("seeds the same days the journey's DEFAULT_WEEK writes", () => {
    const seeder = seederWeek();
    const journey = journeyWeek();
    expect(
      seeder.days,
      `${SEEDER} seeds days [${seeder.days.join(", ")}] and ${JOURNEY}'s DEFAULT_WEEK writes ` +
        `days [${journey.days.join(", ")}]. Same count is not the same week: a seeder missing ` +
        `Sunday while the journey writes it leaves one row the seeder will never tear down.`,
    ).toEqual(journey.days);
  });

  it("seeds the hours the journey's DEFAULT_WEEK uses", () => {
    const seeder = seederWeek();
    const journey = journeyWeek();
    expect(
      { start: seeder.start, end: seeder.end },
      `${SEEDER} seeds ${seeder.start}-${seeder.end} and ${JOURNEY}'s DEFAULT_WEEK writes ` +
        `${journey.start}-${journey.end}. The two writers must be interchangeable, not merely ` +
        `the same row COUNT — the availability screen reads the hours, and re-seeding after a ` +
        `journey run would silently move them.`,
    ).toEqual({ start: journey.start, end: journey.end });
  });

  it("upserts, tears down and verifies through that one day list", () => {
    const { src, days } = seederWeek();
    for (const use of [
      'await upsert("helper_availability", SEED_AVAILABILITY_DAYS.map(',
      'await del("helper_availability", `id=${inList(SEED_AVAILABILITY_DAYS.map(',
      "&select=id`, SEED_AVAILABILITY_DAYS.length)",
    ]) {
      expect(
        src.includes(use),
        `${SEEDER} no longer routes one of its three helper_availability sites through ` +
          `SEED_AVAILABILITY_DAYS (missing: ${use.trim()}). Seeding ${days.length} days and ` +
          `tearing down a different set is how an orphan row survives --teardown and shows up ` +
          `as an extra row in the next journey run.`,
      ).toBe(true);
    }
    expect(
      src.includes("start_time: SEED_AVAILABILITY_START") &&
        src.includes("end_time: SEED_AVAILABILITY_END"),
      `${SEEDER}'s helper_availability upsert no longer uses SEED_AVAILABILITY_START/_END, so ` +
        `the hours this guard compares against the journey are not the hours it writes.`,
    ).toBe(true);
  });
});

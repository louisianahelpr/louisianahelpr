/**
 * Nightly e2e-journeys 43430382667 (2026-11-13, issue #2436): time-travel "confirm window" failed before-open waiting
 * for "4h 0m until you can confirm". F270 (owner 11-11) had replaced that running clock with plain words,
 * "Confirm opens Thu at 12:00 AM." (confirmOpensWords), so the spec waited for copy the app no longer draws.
 *
 * This keeps the spec and the app's copy in step: the pattern the spec builds for before-open must match what
 * confirmationOpensClock really prints 4 hours before the window opens, and the retired clock words stay out of it.
 *
 * @mutate src/components/job-card/confirmationOpensClock.ts |   return `Confirm opens ${day} at ${time}.`; |   return `Confirmation opens ${day} at ${time}.`;
 * @mutate e2e/journeys/time-travel.spec.ts | new RegExp(`Confirm opens ${opensDay} at 12:00\\sAM\\.`) | /4h 0m until you can confirm/
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { confirmationOpensClock } from "@/components/job-card/confirmationOpensClock";
import { confirmOpensMs } from "@/lib/jobDate";
import { blankComments } from "./helpers/blankNonCode";

const spec = blankComments(readFileSync(resolve(__dirname, "../../e2e/journeys/time-travel.spec.ts"), "utf8"));

describe("time-travel's before-open leg waits for the copy the app draws (F270)", () => {
  it("the spec builds its before-open pattern from the opening day, not the retired clock", () => {
    expect(spec).not.toContain("until you can confirm");
    expect(spec).toContain('new RegExp(`Confirm opens ${opensDay} at 12:00\\\\sAM\\\\.`)');
  });

  it("that pattern matches confirmationOpensClock 4 hours before the window, across several job dates", () => {
    const dates = ["2026-11-18", "2026-11-20", "2026-12-01", "2027-03-15"];
    expect(dates.length).toBeGreaterThan(2);
    for (const date of dates) {
      const opens = confirmOpensMs(date);
      const now = new Date(opens - 4 * 3_600_000);
      const row = confirmationOpensClock(date, "accepted", false, now, "10:00");
      expect(row, date).not.toBeNull();
      const opensDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(
        new Date(opens + 12 * 3_600_000),
      );
      // The spec's own expression, reproduced.
      expect(row!.clock.text, date).toMatch(new RegExp(`Confirm opens ${opensDay} at 12:00\\sAM\\.`));
    }
  });
});

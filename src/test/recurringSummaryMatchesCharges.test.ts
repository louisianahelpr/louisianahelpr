import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { recurringVisitDates, seriesTotalDollars } from "@/lib/recurringSchedule";
import { buildJobInsertPayload, type BuildJobInsertPayloadInput } from "@/pages/post-job/jobSubmitHelpers";

import * as edge from "../../supabase/functions/_shared/recurringSchedule";

/**
 * CLASS CHECK: what the Repeats picker and the checkout Repeats row SHOW is
 * exactly what the poster is CHARGED for (owner report 2026-10-01, "4 visits,
 * picked days only").
 *
 * The bug: a series started on Fri 2 Oct, Mon+Thu, 2 weeks. The picker counted
 * calendar weeks (the week CONTAINING the start), so it showed 2 visits (Oct 5,
 * Oct 8) — while the first job was saved and charged at checkout on Fri 2 Oct,
 * a day the poster never picked, and the cron then billed Oct 5 and Oct 8 on
 * top. Shown 2, charged 3, one of them on an unpicked weekday.
 *
 * The rule now (owner): N weeks FROM THE START DATE, picked weekdays only. The
 * first visit is the first picked weekday on/after the start, and it is what
 * the first job is saved (and charged) on.
 *
 * "Charged" here is derived from the code that actually charges, not restated:
 *   - visit 1: the `date_needed` the real insert builder writes (paid at
 *     checkout on that job);
 *   - every later visit: what charge-recurring-visits bills, i.e. the EDGE
 *     module's dates for that saved job, filtered `d > date_needed` exactly as
 *     the cron filters them (charge-recurring-visits/index.ts).
 * The SQL layer (series_visit_dates) is held to the same dates by the PGlite
 * proof in src/test/pglite/recurringSplitDays.pglite.mjs.
 */

const base: BuildJobInsertPayloadInput = {
  userId: "u1", businessId: null, title: "Mow the lawn", description: "Front and back",
  category: "yard_work", streetAddress: "1 Main", city: "Houma", addrState: "LA",
  zipCode: "70360", parish: "Terrebonne",
  dateNeeded: "2026-10-02", startTime: "09:00", isFlexibleSchedule: false,
  estimatedHours: "2", budget: "10", materialsNote: null,
  isRecurring: true, recurrenceInterval: "weekly", recurrenceEndDate: "",
  isGroupJob: false, helpersNeeded: "2", isUrgent: false, urgentFee: "5",
  platformFee: 15, salesTaxRate: 0, offerToHelperId: null,
};

function saved(start: string, days: number[], weeks: number) {
  return buildJobInsertPayload({
    ...base, dateNeeded: start, recurrenceDays: days, recurrenceWeeks: weeks,
  }) as Record<string, unknown>;
}

/** Every date the poster pays for: checkout's job, then the cron's later visits. */
function chargedVisitDates(start: string, days: number[], weeks: number): string[] {
  const p = saved(start, days, weeks);
  const parentDate = String(p.date_needed);
  const later = edge
    .recurringVisitDates(parentDate, p.recurrence_days as number[], p.recurrence_weeks as number)
    .filter((d) => d > parentDate);
  return [parentDate, ...later];
}

const dow = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

// Every weekday as a start, against day sets that do and do not include it.
// 2026-10-04 is a Sunday, so these run Sun..Sat.
const STARTS = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];
const DAY_SETS = [[1, 4], [1, 3, 5], [0, 6], [2], [5], [0, 1, 2, 3, 4, 5, 6]];
const WEEKS = [1, 2, 3, 4, 52];

const COMBOS: Array<{ start: string; days: number[]; weeks: number }> = [];
for (const start of STARTS) for (const days of DAY_SETS) for (const weeks of WEEKS) COMBOS.push({ start, days, weeks });

describe("Repeats: what is shown == what is charged", () => {
  it("covers every start weekday x day set x week count", () => {
    expect(COMBOS.length).toBeGreaterThan(200);
    expect(new Set(STARTS.map(dow)).size).toBe(7);
  });

  for (const { start, days, weeks } of COMBOS) {
    const tag = `${start} ${JSON.stringify(days)} x${weeks}`;

    it(`${tag}: summary dates == charged dates`, () => {
      expect(recurringVisitDates(start, days, weeks)).toEqual(chargedVisitDates(start, days, weeks));
    });

    it(`${tag}: N weeks x picked days, never an unpicked weekday`, () => {
      const charged = chargedVisitDates(start, days, weeks);
      expect(charged).toHaveLength(weeks * days.length);
      for (const d of charged) expect(days).toContain(dow(d));
      // Every visit inside [start, start + 7N).
      const endExcl = new Date(`${start}T12:00:00Z`);
      endExcl.setUTCDate(endExcl.getUTCDate() + 7 * weeks);
      for (const d of charged) {
        expect(d >= start).toBe(true);
        expect(d < endExcl.toISOString().slice(0, 10)).toBe(true);
      }
    });

    it(`${tag}: saved series ends on the last visit; labor total = visits x budget`, () => {
      const charged = chargedVisitDates(start, days, weeks);
      expect(saved(start, days, weeks).recurrence_end_date).toBe(charged[charged.length - 1]);
      expect(seriesTotalDollars(10, start, days, weeks)).toBe(10 * charged.length);
    });
  }

  it("owner's case: Fri 2026-10-02, Mon+Thu, 2 weeks = Oct 5, 8, 12, 15, $40 labor", () => {
    expect(recurringVisitDates("2026-10-02", [1, 4], 2)).toEqual(["2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15"]);
    expect(chargedVisitDates("2026-10-02", [1, 4], 2)).toEqual(["2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15"]);
    const p = saved("2026-10-02", [1, 4], 2);
    expect(p.date_needed).toBe("2026-10-05");
    expect(p.recurrence_end_date).toBe("2026-10-15");
    expect(seriesTotalDollars(10, "2026-10-02", [1, 4], 2)).toBe(40);
  });

  it("the SQL layer has its executable proof on the new migration", () => {
    const probe = readFileSync("src/test/pglite/recurringSeriesWeeksFromStart.pglite.mjs", "utf8");
    expect(probe).toContain('readMigration("20261001215555_recurring_series_weeks_from_start.sql")');
    expect(probe).toContain("OLD STATE RED");
    const mig = readFileSync("supabase/migrations/20261001215555_recurring_series_weeks_from_start.sql", "utf8");
    expect(mig).toMatch(/CREATE OR REPLACE FUNCTION public\.series_visit_dates\(p_start date, p_days smallint\[\], p_weeks integer\)/);
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.series_visit_dates\(date, smallint\[\], integer\) FROM PUBLIC, anon;/);
  });

  it("app and edge copies agree on every combo", () => {
    for (const { start, days, weeks } of COMBOS) {
      expect(edge.recurringVisitDates(start, days, weeks)).toEqual(recurringVisitDates(start, days, weeks));
    }
  });
});

// Proven red by scripts/check-mutations (each line must turn a test above red):
// @mutate src/pages/post-job/jobSubmitHelpers.ts | date_needed: firstVisit, | date_needed: dateNeeded,
// @mutate src/lib/recurringSchedule.ts | if (wanted.has(d.getUTCDay())) out.push(toYmd(d)); | out.push(toYmd(d));
// @mutate supabase/functions/_shared/recurringSchedule.ts | for (let i = 0; i < capped * 7; i++) { | for (let i = 0; i < capped * 7 + 1; i++) {

/**
 * A live recurring-series parent is never cancelled by the expiry sweep
 * (money review MED-3, 2026-09-27). A split series parent stays `open` while
 * Helprs pick its dates, so auto-expire-jobs' "open and date_needed passed"
 * rule matched it the day after visit one and cancelled the whole series.
 *
 * Class: every edge function that cancels OPEN jobs by date (the sweeps that
 * write `status: "cancelled"` after reading `.eq("status", "open")`) must skip
 * a live series parent through the one shared predicate.
 *
 * @mutate supabase/functions/_shared/seriesParent.ts |   if (job.series_ended_on) return false; |   if (false) return false;
 * @mutate supabase/functions/_shared/seriesParent.ts |   if (job.parent_job_id) return false; |   if (false) return false;
 * @mutate supabase/functions/auto-expire-jobs/index.ts |       if (isLiveSeriesParent(job, today)) continue; |       if (false) continue;
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { isLiveSeriesParent } from "../../supabase/functions/_shared/seriesParent";

const TODAY = "2032-01-05";

describe("isLiveSeriesParent", () => {
  it("a series parent with no end is live", () => {
    expect(isLiveSeriesParent({ parent_job_id: null, recurrence_days: [1, 3] }, TODAY)).toBe(true);
    expect(isLiveSeriesParent({ recurrence_days: [2], recurrence_end_date: "2032-01-05" }, TODAY)).toBe(true);
  });
  it("an ended series, a passed end date, a visit row and a one-off job are not", () => {
    expect(isLiveSeriesParent({ recurrence_days: [1], series_ended_on: "2032-01-01" }, TODAY)).toBe(false);
    expect(isLiveSeriesParent({ recurrence_days: [1], recurrence_end_date: "2032-01-04" }, TODAY)).toBe(false);
    expect(isLiveSeriesParent({ parent_job_id: "p", recurrence_days: [1] }, TODAY)).toBe(false);
    expect(isLiveSeriesParent({ parent_job_id: null, recurrence_days: null }, TODAY)).toBe(false);
    expect(isLiveSeriesParent({ recurrence_days: [] }, TODAY)).toBe(false);
  });
});

describe("every sweep that cancels open jobs skips a live series parent", () => {
  const dir = "supabase/functions";
  const sweeps = readdirSync(dir)
    .filter((f) => !f.startsWith("_") && existsSync(`${dir}/${f}/index.ts`))
    .map((f) => ({ f, src: readFileSync(`${dir}/${f}/index.ts`, "utf8") }))
    .filter(({ src }) => /\.eq\("status", "open"\)/.test(src) && /status: "cancelled"/.test(src) && /\.lt\("date_needed"/.test(src));

  it("the inventory is not empty (auto-expire-jobs is in it)", () => {
    expect(sweeps.length).toBeGreaterThanOrEqual(1);
    expect(sweeps.map((s) => s.f)).toContain("auto-expire-jobs");
  });
  for (const { f } of sweeps) {
    it(`${f} calls isLiveSeriesParent before cancelling`, () => {
      const src = readFileSync(`${dir}/${f}/index.ts`, "utf8").replace(/\/\/.*$/gm, "");
      expect(src).toMatch(/if \(isLiveSeriesParent\([^)]*\)\) continue;/);
    });
  }
});

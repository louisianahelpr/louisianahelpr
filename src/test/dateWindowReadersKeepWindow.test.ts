/**
 * Q2408 "Any time this week": a window job ("any day Nov 4-10") stays listed until its LAST day on every reader,
 * and every reader that prints the day prints the window. Builder 93 carried the window through open_jobs_browse
 * (20261104074500) and the cards; these are the readers that still dropped or misprinted it after the first day:
 *   - get_open_jobs_for_map + get_ranked_open_jobs (20261104080753): filtered on the FIRST day;
 *   - useDashboardData + useDashboardFilters: client "day has passed" culls on date_needed;
 *   - the map adapter and the first-job Home row: never carried date_window_end, so they printed the first day.
 * The SQL behaviour is proven in src/test/pglite/mapAndRankedReadDateWindow.pglite.mjs (red 9 FAIL before, green after).
 *
 * @mutate supabase/migrations/20261104080753_map_and_ranked_read_date_window.sql | (NULL end = one-day job, as before).\n    AND (j.date_needed IS NULL OR public.job_offer_cutoff(COALESCE(j.date_window_end, j.date_needed), j.start_time) | (NULL end = one-day job, as before).\n    AND (j.date_needed IS NULL OR public.job_offer_cutoff(j.date_needed, j.start_time)
 * @mutate src/hooks/useDashboardData.ts | return !jobDayHasEnded(jobLastDay(j) ?? j.date_needed, now.getTime()); | return !jobDayHasEnded(j.date_needed, now.getTime());
 * @mutate src/hooks/useDashboardFilters.ts |       const lastDay = jobLastDay(job); |       const lastDay = job.date_needed;
 * @mutate src/components/browseMap/mapJobToEnrichedJob.ts |     date_window_end: job.date_window_end ?? null, |     date_window_end: null,
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | hasDateWindow(j) ? jobDayLabel(j) : j.date_needed | j.date_needed
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { mapJobToEnrichedJob } from "@/components/browseMap/mapJobToEnrichedJob";
import type { MapJob } from "@/components/browseMap/config";

const REPO = resolve(__dirname, "..", "..");
const code = (f: string) => blankComments(readFileSync(resolve(REPO, f), "utf8"));

describe("Q2408: the map and the first-job Home keep a window job until its last day", () => {
  const defs = effectiveDefs("supabase/migrations");
  for (const fn of ["get_open_jobs_for_map", "get_ranked_open_jobs"]) {
    it(`${fn}: the newest definition filters on the window's last day and returns date_window_end`, () => {
      const def = defs.get(fn);
      expect(def, `${fn} has a definition`).toBeTruthy();
      const body = def!.stmt.replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
      expect(body).toMatch(/job_offer_cutoff\(COALESCE\(j\.date_window_end, j\.date_needed\), j\.start_time\) > now\(\)/);
      expect(body).not.toMatch(/job_offer_cutoff\(j\.date_needed, j\.start_time\) > now\(\)/);
      expect(body).toMatch(/RETURNS TABLE\([^)]*date_window_end date\)/);
    });
  }
});

describe("Q2408: the Browse list's client culls read the window's last day", () => {
  it("useDashboardData ends a window job with its last day", () => {
    expect(code("src/hooks/useDashboardData.ts")).toMatch(/return !jobDayHasEnded\(jobLastDay\(j\) \?\? j\.date_needed, now\.getTime\(\)\);/);
  });
  it("useDashboardFilters drops a job only once its last day has passed", () => {
    const src = code("src/hooks/useDashboardFilters.ts");
    expect(src).toMatch(/const lastDay = jobLastDay\(job\);\s*if \(lastDay && lastDay\.slice\(0, 10\) < todayLocalDate\) return false;/);
    expect(src).not.toMatch(/job\.date_needed\.slice\(0, 10\) < todayLocalDate/);
  });
});

describe("Q2408: the map popup and the first-job Home row print the window", () => {
  it("the map adapter carries date_window_end to the card", () => {
    const job = { id: "j", title: "t", category: "yard", budget: 50, is_urgent: false, latitude: 30, longitude: -92, parish: null, created_at: "2037-11-01T00:00:00Z", date_needed: "2037-11-04", date_window_end: "2037-11-10" } as unknown as MapJob;
    expect(mapJobToEnrichedJob(job).date_window_end).toBe("2037-11-10");
    expect(mapJobToEnrichedJob({ ...job, date_window_end: undefined } as MapJob).date_window_end).toBeNull();
  });
  it("FirstJobHome prints jobDayLabel for a window", () => {
    expect(code("src/pages/home/homeDashboard/FirstJobHome.tsx")).toMatch(/hasDateWindow\(j\) \? jobDayLabel\(j\) : j\.date_needed \? formatShortDate\(j\.date_needed\) : null/);
  });
});

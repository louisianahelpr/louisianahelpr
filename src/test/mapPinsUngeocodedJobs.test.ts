/**
 * Owner bug 2026-11-10: "Hang Christmas lights outside" (New Iberia 70560) saved with latitude/longitude NULL because
 * its street address did not geocode. get_open_jobs_for_map required coordinates and dropped it, and the browse
 * list's radius filter could not measure it, while get_ranked_open_jobs still listed it: the owner saw 3 of 4 jobs.
 *
 * Fixed at read time, never by writing a centroid into jobs.latitude/longitude (the arrival check,
 * mark_helper_arrival, trusts those and verifies outright when they are NULL):
 *   - the map pins such a job at its ZIP's centroid, else its parish's (20261110210539);
 *   - the browse radius measures it from its parish's centre (jobAreaPoint), with slack.
 * Executable proof: src/test/pglite/mapPinsUngeocodedJobs.pglite.mjs (ALL PASS 3x; NEW_MIGRATION=skip 4 FAILED).
 *
 * @mutate supabase/migrations/20261110210539_map_pins_ungeocoded_jobs.sql |     AND ((j.latitude IS NOT NULL AND j.longitude IS NOT NULL) OR (area.latitude IS NOT NULL AND area.longitude IS NOT NULL)) |     AND j.latitude IS NOT NULL AND j.longitude IS NOT NULL
 * @mutate supabase/migrations/20261110210539_map_pins_ungeocoded_jobs.sql |     ROUND(CASE WHEN j.latitude IS NOT NULL AND j.longitude IS NOT NULL THEN j.latitude ELSE area.latitude END, 2) AS latitude, |     ROUND(j.latitude, 2) AS latitude,
 * @mutate src/lib/jobAreaPoint.ts |   const area = getParishCentroid(job.parish) ?? getCentroidFromLocation(job.location); |   const area = null as { lat: number; lng: number } \| null;
 * @mutate src/hooks/useDashboardFilters.ts |         const jPoint = jobAreaPoint(job); |         const jPoint = typeof job.latitude === "number" && typeof job.longitude === "number" ? { lat: job.latitude, lng: job.longitude, approximate: false } : null;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { jobAreaPoint } from "@/lib/jobAreaPoint";

const MIG = join(process.cwd(), "supabase", "migrations");
const map = effectiveDefs(MIG).get("get_open_jobs_for_map");
const code = blankSqlComments(map?.stmt ?? "").replace(/\s+/g, " ");

describe("a job whose address never geocoded still shows on the map and in radius lists", () => {
  it("reads the newest map definition (floor)", () => {
    expect(map?.file).toBe("20261110210539_map_pins_ungeocoded_jobs.sql");
    expect(code.length).toBeGreaterThan(2000);
  });

  it("the map keeps a job with no coordinate pair when its ZIP or parish places it", () => {
    expect(code).not.toMatch(/AND j\.latitude IS NOT NULL AND j\.longitude IS NOT NULL AND/);
    expect(code).toContain("AND ((j.latitude IS NOT NULL AND j.longitude IS NOT NULL) OR (area.latitude IS NOT NULL AND area.longitude IS NOT NULL))");
    expect(code).toContain("LEFT JOIN LATERAL ( SELECT COALESCE(zc.latitude, pc.latitude) AS latitude, COALESCE(zc.longitude, pc.longitude) AS longitude FROM (SELECT z.latitude, z.longitude FROM public.louisiana_zip_parishes z");
    expect(code).toContain("WHERE j.latitude IS NULL OR j.longitude IS NULL ) area ON true");
  });

  it("the pin is the job's own pair when it has one, the area's otherwise, still at 2 decimals", () => {
    expect(code).toContain("ROUND(CASE WHEN j.latitude IS NOT NULL AND j.longitude IS NOT NULL THEN j.latitude ELSE area.latitude END, 2) AS latitude");
    expect(code).toContain("ROUND(CASE WHEN j.latitude IS NOT NULL AND j.longitude IS NOT NULL THEN j.longitude ELSE area.longitude END, 2) AS longitude");
  });

  it("jobAreaPoint: the job's pair, else its parish's centre (approximate), else null", () => {
    expect(jobAreaPoint({ latitude: 29.98, longitude: -91.95, parish: "Iberia" })).toEqual({ lat: 29.98, lng: -91.95, approximate: false });
    expect(jobAreaPoint({ latitude: "29.98", longitude: "-91.95" })).toEqual({ lat: 29.98, lng: -91.95, approximate: false });
    expect(jobAreaPoint({ latitude: null, longitude: null, parish: "Iberia" })).toMatchObject({ approximate: true, lat: 30.0085 });
    expect(jobAreaPoint({ latitude: 30.1, longitude: null, parish: "Iberia Parish" })).toMatchObject({ approximate: true });
    expect(jobAreaPoint({ latitude: null, longitude: null, location: "New Iberia, LA 70560" })).toMatchObject({ approximate: true, lat: 30.0085 });
    expect(jobAreaPoint({ latitude: null, longitude: null, parish: null, location: null })).toBeNull();
  });

  it("the browse radius filter measures through jobAreaPoint", () => {
    const hook = blankComments(readFileSync(join(process.cwd(), "src/hooks/useDashboardFilters.ts"), "utf8"));
    expect(hook).toContain("const jPoint = jobAreaPoint(job);");
    expect(hook).toMatch(/const limit = jPoint\.approximate \? nearbyMiles \+ APPROX_SLACK_MI : nearbyMiles;/);
  });
});

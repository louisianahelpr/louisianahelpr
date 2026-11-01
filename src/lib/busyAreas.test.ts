/**
 * Q2435 part A (owner-approved 2026-10-27): "Busy right now" shades parishes
 * by how many open jobs and deliveries wait there. Counts only, by parish,
 * from rows the page already reads; a place it cannot name is "elsewhere",
 * never guessed onto the map.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import {
  busyAreaLabel,
  busyAreas,
  busyCircleOpacity,
  busyCircleRadiusMeters,
  busyCirclesDimmed,
  parishForAreaLabel,
} from "./busyAreas";

// @mutate src/lib/busyAreas.ts |   for (const d of deliveries) add(parishForAreaLabel(d.pickup_area), "deliveries", Math.max(0, d.open_count ?? 1)); |
// @mutate src/lib/busyAreas.ts |     if (!parish \|\| !center) {\n      elsewhere += n;\n      return;\n    } |     if (!parish) {\n      elsewhere += n;\n      return;\n    }
// @mutate src/lib/busyAreas.ts |     .sort((a, b) => b.total - a.total \|\| a.parish.localeCompare(b.parish)); |
// @mutate src/lib/busyAreas.ts |   return Math.round(5000 + 15000 * Math.sqrt(Math.min(total, maxTotal) / maxTotal)); |   return 5000;
// @mutate src/components/BrowseMap.tsx |   useBusyAreaShading(mapRef, mapReady, visibleJobs); // Q2435 |
// @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       {busyRows.length > 0 && <BusyAreasCard deliveries={busyRows} />} |

const ROOT = resolve(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("busy areas (Q2435)", () => {
  it("counts jobs by parish and deliveries by the parish of their area, busiest first", () => {
    const s = busyAreas(
      [{ parish: "Lafayette" }, { parish: "Lafayette Parish" }, { parish: "Iberia" }, { parish: null }, { parish: "Nowhere" }],
      [{ pickup_area: "Broussard, LA" }, { pickup_area: "Downtown, Baton Rouge" }, { pickup_area: "Mid City" }, { pickup_area: null }],
    );
    expect(s.areas.map((a) => [a.parish, a.jobs, a.deliveries, a.total])).toEqual([
      ["Lafayette", 2, 1, 3],
      ["East Baton Rouge", 0, 1, 1],
      ["Iberia", 1, 0, 1],
    ]);
    // A null parish, an unknown parish, "Mid City" and a null area: counted, never mapped.
    expect(s.elsewhere).toBe(4);
    expect(s.areas.every((a) => Number.isFinite(a.center.lat) && Number.isFinite(a.center.lng))).toBe(true);
    expect(s.areas.length).toBeGreaterThan(2);
  });

  it("names an area label's parish from the end of the label", () => {
    expect(parishForAreaLabel("Downtown, Baton Rouge")).toBe("East Baton Rouge");
    expect(parishForAreaLabel("New Iberia, LA")).toBe("Iberia");
    expect(parishForAreaLabel("Vermilion Parish")).toBe("Vermilion");
    expect(parishForAreaLabel("Mid City")).toBeNull();
    // AUD31-10: two towns joined by "&" (a prod pickup area, 10-31) place by the last one the lookup knows.
    expect(parishForAreaLabel("New Iberia & Delcambre")).not.toBeNull();
    expect(parishForAreaLabel("")).toBeNull();
  });

  it("the busiest parish gets the biggest, darkest circle", () => {
    expect(busyCircleRadiusMeters(1, 4)).toBeLessThan(busyCircleRadiusMeters(4, 4));
    expect(busyCircleRadiusMeters(4, 4)).toBe(20000);
    expect(busyCircleRadiusMeters(0, 4)).toBe(0);
    expect(busyCircleOpacity(1, 4)).toBeLessThan(busyCircleOpacity(4, 4));
  });

  // @mutate src/lib/busyAreas.ts | latitudeDelta < BUSY_DIM_BELOW_LAT_DELTA; | latitudeDelta < 0;
  it("dims the circles only at street zoom (NIGHT-JOBSMA5-4)", () => {
    expect(busyCirclesDimmed(0.05)).toBe(true);
    expect(busyCirclesDimmed(0.5)).toBe(false);
    expect(busyCirclesDimmed(undefined)).toBe(false);
    expect(busyCirclesDimmed(0)).toBe(false);
  });

  it("labels say counts only, never an address", () => {
    expect(busyAreaLabel({ parish: "Lafayette", jobs: 2, deliveries: 1 })).toBe("Lafayette Parish: 2 jobs, 1 delivery");
    expect(busyAreaLabel({ parish: "Iberia", jobs: 1, deliveries: 0 })).toBe("Iberia Parish: 1 job");
  });

  it("is drawn on the Jobs Browse map and on the Deliver page", () => {
    expect(code("src/components/BrowseMap.tsx")).toContain("useBusyAreaShading(mapRef, mapReady, visibleJobs);");
    expect(code("src/components/browseMap/useMapLayersSync.ts")).toContain("drawBusyAreas(mk, map, busyAreas(jobs, []).areas, overlaysRef.current, dimmed)");
    expect(code("src/components/declutter/DeclutterDeliveryViews.tsx")).toContain("{busyRows.length > 0 && <BusyAreasCard deliveries={busyRows} />}");
  });
});

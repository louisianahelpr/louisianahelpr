/**
 * A DISTANCE OR ETA SHOWN TO A USER IS DERIVED FROM A REAL FIX, AND IS
 * BOUNDED BY SOMETHING PHYSICALLY POSSIBLE.
 *
 * ── THE REPORT ─────────────────────────────────────────────────────────────
 * Owner, 2026-09-19, with a screenshot of /dashboard: "im not sure about the
 * timer thing and the miles?? why is this showing here it hasnt before". The
 * browse cards read "27h 6m · 1634 mi", "29h 52m · 1813 mi",
 * "29h 28m · 1797 mi", "28h 23m · 1731 mi", for jobs in Shreveport, New
 * Iberia, Lafayette and Lake Charles. Shreveport to anywhere in Louisiana is
 * under 400 miles.
 *
 * ── WHAT WAS ACTUALLY WRONG, AND WHY NOTHING CAUGHT IT ─────────────────────
 * Not the maths. `profiles` on prod held 37.47282350893211 /
 * -122.2443517921565 for that account — Menlo Park, California — written the
 * same day by `persistUserLocation` from a `navigator.geolocation` SUCCESS. A
 * browser that can see no GPS, Wi-Fi or cell does not call the error
 * callback; it answers from the egress IP. `useUserLocation` never looked at
 * `coords.accuracy`, and nothing anywhere asked whether a Louisiana
 * marketplace could be showing a 27-hour commute.
 *
 * So two independent things were missing, and a check for either alone would
 * have let the other ship:
 *
 *   ORIGIN TRUST — a position is only a fix if the platform says it is
 *   precise AND it is somewhere a viewer of this app can be. Everything
 *   downstream inherits a bad origin silently, including the radius filter,
 *   applicant proximity, and get_neighbor_hire_count's sub-mile test.
 *
 *   OUTPUT BOUND — independent of where the origin came from, a number this
 *   app cannot possibly be right about must not reach the screen. This is the
 *   half that survives the next origin bug nobody has thought of yet.
 *
 * ── WHAT THIS GUARD DOES THAT THE UNIT TESTS DO NOT ────────────────────────
 * geo.trip.test.ts, useUserLocation.originTrust.test.tsx,
 * useDrivingTime.bound.test.tsx and JobCard.distance.test.tsx each prove ONE
 * surface behaves. None of them can notice a NEW surface. This file derives
 * the surface list from source — every module that turns a parish centroid
 * into a distance or an ETA — and fails when one of them is unbounded. Add a
 * third such surface tomorrow and this goes red until it is bounded too.
 *
 * ── WHAT IT DELIBERATELY DOES NOT COVER ────────────────────────────────────
 * `src/lib/arrivalGate.ts` formats a distance too ("about 2091 mi"), and it
 * is correctly UNBOUNDED: it explains a server-side refusal, where the
 * enormous number IS the message ("you are too far from the job to check
 * in"). Same for the en-route line in JobTracking.tsx, which measures a live
 * helper GPS position against the job's own coordinates — both ends are real
 * fixes, and prod on 2026-09-14 genuinely had a helper 2,099 mi out. That is
 * a different class and it is reported, not silently folded in here: this
 * inventory is centroid-derived BROWSE estimates, which is exactly the class
 * the owner reported.
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity). Each mutation restores the
// code exactly as it shipped on 2026-09-19, and none is satisfiable by a
// comment — the first two remove the miles bound at each of the two render
// boundaries, the third removes the ETA bound in the one hook both of them
// go through, and the fourth removes the service-area gate that kept the
// Menlo Park coordinate out.
// @mutate src/components/dashboard/JobCard.tsx | plausibleTripMiles( | (
// @mutate src/components/dashboard/JobDetailDialog.tsx | plausibleTripMiles(distMilesForDriving) | distMilesForDriving
// @mutate src/hooks/useDrivingTime.ts | return plausibleTripMinutes(minutes); | return minutes;
// @mutate src/hooks/useUserLocation.ts | !isWithinServiceArea(lat, lng) | false

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

const SRC = resolve(__dirname, "..");

/** Every source file in src/, tests excluded. DERIVED BY WALKING, not listed. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === "test" || entry === "__snapshots__") continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.test\.tsx?$/.test(entry)) continue;
      out.push(relative(SRC, full).split("\\").join("/"));
    }
  };
  walk(SRC);
  return out.sort();
}

const FILES = sourceFiles();
const text = new Map(FILES.map((f) => [f, readFileSync(join(SRC, f), "utf8")]));

/**
 * THE INVENTORY: modules that turn a PARISH CENTROID into a distance.
 *
 * Centroid-derived is the whole class. `open_jobs_browse` masks precise job
 * coordinates on purpose, so any browse-surface distance in this app is
 * necessarily measured to a centroid — and conversely, a module that measures
 * to a centroid is necessarily a browse-surface estimate rather than a
 * real-fix-to-real-fix measurement like the arrival gate's.
 */
const CENTROID_DISTANCE_SURFACES = FILES.filter(
  (f) =>
    /getParishCentroid|getCentroidFromLocation/.test(text.get(f)!) &&
    /haversineMiles\s*\(/.test(text.get(f)!) &&
    f !== "lib/parishCentroids.ts" &&
    f !== "lib/geo.ts",
);

/** Modules that render a drive-time estimate. */
const ETA_SURFACES = FILES.filter(
  (f) => /useDrivingTime\s*\(/.test(text.get(f)!) && f !== "hooks/useDrivingTime.ts",
);

describe("completeness — the inventory is real and non-empty", () => {
  it("found the whole source tree", () => {
    // A walk that returns nothing makes every per-member assertion below
    // vacuously true. 300 is well under the ~900 files present.
    expect(FILES.length).toBeGreaterThan(300);
  });

  it("found at least the two centroid-distance surfaces that exist", () => {
    // JobCard's browse meta pill and jobDetailDialog/useJobDetailData's Where
    // tile. Both were shipping the reported number.
    expect(CENTROID_DISTANCE_SURFACES.length).toBeGreaterThanOrEqual(2);
    expect(CENTROID_DISTANCE_SURFACES).toContain("components/dashboard/JobCard.tsx");
    expect(CENTROID_DISTANCE_SURFACES).toContain("components/dashboard/jobDetailDialog/useJobDetailData.ts");
  });

  it("found at least the two ETA surfaces that exist", () => {
    expect(ETA_SURFACES.length).toBeGreaterThanOrEqual(2);
  });
});

describe("every centroid-derived mileage is bounded before a renderer sees it", () => {
  /**
   * A surface satisfies this either by bounding in its own file, or — when it
   * is a hook that hands the number out — by having EVERY consumer of that
   * exported name bound it at the boundary. The second case is how
   * useJobDetailData is covered: it returns `distMilesForDriving` and
   * JobDetailDialog.tsx wraps it on the way into JobStatTiles.
   */
  it.each(CENTROID_DISTANCE_SURFACES)("%s", (file) => {
    const src = text.get(file)!;
    if (/plausibleTripMiles\s*\(/.test(src)) return;

    // Not bounded in-file. Find the identifier it assigns the haversine to,
    // and require every other module that mentions that identifier to bound
    // it — with at least one actually doing so.
    // `[^;]*?` is load-bearing: it stops the match from stepping over an
    // earlier completed declaration (the centroid lookup one line up) and
    // naming that as the thing the haversine was assigned to.
    const assigned = [...src.matchAll(/const\s+(\w+)\s*=[^;]*?haversineMiles\s*\(/g)].map((m) => m[1]);
    expect(assigned.length, `${file}: could not find what the haversine is assigned to`).toBeGreaterThan(0);

    for (const id of assigned) {
      const consumers = FILES.filter((f) => f !== file && new RegExp(`\\b${id}\\b`).test(text.get(f)!));
      expect(consumers.length, `${file}: ${id} is neither bounded here nor handed anywhere`).toBeGreaterThan(0);
      const bounded = consumers.filter((f) =>
        new RegExp(`plausibleTripMiles\\s*\\(\\s*${id}\\b`).test(text.get(f)!),
      );
      expect(
        bounded.length,
        `${file}: ${id} leaves this module unbounded and no consumer (${consumers.join(", ")}) applies plausibleTripMiles`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("the ETA funnel bounds every value it can return", () => {
  const hook = readFileSync(join(SRC, "hooks/useDrivingTime.ts"), "utf8");

  it("every setMinutes goes through the bound", () => {
    const calls = [...hook.matchAll(/setMinutes\s*\(([^;]*)\)/g)].map((m) => m[1]);
    // Floor: the hook had four such assignments when this was written (the
    // lazy initialiser is separate and checked below).
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const arg of calls) {
      // `setMinutes(null)` is the "nothing to estimate" case and needs no bound.
      if (/^\s*null\s*$/.test(arg)) continue;
      expect(arg, `unbounded setMinutes(${arg.trim()})`).toMatch(/boundedMinutes\s*\(/);
    }
  });

  it("the first painted frame is bounded too, not only the effect", () => {
    const init = hook.match(/useState<number \| null>\(([\s\S]*?)\n\s*\);/);
    expect(init, "could not find the lazy initial state").not.toBeNull();
    expect(init![1]).toMatch(/boundedMinutes\s*\(/);
  });

  it("the bound itself checks BOTH axes", () => {
    const fn = hook.match(/function boundedMinutes[\s\S]*?\n}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/plausibleTripMiles\s*\(/);
    expect(fn![0]).toMatch(/plausibleTripMinutes\s*\(/);
  });
});

describe("the origin is gated before anything downstream can inherit it", () => {
  const hook = readFileSync(join(SRC, "hooks/useUserLocation.ts"), "utf8");

  it("a geolocation success is checked for accuracy AND service area", () => {
    const onSuccess = hook.match(/const onSuccess = [\s\S]*?\n {4}};/);
    expect(onSuccess, "could not find onSuccess").not.toBeNull();
    expect(onSuccess![0]).toMatch(/isPreciseFixAccuracy\s*\(/);
    expect(onSuccess![0]).toMatch(/isWithinServiceArea\s*\(/);
    // The gates must come BEFORE the cache write and the profile write —
    // gating after them is the same bug with extra steps.
    const cacheAt = onSuccess![0].indexOf("cached = {");
    const persistAt = onSuccess![0].indexOf("persistUserLocation(");
    expect(onSuccess![0].indexOf("isWithinServiceArea")).toBeLessThan(cacheAt);
    expect(onSuccess![0].indexOf("isPreciseFixAccuracy")).toBeLessThan(cacheAt);
    expect(cacheAt).toBeLessThan(persistAt);
  });

  it("a coordinate already stored on the profile is gated on the way back out", () => {
    // The row was written before the gate existed, so the read side cannot
    // assume the write side was ever in force.
    const derive = hook.match(/async function deriveFallbackLocation[\s\S]*?\n}/);
    expect(derive).not.toBeNull();
    expect(derive![0]).toMatch(/isWithinServiceArea\s*\(\s*lat\s*,\s*lng\s*\)/);
  });
});

describe("end to end — the owner's own card, with the owner's own origin", () => {
  it("renders no distance and no drive time", async () => {
    const { default: JobCard } = await import("@/components/dashboard/JobCard");
    render(
      <JobCard
        job={
          {
            id: "j1",
            title: "Touch up the hallway paint",
            description: "d",
            category: "handyman",
            budget: 120,
            location: "Shreveport, LA",
            parish: "Caddo",
            date_needed: "2026-09-25",
            start_time: null,
            created_at: new Date("2026-09-19T12:00:00Z").toISOString(),
            expires_at: new Date("2026-10-03T12:00:00Z").toISOString(),
            customer_id: "c1",
            is_urgent: false,
            urgent_fee: 0,
            is_group_job: false,
            helpers_needed: 1,
            is_recurring: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any
        }
        effectiveFee={0.15}
        onApply={vi.fn()}
        onReport={vi.fn()}
        onSelect={vi.fn()}
        userLat={37.47282350893211}
        userLng={-122.2443517921565}
      />,
    );
    expect(screen.queryByText(/1634/)).toBeNull();
    expect(screen.queryByText(/\d+h\s*\d+m/)).toBeNull();
    expect(screen.queryByRole("img", { name: /away/i })).toBeNull();
  });
});

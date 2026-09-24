/**
 * A TRUE POSITION IS NEVER DISCARDED, AND A DISTANCE IS ONLY DRESSED AS A
 * COMMUTE WHEN IT IS ONE.
 *
 * ── THE REPORT ─────────────────────────────────────────────────────────────
 * Owner, 2026-09-19, with a screenshot of /home: "im not sure about the
 * timer thing and the miles?? why is this showing here it hasnt before". The
 * browse cards read "27h 6m · 1634 mi", "29h 52m · 1813 mi",
 * "29h 28m · 1797 mi", "28h 23m · 1731 mi", for jobs in Shreveport, New
 * Iberia, Lafayette and Lake Charles.
 *
 * ── THE FIRST DIAGNOSIS WAS WRONG, AND THIS FILE ENCODED IT ────────────────
 * fecdbf6e7 concluded the ORIGIN was bad. `profiles` held 37.47282350893211 /
 * -122.2443517921565 — Menlo Park, California — beside ZIP 70528 (Erath, LA),
 * captured that same day. That is the exact signature of a browser answering
 * the geolocation SUCCESS callback from its egress IP, so a service-area gate
 * (Louisiana + 2°) was added and any fix outside it was thrown away in favour
 * of the signup ZIP's parish centroid. The version of this file that shipped
 * that day asserted, as a guard, that an out-of-state origin MUST be refused.
 *
 * THE OWNER WAS IN MENLO PARK. "Yes I'm in Menlo Park rn."
 *
 * The coordinate was a correct fix from a user who had travelled. 1,634 miles
 * was the truth. And the gate built on the misreading was worse than the thing
 * it replaced: it discarded a real position and substituted Erath, Louisiana —
 * so a user standing in California would have been told they were a few miles
 * from a New Iberia job, and that invented origin would have been fed to
 * server-side radius search, applicant proximity and get_neighbor_hire_count,
 * not merely to a pill.
 *
 * ── WHAT THAT TAUGHT, AND WHAT THIS FILE NOW GUARDS ────────────────────────
 * Three things, and the assertions below are one per lesson:
 *
 *   1. GEOGRAPHY IS NOT EVIDENCE ABOUT A FIX. A latitude cannot distinguish a
 *      travelling helpr from an IP guess, so a threshold on it has no correct
 *      value. There is no test here that a position is "somewhere plausible",
 *      and there is an assertion that nobody reintroduces one.
 *   2. A GATE IS ONLY AS GOOD AS WHAT FAILING IT COSTS. Accuracy IS a real
 *      signal — the platform reporting its own confidence — but it now demotes
 *      rather than discards: a coarse fix is kept and used, flagged
 *      `approximate`, and only kept out of the precise-fix columns whose
 *      sub-mile neighbour test would break on it.
 *   3. THE COMPLAINT WAS "WHY IS THIS SHOWING HERE", NOT "THIS IS WRONG". The
 *      defect was presentation. A 27-hour drive is not a commute, so the
 *      commute pill declines to describe it — because of the TRIP, never
 *      because of the viewer. The number itself survives where a user has
 *      actually asked for it.
 *
 * ── WHAT THIS GUARD DOES THAT THE UNIT TESTS DO NOT ────────────────────────
 * geo.trip.test.ts, useUserLocation.originTrust.test.tsx,
 * useDrivingTime.bound.test.tsx and JobCard.distance.test.tsx each prove ONE
 * surface behaves. None can notice a NEW surface, and none can notice the
 * wrong belief coming back. This file derives the surface list from source and
 * fails when a new drive-time producer appears outside the one funnel, or when
 * a geography gate reappears anywhere in src/.
 *
 * ── WHAT IT DELIBERATELY DOES NOT COVER ────────────────────────────────────
 * `src/lib/arrivalGate.ts` formats a distance too ("about 2091 mi"), and it is
 * correctly unfiltered: it explains a server-side refusal, where the enormous
 * number IS the message. Same for JobTracking.tsx's en-route line. Different
 * class, reported separately.
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity). Each mutation restores a
// specific piece of the WRONG fix, or removes a piece of the corrected one,
// and none is satisfiable by a comment.
//   1 — the browse pill stops distinguishing a commute from a 1,634 mi trip.
//   2 — the ETA funnel stops declining a drive nobody drives.
//   3 — a real fix is routed to the failure path again (the original defect).
//   4 — a coarse fix is written to the precise-fix columns again.
//   5 — the detail sheet stops stating the true distance.
// @mutate src/components/dashboard/JobCard.tsx | isCommutableDistance(rawTripMiles) | true
// @mutate src/hooks/useDrivingTime.ts | if (!isCommutableDistance(miles)) return null; | if (false) return null;
// @mutate src/hooks/useUserLocation.ts | setState({ status: "ready", lat, lng, source: "device", approximate: !precise }); | failWith("Couldn't get your location");
// @mutate src/hooks/useUserLocation.ts | if (precise) void persistUserLocation(lat, lng); | void persistUserLocation(lat, lng);
// @mutate src/components/dashboard/JobDetailDialog.tsx | distMilesForDriving={distMilesForDriving} | distMilesForDriving={null}

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { COMMUTE_RANGE_MILES } from "@/lib/geo";
import JobCard from "@/components/dashboard/JobCard";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

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
 * Comments stripped. Load-bearing for the "no geography gate" assertion below:
 * the corrected source deliberately NAMES the deleted gate in prose, in three
 * files, so that the next reader learns why it is gone. A raw substring search
 * would read those explanations as the defect they warn about.
 */
function code(file: string): string {
  return text
    .get(file)!
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}
const CODE = new Map(FILES.map((f) => [f, code(f)]));

/**
 * THE INVENTORY: modules that turn a PARISH CENTROID into a distance.
 *
 * `open_jobs_browse` masks precise job coordinates on purpose, so any browse
 * distance in this app is necessarily measured to a centroid — and conversely,
 * a module measuring to a centroid is necessarily a browse estimate rather
 * than a real-fix-to-real-fix measurement like the arrival gate's.
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
    expect(CENTROID_DISTANCE_SURFACES.length).toBeGreaterThanOrEqual(2);
    expect(CENTROID_DISTANCE_SURFACES).toContain("components/dashboard/JobCard.tsx");
    expect(CENTROID_DISTANCE_SURFACES).toContain(
      "components/dashboard/jobDetailDialog/useJobDetailData.ts",
    );
  });

  it("found at least the two ETA surfaces that exist", () => {
    expect(ETA_SURFACES.length).toBeGreaterThanOrEqual(2);
  });

  it("comment-stripping did not empty the files it is applied to", () => {
    // CODE is the oracle for the geography assertion below; if stripping ate
    // everything, that assertion would pass on a codebase full of gates.
    for (const f of ["lib/geo.ts", "hooks/useUserLocation.ts", "hooks/useDrivingTime.ts"]) {
      expect(CODE.get(f)!.length, f).toBeGreaterThan(200);
      expect(CODE.get(f)!, f).toMatch(/export/);
    }
  });
});

describe("lesson 1 — geography is never used to decide whether a fix is real", () => {
  it("no module in src/ gates a position on where on earth it is", () => {
    // The wrong fix. Named here so that reintroducing it — under this name or
    // by defining a bounding box of "where our users may be" — goes red rather
    // than quietly shipping a second time.
    const offenders = FILES.filter((f) =>
      /\bisWithinServiceArea\b|\bSERVICE_AREA_BOUNDS\b/.test(CODE.get(f)!),
    );
    expect(
      offenders,
      "a service-area gate is back. The owner was genuinely in Menlo Park; " +
        "out-of-state is not evidence of a bad fix.",
    ).toEqual([]);
  });

  it("the stored profile coordinate is accepted on nothing but being a number", () => {
    const hook = CODE.get("hooks/useUserLocation.ts")!;
    const derive = hook.match(/async function deriveFallbackLocation[\s\S]*?\n}/);
    expect(derive, "could not find deriveFallbackLocation").not.toBeNull();
    // Pinned exactly: any EXTRA condition on the stored coordinate — a
    // bounding box, a distance-from-ZIP sanity test, anything that second-
    // guesses the row's geography — breaks this match.
    expect(
      derive![0],
      "the stored coordinate is being judged by something other than being a number",
    ).toMatch(
      /if \(Number\.isFinite\(lat\) && Number\.isFinite\(lng\)\) \{\s*return \{ lat, lng, source: "profile", approximate: false \};/,
    );
  });
});

describe("lesson 2 — a fix we received is a fix we keep", () => {
  const hook = CODE.get("hooks/useUserLocation.ts")!;
  const onSuccess = hook.match(/const onSuccess = [\s\S]*?\n {4}};/);

  it("found onSuccess", () => {
    expect(onSuccess).not.toBeNull();
  });

  it("never routes a position it RECEIVED to the failure path", () => {
    // `failWith` derives a ZIP centroid — a different place on the map. It is
    // the right answer when no position arrived, and the wrong answer for
    // every position that did, however coarse or however distant. This is the
    // assertion the original fix would have failed.
    expect(
      onSuccess![0],
      "onSuccess discards a real fix again — that is the Menlo Park defect",
    ).not.toMatch(/failWith/);
  });

  it("caches and surfaces the position unconditionally", () => {
    const body = onSuccess![0];
    const cacheAt = body.indexOf("cached = {");
    const stateAt = body.indexOf("setState(");
    expect(cacheAt).toBeGreaterThan(-1);
    expect(stateAt).toBeGreaterThan(-1);
    // No `if` may stand between entering onSuccess and storing the position.
    // (`precise` is computed first; it decides a FLAG and the profile write.)
    const beforeCache = body.slice(body.indexOf("=> {"), cacheAt);
    expect(beforeCache, "a branch now guards the cache write").not.toMatch(/\bif\s*\(/);
    expect(beforeCache, "a branch now guards the cache write").not.toMatch(/\breturn\b/);
  });

  it("carries the platform's own confidence forward instead of throwing it away", () => {
    expect(onSuccess![0]).toMatch(/isPreciseFixAccuracy\s*\(/);
    expect(onSuccess![0]).toMatch(/approximate:\s*!precise/);
  });

  it("gates only the PRECISE-FIX COLUMNS on precision", () => {
    // persistUserLocation.ts: "A PRECISE DEVICE FIX, and nothing else", and
    // get_neighbor_hire_count runs a sub-mile test on those columns. A coarse
    // fix may be used for this session; it may not be made permanent there.
    expect(onSuccess![0]).toMatch(/if \(precise\) void persistUserLocation\(/);
  });
});

describe("lesson 3 — a drive time is only offered for a drive", () => {
  const hook = CODE.get("hooks/useDrivingTime.ts")!;

  it("useDrivingTime is the ONLY module that produces drive-time minutes", () => {
    // The funnel argument only holds while it is the single producer. A new
    // surface hand-rolling minutes-per-mile, or calling MapKit Directions
    // itself, would reintroduce the class the owner reported.
    const producers = FILES.filter(
      (f) => /expectedTravelTime|mapkit\.Directions|new .*Directions\(/.test(CODE.get(f)!),
    );
    expect(producers).toEqual(["hooks/useDrivingTime.ts"]);
  });

  it("every ETA surface goes through that funnel", () => {
    for (const f of ETA_SURFACES) {
      expect(CODE.get(f)!, f).toMatch(/useDrivingTime\s*\(/);
    }
  });

  it("every setMinutes goes through the commute rule", () => {
    const calls = [...hook.matchAll(/setMinutes\s*\(([^;]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const arg of calls) {
      if (/^\s*null\s*$/.test(arg)) continue;
      expect(arg, `ungated setMinutes(${arg.trim()})`).toMatch(/commuteEstimate\s*\(/);
    }
  });

  it("the first painted frame is gated too, not only the effect", () => {
    const init = hook.match(/useState<number \| null>\(([\s\S]*?)\n\s*\);/);
    expect(init, "could not find the lazy initial state").not.toBeNull();
    expect(init![1]).toMatch(/commuteEstimate\s*\(/);
  });

  it("the rule itself checks BOTH axes", () => {
    const fn = hook.match(/function commuteEstimate[\s\S]*?\n}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/isCommutableDistance\s*\(/);
    expect(fn![0]).toMatch(/commuteMinutes\s*\(/);
  });

  it("BEHAVIOURALLY declines the owner's trip and keeps a real one", async () => {
    const { useDrivingTime } = await import("@/hooks/useDrivingTime");
    const MENLO = { lat: 37.47282350893211, lng: -122.2443517921565 };
    const SHREVEPORT = { lat: 32.5252, lng: -93.7502 };

    const far = renderHook(() =>
      useDrivingTime(MENLO.lat, MENLO.lng, SHREVEPORT.lat, SHREVEPORT.lng, 1633.74),
    );
    await waitFor(() => expect(far.result.current).toBeNull());

    // …and the gate is about the TRIP, not the viewer: the same Californian
    // origin, measured against a destination inside commuting range, still
    // gets an estimate. Nothing about this user is distrusted.
    const near = renderHook(() =>
      useDrivingTime(MENLO.lat, MENLO.lng, SHREVEPORT.lat, SHREVEPORT.lng, 42),
    );
    await waitFor(() => expect(near.result.current).toBeGreaterThan(0));
    expect(near.result.current).toBeLessThanOrEqual(720);
  });
});

describe("the detail sheet still states the true distance", () => {
  it("passes the unsuppressed mileage into the Where tile", () => {
    // The browse card is a scan row and drops the pill; the detail sheet is
    // where the user asked about THIS job, so it answers. Hiding the number
    // here was the wrong half of the original fix.
    const dlg = CODE.get("components/dashboard/JobDetailDialog.tsx")!;
    expect(dlg).toMatch(/distMilesForDriving=\{distMilesForDriving\}/);
    // and no wrapper is reintroduced around it
    expect(dlg).not.toMatch(/distMilesForDriving=\{\w+\(/);
  });
});

describe("end to end — the owner's own card, with the owner's own origin", () => {
  const OWNER = { lat: 37.47282350893211, lng: -122.2443517921565 };
  const BATON_ROUGE = { lat: 30.4515, lng: -91.1871 };

  it("the 1,634 mi commute pill is gone from the browse card", () => {
    render(<OwnerCard userLat={OWNER.lat} userLng={OWNER.lng} />);
    expect(screen.queryByText(/1634|1,634/)).toBeNull();
    expect(screen.queryByText(/\d+h\s*\d+m/)).toBeNull();
    expect(screen.queryByRole("img", { name: /away/i })).toBeNull();
  });

  it("and the card still renders the pill for a trip that IS a commute", () => {
    // Proves the absence above is the commute rule firing, not the pill being
    // broken — and pins the mutation that removes the rule, which would put
    // "~1634 mi" back on the first card.
    render(<OwnerCard userLat={BATON_ROUGE.lat} userLng={BATON_ROUGE.lng} />);
    expect(screen.queryByRole("img", { name: /away/i })).not.toBeNull();
  });

  it("the threshold is the commute range, applied to the trip", () => {
    expect(COMMUTE_RANGE_MILES).toBe(500);
  });
});

/** The owner's own Shreveport card, with a varying viewer origin. */
function OwnerCard({ userLat, userLng }: { userLat: number; userLng: number }) {
  return (
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
          date_needed: jobLocalDateISO(5),
          start_time: null,
          created_at: new Date("2026-09-19T12:00:00Z").toISOString(),
          expires_at: new Date("2026-10-03T12:00:00Z").toISOString(),
          customer_id: "c1",
          is_urgent: false,
          urgent_fee: 0,
          is_group_job: false,
          helpers_needed: 1,
          is_recurring: false,
           
        } as any
      }
      effectiveFee={0.15}
      onApply={vi.fn()}
      onReport={vi.fn()}
      onSelect={vi.fn()}
      userLat={userLat}
      userLng={userLng}
    />
  );
}

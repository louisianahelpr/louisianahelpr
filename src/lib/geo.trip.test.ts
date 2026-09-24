/**
 * THE OWNER'S NUMBERS WERE TRUE. THIS FILE SAYS SO, AND SAYS WHAT WE DO ABOUT
 * IT INSTEAD.
 *
 * Reported 2026-09-19 with a screenshot of /home: four browse cards
 * reading "27h 6m · 1634 mi", "29h 52m · 1813 mi", "29h 28m · 1797 mi",
 * "28h 23m · 1731 mi" for jobs in Shreveport, New Iberia, Lafayette and Lake
 * Charles — "why is this showing here it hasnt before".
 *
 * ── THE CORRECTION ─────────────────────────────────────────────────────────
 * The first version of this file asserted that the stored origin was POISONED
 * — an IP guess that a service-area gate must refuse. It was not. The owner
 * confirmed: "Yes I'm in Menlo Park rn." The coordinate on the profile row is
 * a correct fix from a user who had travelled, and every one of those four
 * figures is accurate to the mile.
 *
 * So the assertions that an out-of-state origin must be refused are gone, and
 * what replaces them is the lesson: geography is not evidence about a fix, and
 * a gate that discards a true position is worse than the pill it was meant to
 * fix — the substitute origin (the signup ZIP's parish centroid, Erath LA)
 * would have told a user in California they were a few miles from a New Iberia
 * job, and fed that to radius search and to get_neighbor_hire_count.
 *
 * What survives is a claim about the TRIP, never about the viewer: a 27-hour
 * drive is not a commute, so the commute pill does not describe it.
 */
import { describe, it, expect } from "vitest";
import {
  haversineMiles,
  isPreciseFixAccuracy,
  isCommutableDistance,
  tripMiles,
  commuteMinutes,
  COMMUTE_RANGE_MILES,
  MAX_COMMUTE_MINUTES,
  MAX_TRUSTED_FIX_ACCURACY_M,
} from "./geo";
import { PARISH_CENTROIDS, getParishCentroid } from "./parishCentroids";

/**
 * VERBATIM from `profiles` on prod fncmgoasalhdgfwzhsqa for
 * lexilombas05@gmail.com, re-read 2026-09-19 22:44 UTC:
 *   latitude  37.47282350893211
 *   longitude -122.2443517921565
 *   location_captured_at 2026-09-19 21:00:08.752+00
 *   zip_code  70528  (Erath, Louisiana)      parish Vermilion
 *
 * Menlo Park, California — and CORRECT. The owner was there. This row must not
 * be cleared, and nothing in the app may treat it as suspect.
 */
const TRAVELLING_ORIGIN = { lat: 37.47282350893211, lng: -122.2443517921565 };

/** What the four cards on the owner's screen said, in her reading order. */
const REPORTED = [
  { parish: "Caddo", city: "Shreveport", miles: 1634 },
  { parish: "Iberia", city: "New Iberia", miles: 1813 },
  { parish: "Lafayette", city: "Lafayette", miles: 1797 },
  { parish: "Calcasieu", city: "Lake Charles", miles: 1731 },
];

describe("the reported numbers are reproduced exactly — and they are RIGHT", () => {
  it("haversine from the stored origin returns each figure the owner saw", () => {
    expect(REPORTED.length).toBe(4);
    for (const { parish, miles } of REPORTED) {
      const c = getParishCentroid(parish);
      expect(c, `${parish} must be in the centroid table`).not.toBeNull();
      const d = haversineMiles(TRAVELLING_ORIGIN.lat, TRAVELLING_ORIGIN.lng, c!.lat, c!.lng);
      // Rounded the way JobCard renders anything over 10 miles.
      expect(Math.round(d)).toBe(miles);
    }
  });

  it("the distances stay available as numbers — nothing here calls them false", () => {
    // `tripMiles` is the only filter the raw figure passes through, and it
    // rejects nothing but non-numbers. This is what lets the job DETAIL sheet
    // state "~1634 mi" while the browse card declines to call it a commute.
    for (const { parish, miles } of REPORTED) {
      const c = getParishCentroid(parish)!;
      const d = haversineMiles(TRAVELLING_ORIGIN.lat, TRAVELLING_ORIGIN.lng, c.lat, c.lng);
      expect(tripMiles(d), parish).not.toBeNull();
      expect(Math.round(tripMiles(d)!)).toBe(miles);
    }
  });

  it("every in-state trip is a commute, so no real feed loses a pill", () => {
    const batonRouge = getParishCentroid("East Baton Rouge")!;
    for (const { parish } of REPORTED) {
      const c = getParishCentroid(parish)!;
      const d = haversineMiles(batonRouge.lat, batonRouge.lng, c.lat, c.lng);
      expect(isCommutableDistance(d), parish).toBe(true);
    }
  });
});

describe("isPreciseFixAccuracy — a real signal, with a now-cheap false negative", () => {
  it("accepts a radio-derived fix", () => {
    for (const m of [5, 65, 800, 3000, MAX_TRUSTED_FIX_ACCURACY_M]) {
      expect(isPreciseFixAccuracy(m), `${m}m`).toBe(true);
    }
  });

  it("calls the tens-of-kilometres answer an IP fallback gives IMPRECISE", () => {
    // "Imprecise" is now all this says. The coordinates are still kept, still
    // used and still shown; they are flagged approximate and kept out of
    // profiles.latitude/longitude, whose sub-mile neighbour test would break
    // on them. Nothing is discarded on this verdict any more.
    for (const m of [MAX_TRUSTED_FIX_ACCURACY_M + 1, 45_000, 150_000, 1_000_000]) {
      expect(isPreciseFixAccuracy(m), `${m}m`).toBe(false);
    }
  });

  it("treats a platform that reports no accuracy as precise, not suspect", () => {
    // A terse native shim is not evidence of a bad fix, and there is no longer
    // a second gate behind this one to catch what it lets through.
    expect(isPreciseFixAccuracy(undefined)).toBe(true);
    expect(isPreciseFixAccuracy(null)).toBe(true);
    expect(isPreciseFixAccuracy(NaN)).toBe(true);
  });
});

describe("tripMiles — rejects non-numbers and NOTHING ELSE", () => {
  it("keeps every figure the owner was shown", () => {
    // The assertion this replaces said the opposite, and it was wrong.
    for (const { miles, city } of REPORTED) {
      expect(tripMiles(miles), city).toBe(miles);
    }
  });

  it("keeps a distance from anywhere on earth", () => {
    expect(tripMiles(5000)).toBe(5000);
    expect(tripMiles(12_450)).toBe(12_450);
  });

  it("keeps a zero-mile trip, which is a real answer", () => {
    expect(tripMiles(0)).toBe(0);
  });

  it("refuses what is not a number", () => {
    expect(tripMiles(null)).toBeNull();
    expect(tripMiles(undefined)).toBeNull();
    expect(tripMiles(NaN)).toBeNull();
    expect(tripMiles(Infinity)).toBeNull();
    expect(tripMiles(-3)).toBeNull();
  });
});

describe("isCommutableDistance — a claim about the trip, not the viewer", () => {
  it("declines to call the owner's four trips commutes", () => {
    for (const { miles, city } of REPORTED) {
      expect(isCommutableDistance(miles), city).toBe(false);
    }
  });

  it("still covers the longest trip this app can legitimately describe", () => {
    // Caddo ↔ Plaquemines, the widest pair of parish centroids in the table
    // (329.4 mi measured), is the longest journey the pill is CAPABLE of
    // describing — both its ends are centroids.
    const caddo = getParishCentroid("Caddo")!;
    const plaquemines = getParishCentroid("Plaquemines")!;
    const widest = haversineMiles(caddo.lat, caddo.lng, plaquemines.lat, plaquemines.lng);
    expect(widest).toBeGreaterThan(300);
    expect(isCommutableDistance(widest)).toBe(true);

    // And the widest pair of ALL parish centroids, derived rather than named,
    // so a future addition to the table cannot quietly exceed the range.
    const cs = Object.values(PARISH_CENTROIDS);
    expect(cs.length).toBeGreaterThan(60);
    let max = 0;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        max = Math.max(max, haversineMiles(cs[i].lat, cs[i].lng, cs[j].lat, cs[j].lng));
      }
    }
    expect(max).toBeLessThan(COMMUTE_RANGE_MILES);
  });

  it("keeps a near-border viewer whole", () => {
    // Houston, Jackson MS, Mobile, Little Rock to the nearest parish centroid
    // — the people the old service-area gate was widened to spare, who now
    // need no sparing because nothing tests where they are.
    const cs = Object.values(PARISH_CENTROIDS);
    for (const [name, lat, lng] of [
      ["Houston", 29.7604, -95.3698],
      ["Jackson MS", 32.2988, -90.1848],
      ["Mobile", 30.6954, -88.0399],
      ["Little Rock", 34.7465, -92.2896],
    ] as const) {
      const nearest = Math.min(...cs.map((c) => haversineMiles(lat, lng, c.lat, c.lng)));
      expect(isCommutableDistance(nearest), name).toBe(true);
    }
  });

  it("passes a value at the range and declines the one past it", () => {
    expect(isCommutableDistance(COMMUTE_RANGE_MILES)).toBe(true);
    expect(isCommutableDistance(COMMUTE_RANGE_MILES + 0.001)).toBe(false);
  });

  it("is false for a distance we do not have", () => {
    expect(isCommutableDistance(null)).toBe(false);
    expect(isCommutableDistance(undefined)).toBe(false);
    expect(isCommutableDistance(NaN)).toBe(false);
  });
});

describe("commuteMinutes — conditioned on a distance that is already a commute", () => {
  it("refuses the 27h 6m the owner was shown, and its three siblings", () => {
    // Belt and braces: useDrivingTime already refuses to estimate these at all
    // because the distance is not commutable. This is the second axis, for a
    // route that contradicts its own straight line.
    for (const m of [27 * 60 + 6, 29 * 60 + 52, 29 * 60 + 28, 28 * 60 + 23]) {
      expect(commuteMinutes(m)).toBeNull();
    }
  });

  it("still shows a long but real Louisiana drive", () => {
    // Shreveport → New Orleans is about 5h30m by road.
    expect(commuteMinutes(330)).toBe(330);
    // And a pessimistic estimate for the widest in-range trip.
    expect(commuteMinutes(Math.round(COMMUTE_RANGE_MILES * 1.3))).not.toBeNull();
  });

  it("passes a value at the bound and refuses the one past it", () => {
    expect(commuteMinutes(MAX_COMMUTE_MINUTES)).toBe(MAX_COMMUTE_MINUTES);
    expect(commuteMinutes(MAX_COMMUTE_MINUTES + 1)).toBeNull();
  });
});

// Proof this guard can fail: the pill is a claim about the TRIP. Drop the range
// test and the owner's 1,634-mile Shreveport card is called a commute again,
// which is the report this whole file was written from.
// @mutate src/lib/geo.ts | return m != null && m <= COMMUTE_RANGE_MILES; | return m != null;

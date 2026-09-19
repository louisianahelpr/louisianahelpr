/**
 * THE OWNER'S NUMBERS, AND THE TWO RULES THAT NOW REFUSE THEM.
 *
 * Reported 2026-09-19 with a screenshot of /dashboard: four browse cards
 * reading "27h 6m · 1634 mi", "29h 52m · 1813 mi", "29h 28m · 1797 mi",
 * "28h 23m · 1731 mi" for jobs in Shreveport, New Iberia, Lafayette and Lake
 * Charles. The owner is in Louisiana; Shreveport to anywhere in Louisiana is
 * under 400 miles.
 *
 * The maths was never wrong, and this file proves it: `haversineMiles` from
 * the coordinate that was actually on the account's profile row in prod
 * reproduces all four figures to the mile. What was wrong was that the app
 * believed that coordinate, and that nothing between it and the pixels asked
 * whether the answer was possible.
 */
import { describe, it, expect } from "vitest";
import {
  haversineMiles,
  isWithinServiceArea,
  isPreciseFixAccuracy,
  plausibleTripMiles,
  plausibleTripMinutes,
  MAX_PLAUSIBLE_TRIP_MILES,
  MAX_PLAUSIBLE_TRIP_MINUTES,
  MAX_TRUSTED_FIX_ACCURACY_M,
} from "./geo";
import { PARISH_CENTROIDS, getParishCentroid } from "./parishCentroids";

/**
 * VERBATIM from `profiles` on prod fncmgoasalhdgfwzhsqa for
 * lexilombas05@gmail.com, read 2026-09-19:
 *   latitude  37.47282350893211
 *   longitude -122.2443517921565
 *   location_captured_at 2026-09-19 21:00:08+00
 *   zip_code  70528  (Erath, Louisiana)      parish Vermilion
 * Menlo Park, California. Written THAT DAY by persistUserLocation, from a
 * `navigator.geolocation` success that was an IP-address guess.
 */
const POISONED_ORIGIN = { lat: 37.47282350893211, lng: -122.2443517921565 };

/** What the four cards on the owner's screen said, in her reading order. */
const REPORTED = [
  { parish: "Caddo", city: "Shreveport", miles: 1634 },
  { parish: "Iberia", city: "New Iberia", miles: 1813 },
  { parish: "Lafayette", city: "Lafayette", miles: 1797 },
  { parish: "Calcasieu", city: "Lake Charles", miles: 1731 },
];

describe("the reported numbers are reproduced exactly", () => {
  it("haversine from the stored origin returns each figure the owner saw", () => {
    expect(REPORTED.length).toBe(4);
    for (const { parish, miles } of REPORTED) {
      const c = getParishCentroid(parish);
      expect(c, `${parish} must be in the centroid table`).not.toBeNull();
      const d = haversineMiles(POISONED_ORIGIN.lat, POISONED_ORIGIN.lng, c!.lat, c!.lng);
      // Rounded the way JobCard renders anything over 10 miles.
      expect(Math.round(d)).toBe(miles);
    }
  });

  it("the origin, not the maths, is what was wrong — every job row is in range of every other", () => {
    // Same destinations, an origin inside the state: all four land inside the
    // bound. So no bound could have been "too tight" for the real feed.
    const batonRouge = getParishCentroid("East Baton Rouge")!;
    for (const { parish } of REPORTED) {
      const c = getParishCentroid(parish)!;
      const d = haversineMiles(batonRouge.lat, batonRouge.lng, c.lat, c.lng);
      expect(plausibleTripMiles(d)).not.toBeNull();
    }
  });
});

describe("isWithinServiceArea", () => {
  it("rejects the coordinate the app actually stored", () => {
    expect(isWithinServiceArea(POISONED_ORIGIN.lat, POISONED_ORIGIN.lng)).toBe(false);
  });

  it("accepts every parish centroid this app can send a helpr to", () => {
    const entries = Object.entries(PARISH_CENTROIDS);
    // INVENTORY FLOOR — the table held 64 parishes when this was written, and
    // an empty map would make the loop below vacuously true.
    expect(entries.length).toBeGreaterThan(60);
    for (const [name, c] of entries) {
      expect(isWithinServiceArea(c.lat, c.lng), `${name} must be inside the service area`).toBe(true);
    }
  });

  it("accepts a real helpr who is out of state for the week, near the border", () => {
    // Houston, Jackson MS, Mobile, Little Rock — close enough that a distance
    // to a Louisiana job still means something.
    for (const [name, lat, lng] of [
      ["Houston", 29.7604, -95.3698],
      ["Jackson MS", 32.2988, -90.1848],
      ["Mobile", 30.6954, -88.0399],
      ["Little Rock", 34.7465, -92.2896],
    ] as const) {
      expect(isWithinServiceArea(lat, lng), name).toBe(true);
    }
  });

  it("rejects somewhere a viewer of a Louisiana marketplace is not", () => {
    for (const [name, lat, lng] of [
      ["Menlo Park", 37.4728, -122.2444],
      ["New York", 40.7128, -74.006],
      ["Denver", 39.7392, -104.9903],
      ["null island", 0, 0],
    ] as const) {
      expect(isWithinServiceArea(lat, lng), name).toBe(false);
    }
  });

  it("rejects a non-finite coordinate rather than letting NaN compare its way through", () => {
    expect(isWithinServiceArea(NaN, -91)).toBe(false);
    expect(isWithinServiceArea(30, NaN)).toBe(false);
  });
});

describe("isPreciseFixAccuracy", () => {
  it("accepts a radio-derived fix", () => {
    for (const m of [5, 65, 800, 3000, MAX_TRUSTED_FIX_ACCURACY_M]) {
      expect(isPreciseFixAccuracy(m), `${m}m`).toBe(true);
    }
  });

  it("rejects the tens-of-kilometres answer an IP fallback gives", () => {
    for (const m of [MAX_TRUSTED_FIX_ACCURACY_M + 1, 45_000, 150_000, 1_000_000]) {
      expect(isPreciseFixAccuracy(m), `${m}m`).toBe(false);
    }
  });

  it("treats a platform that reports no accuracy as unknown, not untrusted", () => {
    // Withholding a fix because the shim was terse would break every native
    // bridge that omits the field. The service-area gate still applies.
    expect(isPreciseFixAccuracy(undefined)).toBe(true);
    expect(isPreciseFixAccuracy(null)).toBe(true);
    expect(isPreciseFixAccuracy(NaN)).toBe(true);
  });
});

describe("plausibleTripMiles", () => {
  it("refuses every figure the owner was shown", () => {
    for (const { miles, city } of REPORTED) {
      expect(plausibleTripMiles(miles), city).toBeNull();
    }
  });

  it("still shows the longest trip this app can legitimately describe", () => {
    // Caddo ↔ Plaquemines, the widest pair of parish centroids in the table
    // (329.4 mi measured), is the longest journey the pill is CAPABLE of
    // describing — both its ends are centroids.
    const caddo = getParishCentroid("Caddo")!;
    const plaquemines = getParishCentroid("Plaquemines")!;
    const widest = haversineMiles(caddo.lat, caddo.lng, plaquemines.lat, plaquemines.lng);
    expect(widest).toBeGreaterThan(300);
    expect(plausibleTripMiles(widest)).toBeCloseTo(widest, 6);

    // And the widest pair of ALL parish centroids, derived rather than named,
    // so a future addition to the table cannot quietly exceed the bound.
    const cs = Object.values(PARISH_CENTROIDS);
    expect(cs.length).toBeGreaterThan(60);
    let max = 0;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        max = Math.max(max, haversineMiles(cs[i].lat, cs[i].lng, cs[j].lat, cs[j].lng));
      }
    }
    expect(max).toBeLessThan(MAX_PLAUSIBLE_TRIP_MILES);
  });

  it("passes a value at the bound and refuses the one past it", () => {
    expect(plausibleTripMiles(MAX_PLAUSIBLE_TRIP_MILES)).toBe(MAX_PLAUSIBLE_TRIP_MILES);
    expect(plausibleTripMiles(MAX_PLAUSIBLE_TRIP_MILES + 0.001)).toBeNull();
  });

  it("returns null rather than a clamped number — a clamped claim is still a claim", () => {
    expect(plausibleTripMiles(5000)).toBeNull();
    expect(plausibleTripMiles(null)).toBeNull();
    expect(plausibleTripMiles(undefined)).toBeNull();
    expect(plausibleTripMiles(NaN)).toBeNull();
    expect(plausibleTripMiles(Infinity)).toBeNull();
    expect(plausibleTripMiles(-3)).toBeNull();
  });

  it("keeps a zero-mile trip, which is a real answer", () => {
    expect(plausibleTripMiles(0)).toBe(0);
  });
});

describe("plausibleTripMinutes", () => {
  it("refuses the 27h 6m the owner was shown, and its three siblings", () => {
    // 27h 6m, 29h 52m, 29h 28m, 28h 23m in minutes.
    for (const m of [27 * 60 + 6, 29 * 60 + 52, 29 * 60 + 28, 28 * 60 + 23]) {
      expect(plausibleTripMinutes(m)).toBeNull();
    }
  });

  it("still shows a long but real Louisiana drive", () => {
    // Shreveport → New Orleans is about 5h30m by road.
    expect(plausibleTripMinutes(330)).toBe(330);
    // And a pessimistic estimate for the widest in-state trip.
    expect(plausibleTripMinutes(Math.round(MAX_PLAUSIBLE_TRIP_MILES * 1.3))).not.toBeNull();
  });

  it("passes a value at the bound and refuses the one past it", () => {
    expect(plausibleTripMinutes(MAX_PLAUSIBLE_TRIP_MINUTES)).toBe(MAX_PLAUSIBLE_TRIP_MINUTES);
    expect(plausibleTripMinutes(MAX_PLAUSIBLE_TRIP_MINUTES + 1)).toBeNull();
  });
});

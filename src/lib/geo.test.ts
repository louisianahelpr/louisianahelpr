import { describe, it, expect } from "vitest";
import { haversineMiles, parseNearbyFilter } from "./geo";

describe("haversineMiles", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineMiles(30.0, -90.0, 30.0, -90.0)).toBe(0);
  });

  it("approximates known city-pair distance (New Orleans → Baton Rouge ~75mi)", () => {
    // New Orleans: 29.9511, -90.0715
    // Baton Rouge: 30.4515, -91.1871
    //
    // PINNED, not banded. This used to assert 70 < d < 85, and the classic
    // haversine defect — dropping the cos(lat1)·cos(lat2) term, i.e. treating a
    // degree of longitude as a degree of latitude — lands at 84.48 mi on this
    // exact pair. It passed. Every browse radius, "X mi away" pill and
    // applicant-proximity sort in the app reads this one function, so the
    // number is pinned to a tenth of a mile.
    const d = haversineMiles(29.9511, -90.0715, 30.4515, -91.1871);
    expect(d).toBeCloseTo(75.06, 1);
  });

  it("shrinks a degree of longitude by cos(latitude) — the term that gets dropped", () => {
    // At 30°N a degree of longitude is ~59.8 mi and a degree of latitude
    // ~69.1 mi. A haversine missing the cosine term makes them equal, which is
    // the flat-earth-at-the-equator bug and is invisible to any symmetry or
    // identity check.
    const oneDegreeOfLongitude = haversineMiles(30, -90, 30, -91);
    const oneDegreeOfLatitude = haversineMiles(30, -90, 31, -90);
    expect(oneDegreeOfLongitude).toBeCloseTo(59.84, 1);
    expect(oneDegreeOfLatitude).toBeCloseTo(69.09, 1);
    expect(oneDegreeOfLongitude).toBeLessThan(oneDegreeOfLatitude - 8);
  });

  it("a longitude sign flip is not a plausible Louisiana distance", () => {
    // -91.1871 and +91.1871 are both well-formed numbers and only one of them
    // is in Louisiana. A job row whose longitude lost its sign must not read as
    // a nearby job; it must read as the other side of the planet.
    const correct = haversineMiles(29.9511, -90.0715, 30.4515, -91.1871);
    const flipped = haversineMiles(29.9511, -90.0715, 30.4515, 91.1871);
    expect(correct).toBeLessThan(100);
    expect(flipped).toBeGreaterThan(5_000);
  });

  it("is symmetric (a→b == b→a)", () => {
    const ab = haversineMiles(30, -90, 31, -91);
    const ba = haversineMiles(31, -91, 30, -90);
    expect(Math.abs(ab - ba)).toBeLessThan(0.0001);
  });
});

describe("parseNearbyFilter", () => {
  it("returns null for empty/missing input", () => {
    expect(parseNearbyFilter("")).toBe(null);
  });

  it("returns null when format doesn't match", () => {
    expect(parseNearbyFilter("any-other-string")).toBe(null);
    expect(parseNearbyFilter("nearby:")).toBe(null);
    expect(parseNearbyFilter("nearby:abc")).toBe(null);
  });

  it("parses integer miles", () => {
    expect(parseNearbyFilter("nearby:5")).toBe(5);
    expect(parseNearbyFilter("nearby:25")).toBe(25);
  });

  it("parses decimal miles", () => {
    expect(parseNearbyFilter("nearby:2.5")).toBe(2.5);
    expect(parseNearbyFilter("nearby:0.5")).toBe(0.5);
  });
});

// The cosine of the latitudes is the whole difference between a great-circle
// distance and a flat-grid one. Dropping it keeps every Louisiana answer
// plausible — 84 mi instead of 75 between New Orleans and Baton Rouge — which
// is exactly why it has to be pinned rather than banded.
// @mutate src/lib/geo.ts | Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2 | Math.sin(dLon / 2) ** 2

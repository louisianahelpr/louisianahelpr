import { describe, it, expect } from "vitest";
import { haversineMiles, parseNearbyFilter } from "./geo";

describe("haversineMiles", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineMiles(30.0, -90.0, 30.0, -90.0)).toBe(0);
  });

  it("approximates known city-pair distance (New Orleans → Baton Rouge ~75mi)", () => {
    // New Orleans: 29.9511, -90.0715
    // Baton Rouge: 30.4515, -91.1871
    const d = haversineMiles(29.9511, -90.0715, 30.4515, -91.1871);
    expect(d).toBeGreaterThan(70);
    expect(d).toBeLessThan(85);
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

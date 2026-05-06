// parishCentroids: Louisiana parish lat/lng lookup. Used in dialogs
// where exact job coords are masked but a "your parish is ~X miles
// away" hint is helpful. Tests validate the data set + the lookup
// function's normalization (trailing " Parish" suffix, case, etc.).

import { describe, it, expect } from "vitest";
import { PARISH_CENTROIDS, getParishCentroid } from "./parishCentroids";

describe("PARISH_CENTROIDS data", () => {
  it("includes the largest population parishes", () => {
    // Top-10 by population per the file's docstring intent
    const required = [
      "Orleans",
      "Jefferson",
      "St. Tammany",
      "East Baton Rouge",
      "Lafayette",
      "Caddo",
      "Calcasieu",
      "Ouachita",
      "Rapides",
      "Bossier",
    ];
    for (const parish of required) {
      expect(PARISH_CENTROIDS[parish], `missing required parish: ${parish}`).toBeDefined();
    }
  });

  it("every centroid is within Louisiana's bounding box (~28.9°-33.0°N, -94.1° to -88.8°W)", () => {
    for (const [parish, coords] of Object.entries(PARISH_CENTROIDS)) {
      expect(coords.lat, `${parish} lat out of LA bounds`).toBeGreaterThan(28.5);
      expect(coords.lat, `${parish} lat out of LA bounds`).toBeLessThan(33.5);
      expect(coords.lng, `${parish} lng out of LA bounds`).toBeLessThan(-88.5);
      expect(coords.lng, `${parish} lng out of LA bounds`).toBeGreaterThan(-94.5);
    }
  });

  it("no two parishes share identical coordinates (data-entry sanity)", () => {
    const seen = new Set<string>();
    for (const [parish, coords] of Object.entries(PARISH_CENTROIDS)) {
      const key = `${coords.lat},${coords.lng}`;
      expect(seen.has(key), `${parish} has duplicate coords with another parish`).toBe(false);
      seen.add(key);
    }
  });
});

describe("getParishCentroid", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(getParishCentroid(null)).toBeNull();
    expect(getParishCentroid(undefined)).toBeNull();
    expect(getParishCentroid("")).toBeNull();
  });

  it("returns the centroid for an exact-match parish name", () => {
    const result = getParishCentroid("Orleans");
    expect(result).toEqual({ lat: 29.9511, lng: -90.0715 });
  });

  it("strips trailing ' Parish' suffix (case-insensitive)", () => {
    expect(getParishCentroid("Orleans Parish")).toEqual({ lat: 29.9511, lng: -90.0715 });
    expect(getParishCentroid("Orleans parish")).toEqual({ lat: 29.9511, lng: -90.0715 });
    expect(getParishCentroid("Orleans PARISH")).toEqual({ lat: 29.9511, lng: -90.0715 });
  });

  it("trims whitespace before lookup", () => {
    expect(getParishCentroid("  Orleans  ")).toEqual({ lat: 29.9511, lng: -90.0715 });
    expect(getParishCentroid("Orleans Parish ")).toEqual({ lat: 29.9511, lng: -90.0715 });
  });

  it("returns null for a parish not in the table", () => {
    // Louisiana has 64 parishes; this list covers most. Genuinely
    // out-of-set values must return null.
    expect(getParishCentroid("Made Up Parish Name")).toBeNull();
    expect(getParishCentroid("Z'nonexistent")).toBeNull();
  });

  it("is case-sensitive on the parish name itself (matches database casing)", () => {
    // "orleans" (lowercase) won't match "Orleans" — this matches what
    // the profiles.parish column stores (canonical capitalized form).
    expect(getParishCentroid("orleans")).toBeNull();
  });

  it("returns null for completely unrelated input", () => {
    expect(getParishCentroid("Houston")).toBeNull();
    expect(getParishCentroid("Beverly Hills")).toBeNull();
  });
});

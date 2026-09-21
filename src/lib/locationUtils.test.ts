import { describe, it, expect } from "vitest";
import { getCity, getCityState, distanceInFeet } from "./locationUtils";

/**
 * COVERAGE NOTE (2026-09-21, guard burn-down).
 *
 * This file used to exercise `getCityState` and `distanceInFeet` only. Neither
 * has a single call site in `src/` — they are dead exports. The function every
 * job card in the app actually renders its location through is `getCity`
 * (JobCard, CompactJobCard, JobCardMetaRow, JobStatTiles, JobDetailDialog,
 * ScheduleTab, mapJobToEnrichedJob), and it had no test at all. The `getCity`
 * block below is that gap closed; the two dead exports keep their tests rather
 * than being deleted, because deleting product code is a separate decision.
 */

describe("getCityState", () => {
  it("extracts city + state from a full address", () => {
    expect(getCityState("123 Main St, Baton Rouge, LA 70801")).toBe("Baton Rouge, LA");
    expect(getCityState("456 Oak Ave, New Orleans, LA 70112")).toBe("New Orleans, LA");
  });

  it("strips ZIP+4 codes", () => {
    expect(getCityState("123 Main St, Lafayette, LA 70501-1234")).toBe("Lafayette, LA");
  });

  it("strips standalone 5-digit ZIPs from the state segment", () => {
    expect(getCityState("789 Bourbon, NOLA, LA 70130")).toBe("NOLA, LA");
  });

  it("returns the original string if no comma-separated parts", () => {
    expect(getCityState("just a string")).toBe("just a string");
  });

  it("returns empty string for empty input", () => {
    expect(getCityState("")).toBe("");
  });

  it("handles 2-part input (city + state only, no street)", () => {
    expect(getCityState("Baton Rouge, LA")).toBe("Baton Rouge, LA");
  });
});

describe("distanceInFeet", () => {
  it("returns 0 for identical coordinates", () => {
    expect(distanceInFeet(30, -90, 30, -90)).toBe(0);
  });

  it("converts at exactly 5280 feet to the mile", () => {
    // 0.001 degrees of latitude is 364.817 ft at Louisiana latitudes.
    //
    // PINNED, not banded. This used to assert 300 < d < 400, which accepts any
    // feet-per-mile constant between ~4340 and ~5790 — so the obvious typo,
    // 5028 for 5280, produced 347 ft and passed, and passed again on the
    // New Orleans → Baton Rouge case below (377k, inside 370k–450k).
    // The band also passed the New Orleans → Baton Rouge case below at 377k
    // (inside 370k–450k), so nothing in the file could see it.
    expect(distanceInFeet(30, -90, 30.001, -90)).toBeCloseTo(364.817, 2);
  });

  it("is symmetric (a→b == b→a)", () => {
    const ab = distanceInFeet(29.95, -90.07, 30.45, -91.18);
    const ba = distanceInFeet(30.45, -91.18, 29.95, -90.07);
    expect(Math.abs(ab - ba)).toBeLessThan(0.01);
  });

  it("reflects ~75mi New Orleans → Baton Rouge in feet (≈396k)", () => {
    const d = distanceInFeet(29.9511, -90.0715, 30.4515, -91.1871);
    expect(d).toBeCloseTo(396_294, -1);
  });
});

describe("getCity — the label every job card prints", () => {
  it("drops a leading neighborhood", () => {
    expect(getCity("Garden District, New Orleans")).toBe("New Orleans");
    expect(getCity("Garden District, New Orleans, LA")).toBe("New Orleans");
  });

  it("strips the trailing state code and ZIP, together or apart", () => {
    // Without the strip these render as "LA 70130" / "70130" / "LA" on the
    // card — a job whose location reads as a postcode.
    expect(getCity("New Orleans, LA 70130")).toBe("New Orleans");
    expect(getCity("Baton Rouge, 70801")).toBe("Baton Rouge");
    expect(getCity("Lafayette, LA")).toBe("Lafayette");
    expect(getCity("Houma, LA 70360-1234")).toBe("Houma");
  });

  it("returns a bare city unchanged", () => {
    expect(getCity("Shreveport")).toBe("Shreveport");
  });

  it("returns '' for an ownerless job's blank location rather than throwing", () => {
    // Deletion anonymises `jobs.location` to null and every call site passes
    // `job.location ?? ""`. A throw here takes the whole browse feed down.
    expect(getCity("")).toBe("");
    expect(getCity(",  ,")).toBe("");
  });
});

// A card that prints "LA 70130" where a city belongs is the visible half; the
// invisible half is that this is the ONLY normaliser between the free-text
// `jobs.location` column and seven rendering surfaces.
// @mutate src/lib/locationUtils.ts | if (isStateOrZip && parts.length > 1) parts = parts.slice(0, -1); | if (false) parts = parts.slice(0, -1);
// 5028 for 5280 is the transposition the old 300–400ft band could not see.
// @mutate src/lib/locationUtils.ts | haversineMiles(lat1, lng1, lat2, lng2) * 5280 | haversineMiles(lat1, lng1, lat2, lng2) * 5028

import { describe, it, expect } from "vitest";
import { getCityState, distanceInFeet } from "./locationUtils";

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

  it("approximates short distances reasonably", () => {
    // 0.001 degrees of latitude ≈ 365 feet at Louisiana latitudes
    const d = distanceInFeet(30, -90, 30.001, -90);
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(400);
  });

  it("is symmetric (a→b == b→a)", () => {
    const ab = distanceInFeet(29.95, -90.07, 30.45, -91.18);
    const ba = distanceInFeet(30.45, -91.18, 29.95, -90.07);
    expect(Math.abs(ab - ba)).toBeLessThan(0.01);
  });

  it("reflects ~75mi New Orleans → Baton Rouge in feet (≈396k)", () => {
    const d = distanceInFeet(29.9511, -90.0715, 30.4515, -91.1871);
    expect(d).toBeGreaterThan(370_000);
    expect(d).toBeLessThan(450_000);
  });
});

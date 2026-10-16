/**
 * Declutter slice 5: the drop-off geocoder the delivery price is measured from
 * (supabase/functions/_shared/geocodeDropoff.ts). Pure apart from the fetch it
 * is handed, so it runs here directly; Nominatim is never reached.
 *
 * @mutate supabase/functions/_shared/geocodeDropoff.ts |   if (!/[a-z]/i.test(a) \|\| !/\d/.test(a)) return null; |
 * @mutate supabase/functions/_shared/geocodeDropoff.ts |   const town = pick("city") ?? pick("town") ?? pick("village") ?? pick("hamlet") ?? pick("suburb") ?? pick("county"); |   const town = pick("road") ?? pick("city");
 */
import { describe, expect, it, vi } from "vitest";
import { geocodeDropoff, plausibleAddress } from "../../supabase/functions/_shared/geocodeDropoff";

const answer = (rows: unknown, status = 200) => vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(rows), { status }));

describe("plausibleAddress", () => {
  it("keeps a street address and collapses spaces", () => {
    expect(plausibleAddress("  900  Far Rd,   Baker LA ")).toBe("900 Far Rd, Baker LA");
  });
  it("refuses what is not an address", () => {
    for (const bad of [null, 42, "", "abcd", "no number here", "12345", "x".repeat(301)]) expect(plausibleAddress(bad)).toBeNull();
  });
});

describe("geocodeDropoff", () => {
  it("asks for one US result with address details and returns the point and town + state only", async () => {
    const f = answer([{ lat: "30.5412", lon: "-91.1543", address: { house_number: "900", road: "Far Rd", town: "Baker", state: "Louisiana" } }]);
    await expect(geocodeDropoff("900 Far Rd, Baker", f as unknown as typeof fetch)).resolves.toEqual({ lat: 30.5412, lng: -91.1543, areaLabel: "Baker, LA" });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.searchParams.get("countrycodes")).toBe("us");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("addressdetails")).toBe("1");
  });
  it("the area never carries the street", async () => {
    const f = answer([{ lat: "1", lon: "2", address: { road: "Secret Ln", house_number: "7" } }]);
    expect(await geocodeDropoff("7 Secret Ln", f as unknown as typeof fetch)).toMatchObject({ areaLabel: "Drop-off area" });
  });
  it("nothing found or a bad point is not_found (never a guessed point)", async () => {
    expect(await geocodeDropoff("1 A St", answer([]) as unknown as typeof fetch)).toEqual({ miss: "not_found" });
    expect(await geocodeDropoff("1 A St", answer([{ lat: "x", lon: "2" }]) as unknown as typeof fetch)).toEqual({ miss: "not_found" });
    expect(await geocodeDropoff("1 A St", answer([{ lat: "95", lon: "2" }]) as unknown as typeof fetch)).toEqual({ miss: "not_found" });
  });
  it("a geocoder that cannot answer (429, 5xx, not JSON, no connection) is unavailable, never 'not found' (lh-silent-failure #1)", async () => {
    expect(await geocodeDropoff("1 A St", answer([], 429) as unknown as typeof fetch)).toMatchObject({ miss: "unavailable", status: 429 });
    expect(await geocodeDropoff("1 A St", answer([], 503) as unknown as typeof fetch)).toMatchObject({ miss: "unavailable", status: 503 });
    const html = vi.fn(async () => new Response("<html>busy</html>", { status: 200 }));
    expect(await geocodeDropoff("1 A St", html as unknown as typeof fetch)).toMatchObject({ miss: "unavailable" });
    const boom = vi.fn(async () => { throw new Error("offline"); });
    expect(await geocodeDropoff("1 A St", boom as unknown as typeof fetch)).toMatchObject({ miss: "unavailable", status: null });
  });
});

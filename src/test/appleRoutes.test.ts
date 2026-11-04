/**
 * Q1930 / Q2485 (WIP): the Apple Maps ETAs reader (supabase/functions/_shared/appleRoutes.ts). Pure apart from the
 * fetch and the token signer it is handed, so it runs here; Apple is never reached. The answer shape is Apple's
 * documented /v1/etas shape (etas[].destination, distanceMeters, expectedTravelTimeSeconds), NOT yet read live.
 *
 * @mutate supabase/functions/_shared/appleRoutes.ts |       miles: Math.max(1, Math.ceil(meters / 1609.344)), |       miles: Math.max(1, Math.round(meters / 1609.344)),
 * @mutate supabase/functions/_shared/appleRoutes.ts |     const e = byPoint.get(key(d.lat, d.lng)); |     const e = [...byPoint.values()][0];
 * @mutate supabase/functions/_shared/appleRoutes.ts |   url.searchParams.set("transportType", "Automobile"); |   url.searchParams.set("transportType", "Walking");
 * @mutate supabase/functions/_shared/appleRoutes.ts |   if (!Array.isArray(etas)) return | if (false) return
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_ETA_DESTINATIONS, appleEtas } from "../../supabase/functions/_shared/appleRoutes";

const apple = { developerToken: async () => "dev-jwt" };
// A Mississippi River crossing: Gretna (Westbank) to Lakeview (Eastbank, New Orleans).
const GRETNA = { lat: 29.9147, lng: -90.0540 };
const LAKEVIEW = { lat: 30.0101, lng: -90.1137 };
const METAIRIE = { lat: 30.0026, lng: -90.1777 };

function stubApple(etas: unknown, status = 200) {
  return vi.fn(async (u: string, _i?: RequestInit) => {
    if (String(u).endsWith("/v1/token")) return new Response(JSON.stringify({ accessToken: "acc" }), { status: 200 });
    return new Response(JSON.stringify(etas), { status });
  });
}

/** declutter_road_miles today: straight line (haversine) x 1.3, rounded up. */
function estimateMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.max(1, Math.ceil((2 * r * Math.asin(Math.sqrt(h))) / 1609.344 * 1.3));
}

describe("appleEtas (Q1930 road miles, Q2485 travel time)", () => {
  it("asks for car ETAs from one origin to each destination and returns routed miles (rounded up) and minutes, matched by point", async () => {
    // Answered out of order: matched by coordinate, not position. Stub distances, not live readings.
    const f = stubApple({ etas: [
      { destination: { latitude: METAIRIE.lat, longitude: METAIRIE.lng }, distanceMeters: 19000, expectedTravelTimeSeconds: 1500 },
      { destination: { latitude: LAKEVIEW.lat, longitude: LAKEVIEW.lng }, distanceMeters: 21500, expectedTravelTimeSeconds: 1430 },
    ] });
    const out = await appleEtas(GRETNA, [LAKEVIEW, METAIRIE], apple, f as unknown as typeof fetch);
    expect(out).toEqual([{ meters: 21500, miles: 14, minutes: 24 }, { meters: 19000, miles: 12, minutes: 25 }]);
    const url = new URL(String(f.mock.calls[1][0]));
    expect(url.pathname).toBe("/v1/etas");
    expect(url.searchParams.get("origin")).toBe(`${GRETNA.lat},${GRETNA.lng}`);
    expect(url.searchParams.get("destinations")).toBe(`${LAKEVIEW.lat},${LAKEVIEW.lng}|${METAIRIE.lat},${METAIRIE.lng}`);
    expect(url.searchParams.get("transportType")).toBe("Automobile");
    expect((f.mock.calls[1][1] as unknown as RequestInit).headers).toMatchObject({ Authorization: "Bearer acc" });
    // The river-crossing case the item is about: the routed miles beat the 1.3x estimate the Helpr is paid on today.
    expect(estimateMiles(GRETNA, LAKEVIEW)).toBeLessThan((out as { miles: number }[])[0].miles);
  });

  it("a destination Apple could not route is null; the others still answer", async () => {
    const f = stubApple({ etas: [{ destination: { latitude: LAKEVIEW.lat, longitude: LAKEVIEW.lng }, distanceMeters: 21500 }] });
    expect(await appleEtas(GRETNA, [LAKEVIEW, METAIRIE], apple, f as unknown as typeof fetch)).toEqual([{ meters: 21500, miles: 14, minutes: null }, null]);
  });

  it("never throws: a failed token, HTTP error, bad JSON or a signer error is a miss that never quotes the signer", async () => {
    const http = stubApple({}, 503);
    expect(await appleEtas(GRETNA, [LAKEVIEW], apple, http as unknown as typeof fetch)).toMatchObject({ miss: "unavailable", status: 503 });
    const noList = stubApple({ error: { message: "x" } });
    expect(await appleEtas(GRETNA, [LAKEVIEW], apple, noList as unknown as typeof fetch)).toMatchObject({ miss: "unavailable", detail: "the Apple Maps answer had no etas list" });
    const boom = { developerToken: async () => { throw new Error("-----BEGIN PRIVATE KEY----- secret"); } };
    const miss = await appleEtas(GRETNA, [LAKEVIEW], boom, stubApple({}) as unknown as typeof fetch);
    expect(JSON.stringify(miss)).not.toContain("PRIVATE");
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await appleEtas(GRETNA, [LAKEVIEW], apple, down as unknown as typeof fetch)).toMatchObject({ miss: "unavailable", detail: "Apple Maps token: TypeError" });
  });

  it("refuses a bad request without calling Apple (no destinations, more than 10, an impossible point)", async () => {
    const f = stubApple({ etas: [] });
    expect(MAX_ETA_DESTINATIONS).toBeGreaterThan(1);
    for (const dests of [[], Array.from({ length: MAX_ETA_DESTINATIONS + 1 }, () => LAKEVIEW), [{ lat: 91, lng: 0 }]]) {
      expect(await appleEtas(GRETNA, dests, apple, f as unknown as typeof fetch)).toMatchObject({ miss: "unavailable", detail: "bad route request" });
    }
    expect(f).not.toHaveBeenCalled();
  });
});

/**
 * Q1930 / Q2485 (WIP): the Apple Maps ETAs reader (supabase/functions/_shared/appleRoutes.ts). Pure apart from the
 * fetch and the token signer it is handed, so it runs here; Apple is never reached. The answer shape was READ LIVE
 * once on 2026-11-04 (Builder 103, ~/.lh-shots/b103-q1930/etas-live.mjs: mapkit-token -> /v1/token -> /v1/etas,
 * HTTP 200, no token printed): etas[] in destination order, each { destination: { latitude, longitude },
 * transportType, distanceMeters, expectedTravelTimeSeconds, staticTravelTimeSeconds }, the destination echoed exactly
 * as sent ("30.2000" came back 30.2). The first test below replays that answer verbatim.
 *
 * @mutate supabase/functions/_shared/appleRoutes.ts |       miles: Math.max(1, Math.ceil(meters / 1609.344)), |       miles: Math.max(1, Math.round(meters / 1609.344)),
 * @mutate supabase/functions/_shared/appleRoutes.ts |     const e = byPoint.get(key(d.lat, d.lng)); |     const e = [...byPoint.values()][0];
 * @mutate supabase/functions/_shared/appleRoutes.ts |   url.searchParams.set("transportType", "Automobile"); |   url.searchParams.set("transportType", "Walking");
 * @mutate supabase/functions/_shared/appleRoutes.ts |   if (!Array.isArray(etas)) return | if (false) return
 * @mutate supabase/functions/_shared/appleRoutes.ts |           o_lat: p.o_lat, o_lng: p.o_lng, d_lat: p.d_lat, d_lng: p.d_lng, miles: leg.miles, |           o_lat: Number(p.o_lat.toFixed(1)), o_lng: p.o_lng, d_lat: p.d_lat, d_lng: p.d_lng, miles: leg.miles,
 * @mutate supabase/functions/_shared/appleRoutes.ts |         if (!leg \|\| leg.miles > MAX_ROUTED_MILES) return; |         if (!leg) return;
 * @mutate supabase/functions/_shared/appleRoutes.ts |   if (!apple) return 0; |   if (!apple) return -1;
 * @mutate supabase/functions/_shared/appleRoutes.ts |   const answers = await Promise.all(chunks.map((chunk) => appleEtas( |   const answers = await Promise.all(chunks.slice(0, 1).map((chunk) => appleEtas(
 * @mutate supabase/functions/_shared/appleRoutes.ts |     access, |     undefined,
 * @mutate supabase/functions/_shared/appleRoutes.ts |   if (firstMiss) await outage(firstMiss); |   if (false) await outage(firstMiss!);
 * @mutate supabase/functions/_shared/appleRoutes.ts |   if (waitUntil) waitUntil(run); |   if (waitUntil) waitUntil(Promise.resolve());
 * @mutate supabase/functions/declutter-checkout/index.ts |   routeInBackground(() => storeRoutedMiles( |   await storeRoutedMiles(admin as unknown as RouteStore, user.id, sellerId, appleMapsAccess(), routeOutageAlert); routeInBackground(() => storeRoutedMiles(
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import {
  MAX_ETA_DESTINATIONS, ROUTE_OUTAGE_PAUSE_MINUTES, type RouteStore, appleEtas, routeInBackground, storeRoutedMiles,
} from "../../supabase/functions/_shared/appleRoutes";

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
  it("reads Apple's live answer (2026-11-04, Lafayette -> Baton Rouge and a Lafayette point) as routed miles and minutes", async () => {
    const live = { etas: [
      { destination: { latitude: 30.4515, longitude: -91.1871 }, transportType: "Automobile", distanceMeters: 90410, expectedTravelTimeSeconds: 3315, staticTravelTimeSeconds: 3049 },
      { destination: { latitude: 30.2, longitude: -92.03 }, transportType: "Automobile", distanceMeters: 4476, expectedTravelTimeSeconds: 442, staticTravelTimeSeconds: 375 },
    ] };
    const legs = await appleEtas({ lat: 30.2241, lng: -92.0198 }, [{ lat: 30.4515, lng: -91.1871 }, { lat: 30.2, lng: -92.03 }], apple, stubApple(live) as unknown as typeof fetch);
    // 90410 m = 56.18 mi -> 57; 3315 s -> 56 min. 4476 m = 2.78 mi -> 3; 442 s -> 8 min.
    expect(legs).toEqual([{ meters: 90410, miles: 57, minutes: 56 }, { meters: 4476, miles: 3, minutes: 8 }]);
  });

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

/** A stub of the edge function's admin client: the pairs RPC answers `pairs`; outage calls and upserts are recorded. */
function stubStore(pairs: unknown, opts: { rpcError?: string; upsertError?: string } = {}) {
  const upserts: { rows: Record<string, unknown>[]; onConflict: string }[] = [];
  const outages: unknown[] = [];
  const rpc = vi.fn(async (fn: string, args: unknown) => {
    if (fn === "declutter_route_outage") {
      outages.push(args);
      return { data: null, error: null };
    }
    return { data: opts.rpcError ? null : pairs, error: opts.rpcError ? { message: opts.rpcError } : null };
  });
  const store = {
    rpc,
    from: () => ({
      upsert: async (rows: Record<string, unknown>[], o: { onConflict: string }) => {
        upserts.push({ rows, onConflict: o.onConflict });
        return { error: opts.upsertError ? { message: opts.upsertError } : null };
      },
    }),
  } as unknown as RouteStore;
  return { store, upserts, rpc, outages };
}
const etasCalls = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.filter((c) => String(c[0]).includes("/v1/etas"));
const tokenCalls = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.filter((c) => String(c[0]).endsWith("/v1/token"));

describe("storeRoutedMiles (Q1930: declutter-checkout stores Apple's road miles under the quote's exact key)", () => {
  const NOW = () => new Date("2026-11-04T12:00:00Z");
  const dropA = { d_lat: 30.451468, d_lng: -91.187147 };
  const dropB = { d_lat: 30.2, d_lng: -92.03 };
  const noAlert = vi.fn(async () => true);

  it("routes each origin once to its drop-offs and upserts miles + minutes under the pair's exact numbers", async () => {
    const { store, upserts, rpc } = stubStore([{ o_lat: 30.22, o_lng: -92.02, ...dropA }, { o_lat: 30.22, o_lng: -92.02, ...dropB }]);
    const f = stubApple({ etas: [
      { destination: { latitude: 30.451468, longitude: -91.187147 }, distanceMeters: 90410, expectedTravelTimeSeconds: 3315 },
      { destination: { latitude: 30.2, longitude: -92.03 }, distanceMeters: 4476, expectedTravelTimeSeconds: 442 },
    ] });
    expect(await storeRoutedMiles(store, "buyer", "seller", apple, noAlert, f as unknown as typeof fetch, NOW)).toBe(2);
    expect(rpc).toHaveBeenCalledWith("declutter_route_pairs", { p_buyer: "buyer", p_seller: "seller" });
    expect(etasCalls(f)).toHaveLength(1);
    expect(upserts).toEqual([{ onConflict: "o_lat,o_lng,d_lat,d_lng", rows: [
      { o_lat: 30.22, o_lng: -92.02, ...dropA, miles: 57, minutes: 56, source: "apple", routed_at: "2026-11-04T12:00:00.000Z" },
      { o_lat: 30.22, o_lng: -92.02, ...dropB, miles: 3, minutes: 8, source: "apple", routed_at: "2026-11-04T12:00:00.000Z" },
    ] }]);
  });

  it("asks for ONE access token per call and routes the origins in parallel (more than 10 drop-offs split)", async () => {
    const pairs = [
      ...Array.from({ length: MAX_ETA_DESTINATIONS + 2 }, (_, i) => ({ o_lat: 30.22, o_lng: -92.02, d_lat: 30 + i / 100, d_lng: -91 })),
      { o_lat: 30.11, o_lng: -92, d_lat: 30.5, d_lng: -91 },
    ];
    const { store } = stubStore(pairs);
    let inFlight = 0, most = 0;
    const f = vi.fn(async (u: string) => {
      if (String(u).endsWith("/v1/token")) return new Response(JSON.stringify({ accessToken: "acc" }), { status: 200 });
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const dests = new URL(String(u)).searchParams.get("destinations")!.split("|");
      return new Response(JSON.stringify({ etas: dests.map((d) => ({ destination: { latitude: Number(d.split(",")[0]), longitude: Number(d.split(",")[1]) }, distanceMeters: 1609 })) }), { status: 200 });
    });
    expect(await storeRoutedMiles(store, "b", "s", apple, noAlert, f as unknown as typeof fetch, NOW)).toBe(MAX_ETA_DESTINATIONS + 3);
    expect(tokenCalls(f)).toHaveLength(1);
    expect(etasCalls(f)).toHaveLength(3);
    expect(most).toBe(3);
  });

  it("an Apple outage pauses routing (declutter_route_outage) and alerts; nothing is stored and it returns 0", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const one = [{ o_lat: 30.22, o_lng: -92.02, ...dropA }];
    for (const f of [stubApple({}, 503), vi.fn(async () => new Response("{}", { status: 500 }))]) {
      const s = stubStore(one);
      const alert = vi.fn(async () => true);
      expect(await storeRoutedMiles(s.store, "b", "s", apple, alert, f as unknown as typeof fetch)).toBe(0);
      expect(s.outages).toEqual([{ p_minutes: ROUTE_OUTAGE_PAUSE_MINUTES }]);
      expect(alert).toHaveBeenCalledTimes(1);
      expect(s.upserts).toEqual([]);
    }
    // A failing alert never throws out of it.
    const s = stubStore(one);
    expect(await storeRoutedMiles(s.store, "b", "s", apple, async () => { throw new Error("slack down"); }, stubApple({}, 503) as unknown as typeof fetch)).toBe(0);
    expect(quiet.mock.calls.map((c) => String(c[0])).some((l) => l.includes("route_outage_alert_failed"))).toBe(true);
    quiet.mockRestore();
  });

  it("never fails the quote: no Apple key, a pairs error, no pairs, an unroutable or absurd leg, or a failed upsert stores nothing and returns 0", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const one = [{ o_lat: 30.22, o_lng: -92.02, ...dropA }];
    const none = stubApple({ etas: [] });
    expect(await storeRoutedMiles(stubStore(one).store, "b", "s", null, noAlert, none as unknown as typeof fetch)).toBe(0);
    expect(await storeRoutedMiles(stubStore(null, { rpcError: "boom" }).store, "b", "s", apple, noAlert, none as unknown as typeof fetch)).toBe(0);
    expect(await storeRoutedMiles(stubStore([]).store, "b", "s", apple, noAlert, none as unknown as typeof fetch)).toBe(0);
    expect(none).not.toHaveBeenCalled();
    const far = stubStore(one);
    const absurd = stubApple({ etas: [{ destination: { latitude: dropA.d_lat, longitude: dropA.d_lng }, distanceMeters: 2001 * 1609.344 }] });
    expect(await storeRoutedMiles(far.store, "b", "s", apple, noAlert, absurd as unknown as typeof fetch)).toBe(0);
    expect(far.upserts).toEqual([]);
    expect(far.outages).toEqual([]);
    const ok = stubApple({ etas: [{ destination: { latitude: dropA.d_lat, longitude: dropA.d_lng }, distanceMeters: 1609 }] });
    expect(await storeRoutedMiles(stubStore(one, { upsertError: "denied" }).store, "b", "s", apple, noAlert, ok as unknown as typeof fetch)).toBe(0);
    const logged = quiet.mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.includes("route_pairs_read_failed"))).toBe(true);
    expect(logged.some((l) => l.includes("route_miles_store_failed"))).toBe(true);
    quiet.mockRestore();
  });
});

describe("the delivery quote never waits for Apple (Q1930, lead review 11-04: nothing slow for users)", () => {
  it("routeInBackground returns at once, hands the work to waitUntil, and swallows a throw into the log", async () => {
    let finish!: () => void;
    const work = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    const handed: Promise<unknown>[] = [];
    const t0 = Date.now();
    expect(routeInBackground(work, (p) => handed.push(p))).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(50);
    expect(handed).toHaveLength(1);
    let settled = false;
    void handed[0].then(() => { settled = true; });
    await Promise.resolve();
    expect(work).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    finish();
    await handed[0];
    expect(settled).toBe(true);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: Promise<unknown>[] = [];
    routeInBackground(async () => { throw new Error("x"); }, (p) => failing.push(p));
    await expect(failing[0]).resolves.toBeUndefined();
    expect(quiet.mock.calls.some((c) => String(c[0]).includes("route_background_failed"))).toBe(true);
    quiet.mockRestore();
  });

  it("declutter-checkout's deliveryQuote reads the quote first and routes through routeInBackground, never awaiting storeRoutedMiles", () => {
    const src = blankComments(readFileSync("supabase/functions/declutter-checkout/index.ts", "utf8"));
    const start = src.indexOf("async function deliveryQuote(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).not.toMatch(/await\s+storeRoutedMiles/);
    const quoteAt = body.indexOf('rpc("declutter_delivery_quote"');
    const bgAt = body.indexOf("routeInBackground(");
    expect(quoteAt).toBeGreaterThan(0);
    expect(bgAt).toBeGreaterThan(quoteAt);
    expect(body.slice(bgAt, body.indexOf(";", bgAt))).toMatch(/storeRoutedMiles\(/);
    expect(src.match(/storeRoutedMiles\(/g)?.length ?? 0).toBe(1);
  });
});

/**
 * The owner's real pickup address answered "can't find this address" on the live site: one free-text search, limit 1,
 * null for no match AND for any failure. Only made-up places here, never a real address.
 *
 * @mutate src/lib/addressLookup.ts |   if (server === "failed" \|\| first === "failed" \|\| area === "failed") return finish({ status: "unavailable" }, "none"); |
 * @mutate src/lib/addressLookup.ts |   if (typeof server === "object" && server.precision === "exact") return finish({ status: "exact", lat: server.lat, lng: server.lng }, "apple"); |
 * @mutate src/lib/addressLookup.ts |   if (hit && hit.precision !== "exact") { |   if (hit) { return finish({ status: "exact", lat: hit.lat, lng: hit.lng }, "apple"); } if (hit) {
 * @mutate supabase/functions/_shared/addressMatch.ts |   return typed.houseNumber && number === typed.houseNumber ? "exact" : "street"; |   return "exact";
 * @mutate supabase/functions/_shared/addressMatch.ts |   if (isSomewhereElse(typed, found)) return null; |
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ answer: null as unknown as { data?: unknown; error?: unknown } }));
const tracked = vi.hoisted(() => [] as Array<{ event: string; props: Record<string, unknown> }>);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn(async () => server.answer) } },
}));
vi.mock("@/lib/analytics", () => ({ track: (event: string, props: Record<string, unknown>) => tracked.push({ event, props }) }));

import { supabase } from "@/integrations/supabase/client";
import { lookUpAddress } from "./addressLookup";
import { matchPrecision, parseUsAddress } from "../../supabase/functions/_shared/addressMatch";

const TYPED = "101 Sample Bayou Rd, Exampleville, LA 70000";
const noWait = async () => undefined;
const place = (over: Record<string, unknown> = {}) => [{
  lat: "30.5", lon: "-92.1",
  address: { house_number: "101", road: "Sample Bayou Road", town: "Exampleville", state: "Louisiana", postcode: "70000", ...over },
}];
function nominatim(...answers: Array<unknown | number>) {
  const fn = vi.fn(async () => {
    const a = answers.shift();
    return typeof a === "number" ? new Response("no", { status: a }) : new Response(JSON.stringify(a ?? []), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("lookUpAddress", () => {
  beforeEach(() => { tracked.length = 0; vi.mocked(supabase.functions.invoke).mockClear(); });
  afterEach(() => vi.unstubAllGlobals());

  it("Apple's house-level match answers alone: the browser asks nobody else", async () => {
    server.answer = { data: { result: "found", lat: 30.4, lng: -92, precision: "exact" }, error: null };
    const f = nominatim();
    expect(await lookUpAddress(TYPED, noWait)).toEqual({ status: "exact", lat: 30.4, lng: -92 });
    expect(f).not.toHaveBeenCalled();
  });

  it("the server being down still finds the house from the browser", async () => {
    server.answer = { data: null, error: new Error("503") };
    const f = nominatim(place());
    expect(await lookUpAddress(TYPED, noWait)).toEqual({ status: "exact", lat: 30.5, lng: -92.1 });
    const url = new URL(String((f.mock.calls as unknown as [string][])[0][0]));
    expect(url.searchParams.get("street")).toBe("101 Sample Bayou Rd");
    expect(url.searchParams.get("city")).toBe("Exampleville");
    expect(url.searchParams.get("q")).toBeNull();
  });

  it("the house is missing: the area comes back as approximate, labelled, never as exact", async () => {
    server.answer = { data: { result: "found", lat: 30.3, lng: -92.2, precision: "town" }, error: null };
    nominatim(place({ house_number: undefined }));
    expect(await lookUpAddress(TYPED, noWait)).toEqual({ status: "approximate", lat: 30.3, lng: -92.2, precision: "town" });
  });

  it("nothing for the house, then the town search, waiting a second between OpenStreetMap requests", async () => {
    server.answer = { data: { result: "not_found" }, error: null };
    const f = nominatim([], [{ lat: "30.6", lon: "-92.3", address: { town: "Exampleville", state: "Louisiana" } }]);
    const wait = vi.fn(noWait);
    expect(await lookUpAddress(TYPED, wait)).toEqual({ status: "approximate", lat: 30.6, lng: -92.3, precision: "town" });
    expect(wait).toHaveBeenCalledWith(1100);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("every lookup answering nothing is 'not found'", async () => {
    server.answer = { data: { result: "not_found" }, error: null };
    nominatim([], []);
    expect(await lookUpAddress(TYPED, noWait)).toEqual({ status: "not_found" });
  });

  it.each([
    ["429", 429],
    ["503", 503],
  ])("a %s from OpenStreetMap with the server down is 'unavailable', never 'not found'", async (_n, code) => {
    server.answer = { data: null, error: new Error("down") };
    nominatim(code);
    expect(await lookUpAddress(TYPED, noWait)).toEqual({ status: "unavailable" });
  });

  it("no connection at all is 'unavailable'; so is a JSON error object", async () => {
    server.answer = { data: null, error: new Error("down") };
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await lookUpAddress(TYPED, noWait)).toEqual({ status: "unavailable" });
    nominatim({ error: "Unable to geocode" });
    expect(await lookUpAddress(TYPED, noWait)).toEqual({ status: "unavailable" });
  });

  it("an unconfirmed email's 403 falls back to OpenStreetMap, and is never read as 'can't find it'", async () => {
    // supabase.functions.invoke's answer to refuseUnconfirmedEmail's 403: no data, an HTTP error.
    const refused = { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: { status: 403 } }) };
    server.answer = refused;
    nominatim(place());
    expect(await lookUpAddress(TYPED, noWait)).toEqual({ status: "exact", lat: 30.5, lng: -92.1 });
    server.answer = refused;
    nominatim([], []);
    expect(await lookUpAddress(TYPED, noWait)).toEqual({ status: "unavailable" });
  });

  it("the server down and OpenStreetMap finding nothing is still 'unavailable': Apple might have known it", async () => {
    server.answer = { data: null, error: new Error("down") };
    nominatim([], []);
    expect(await lookUpAddress(TYPED, noWait)).toEqual({ status: "unavailable" });
  });

  it("the count of misses carries the outcome and source, never the address", async () => {
    server.answer = { data: { result: "not_found" }, error: null };
    nominatim([], []);
    await lookUpAddress(TYPED, noWait);
    expect(tracked).toEqual([{ event: "address_lookup_result", props: { outcome: "not_found", source: "none" } }]);
    expect(JSON.stringify(tracked)).not.toMatch(/Sample|Exampleville|70000/);
  });
});

describe("matchPrecision", () => {
  const typed = parseUsAddress(TYPED);
  it("reads the parts of a typed address", () => {
    expect(typed).toEqual({ houseNumber: "101", street: "101 Sample Bayou Rd", city: "Exampleville", state: "LA", zip: "70000" });
    expect(parseUsAddress("101 Sample Bayou Rd Exampleville LA 70000")).toMatchObject({ houseNumber: "101", city: null, state: "LA", zip: "70000" });
  });
  it("the same number on the same street in the same town is exact", () => {
    expect(matchPrecision(typed, { houseNumber: "101", street: "Sample Bayou Road", city: "Exampleville", state: "LA" })).toBe("exact");
  });
  it("another number on the street is street; another street is town", () => {
    expect(matchPrecision(typed, { houseNumber: "909", street: "Sample Bayou Rd", city: "Exampleville", state: "LA" })).toBe("street");
    expect(matchPrecision(typed, { houseNumber: "101", street: "Other Lane", city: "Exampleville", state: "LA" })).toBe("town");
    expect(matchPrecision(typed, { city: "Exampleville", state: "LA" })).toBe("town");
  });
  it("another state, or neither the town nor the ZIP, is no match at all", () => {
    expect(matchPrecision(typed, { houseNumber: "101", street: "Sample Bayou Rd", city: "Exampleville", state: "Texas" })).toBeNull();
    expect(matchPrecision(typed, { houseNumber: "101", street: "Sample Bayou Rd", city: "Elsewhere", zip: "79999", state: "LA" })).toBeNull();
  });
  it("the right ZIP under another town's name still matches: rural mail towns differ", () => {
    expect(matchPrecision(typed, { houseNumber: "101", street: "Sample Bayou Rd", city: "Nearby", zip: "70000", state: "LA" })).toBe("exact");
  });
});

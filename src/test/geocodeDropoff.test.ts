/**
 * Declutter slice 5: the drop-off geocoder the delivery price is measured from
 * (supabase/functions/_shared/geocodeDropoff.ts). Pure apart from the fetch it
 * is handed, so it runs here directly; Nominatim is never reached.
 *
 * @mutate supabase/functions/_shared/geocodeDropoff.ts |   if (!/[a-z]/i.test(a) \|\| !/\d/.test(a)) return null; |
 * @mutate supabase/functions/_shared/geocodeDropoff.ts |   const town = pick("city") ?? pick("town") ?? pick("village") ?? pick("hamlet") ?? pick("suburb") ?? pick("county"); |   const town = pick("road") ?? pick("city");
 * @mutate supabase/functions/_shared/geocodeDropoff.ts |     if (!("miss" in a) \|\| a.miss === "not_found") return a; |     if (!("miss" in a)) return a;
 * @mutate supabase/functions/_shared/geocodeDropoff.ts |   const label = [str("locality") ?? str("subAdministrativeArea"), | const label = [str("fullThoroughfare") ?? str("locality"),
 * @mutate supabase/functions/_shared/geocodeDropoff.ts |   if (apple) { |   if (apple && false) {
 * @mutate supabase/functions/_shared/geocodeDropoff.ts |     return { miss: "unavailable", status: null, detail: thrownName(e) }; |     return { miss: "unavailable", status: null, detail: String(e).slice(0, 200) };
 * @mutate supabase/functions/_shared/geocodeDropoff.ts |     return { miss: "unavailable", status: null, detail: `Apple Maps: ${thrownName(e)}` }; |     return { miss: "unavailable", status: null, detail: `Apple Maps: ${String(e).slice(0, 190)}` };
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
    expect(await geocodeDropoff("1 A St", answer([{ lat: String(90 + 5), lon: "2" }]) as unknown as typeof fetch)).toEqual({ miss: "not_found" });
  });
  it("a geocoder that cannot answer (429, 5xx, not JSON, no connection) is unavailable, never 'not found' (lh-silent-failure #1)", async () => {
    expect(await geocodeDropoff("1 A St", answer([], 429) as unknown as typeof fetch)).toMatchObject({ miss: "unavailable", status: 429 });
    expect(await geocodeDropoff("1 A St", answer([], 503) as unknown as typeof fetch)).toMatchObject({ miss: "unavailable", status: 503 });
    expect(await geocodeDropoff("1 A St", answer({ error: "Unable to geocode" }) as unknown as typeof fetch)).toMatchObject({ miss: "unavailable" });
    const html = vi.fn(async () => new Response("<html>busy</html>", { status: 200 }));
    expect(await geocodeDropoff("1 A St", html as unknown as typeof fetch)).toMatchObject({ miss: "unavailable" });
    const boom = vi.fn(async () => { throw new Error("offline"); });
    expect(await geocodeDropoff("1 A St", boom as unknown as typeof fetch)).toMatchObject({ miss: "unavailable", status: null });
  });
});

/**
 * Q2413 (measured 2026-10-27): Nominatim answers HTTP 403 to the edge servers, so every Helpr
 * delivery quote on prod failed "try again". Apple Maps (the MapKit key the app's maps already
 * use) answers first; Nominatim only when Apple cannot answer.
 */
describe("geocodeDropoff with Apple Maps first (Q2413)", () => {
  const appleRoute = (geocode: unknown, opts: { tokenStatus?: number; geocodeStatus?: number; nominatim?: unknown } = {}) =>
    vi.fn(async (u: string, _i?: RequestInit) => {
      const url = String(u);
      if (url.startsWith("https://maps-api.apple.com/v1/token")) {
        return new Response(JSON.stringify({ accessToken: "apple-access", expiresInSeconds: 1800 }), { status: opts.tokenStatus ?? 200 });
      }
      if (url.startsWith("https://maps-api.apple.com/v1/geocode")) return new Response(JSON.stringify(geocode), { status: opts.geocodeStatus ?? 200 });
      if (url.startsWith("https://nominatim.openstreetmap.org/")) {
        return new Response(JSON.stringify(opts.nominatim ?? [{ lat: "30.5412", lon: "-91.1543", address: { town: "Baker", state: "Louisiana" } }]), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  const apple = { developerToken: vi.fn(async () => "dev-jwt") };
  const found = { results: [{ coordinate: { latitude: 30.4441482, longitude: -91.1484169 }, structuredAddress: {
    administrativeArea: "Louisiana", administrativeAreaCode: "LA", locality: "Baton Rouge", postCode: "70806",
    thoroughfare: "Government St", subThoroughfare: "4000", fullThoroughfare: "4000 Government St",
  } }] };

  it("answers from Apple Maps: the developer token buys an access token, the lookup is US only, the area is town + state", async () => {
    const f = appleRoute(found);
    expect(await geocodeDropoff("4000 Government St, Baton Rouge", f as unknown as typeof fetch, apple))
      .toEqual({ lat: 30.4441482, lng: -91.1484169, areaLabel: "Baton Rouge, LA" });
    expect((f.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe("Bearer dev-jwt");
    const lookup = new URL(String(f.mock.calls[1][0]));
    expect(lookup.searchParams.get("limitToCountries")).toBe("US");
    expect(lookup.searchParams.get("q")).toBe("4000 Government St, Baton Rouge");
    expect((f.mock.calls[1][1]?.headers as Record<string, string>).Authorization).toBe("Bearer apple-access");
    // Nominatim (403 to our servers) is never asked when Apple answered.
    expect(f.mock.calls.some((c) => String(c[0]).includes("nominatim"))).toBe(false);
  });

  it("the Apple area never carries the street", async () => {
    const f = appleRoute({ results: [{ coordinate: { latitude: 1, longitude: 2 }, structuredAddress: { thoroughfare: "Secret Ln", subThoroughfare: "7" } }] });
    expect(await geocodeDropoff("7 Secret Ln", f as unknown as typeof fetch, apple)).toMatchObject({ areaLabel: "Drop-off area" });
  });

  it("an Apple 'nothing found' is final: no second geocoder guesses a point", async () => {
    const f = appleRoute({ results: [] });
    expect(await geocodeDropoff("1 A St", f as unknown as typeof fetch, apple)).toEqual({ miss: "not_found" });
    expect(f.mock.calls.some((c) => String(c[0]).includes("nominatim"))).toBe(false);
  });

  it("Apple unable to answer (token refused, 5xx, error object, signer throws) falls back to Nominatim", async () => {
    const want = { lat: 30.5412, lng: -91.1543, areaLabel: "Baker, LA" };
    expect(await geocodeDropoff("900 Far Rd, Baker", appleRoute(found, { tokenStatus: 401 }) as unknown as typeof fetch, apple)).toEqual(want);
    expect(await geocodeDropoff("900 Far Rd, Baker", appleRoute(found, { geocodeStatus: 503 }) as unknown as typeof fetch, apple)).toEqual(want);
    expect(await geocodeDropoff("900 Far Rd, Baker", appleRoute({ error: { message: "bad" } }) as unknown as typeof fetch, apple)).toEqual(want);
    const broken = { developerToken: vi.fn(async () => { throw new Error("bad key"); }) };
    expect(await geocodeDropoff("900 Far Rd, Baker", appleRoute(found) as unknown as typeof fetch, broken)).toEqual(want);
  });

  it("a signer that throws never puts its own text (it can quote the private key) into the detail", async () => {
    const leaky = { developerToken: vi.fn(async () => { throw new Error("-----BEGIN PRIVATE KEY----- MIGTAgEAMBMG"); }) };
    const f = vi.fn(async () => new Response("Forbidden", { status: 403 }));
    const r = await geocodeDropoff("1 A St", f as unknown as typeof fetch, leaky);
    expect(r).toMatchObject({ miss: "unavailable" });
    expect((r as { detail: string }).detail).toContain("the MapKit developer token could not be signed");
    expect((r as { detail: string }).detail).not.toMatch(/PRIVATE KEY|MIGT/);
  });

  it("both unable to answer is 'unavailable' naming both reasons, never 'not found'", async () => {
    const f = vi.fn(async (u: string) => new Response("Forbidden", { status: String(u).includes("nominatim") ? 403 : 500 }));
    const r = await geocodeDropoff("1 A St", f as unknown as typeof fetch, apple);
    expect(r).toMatchObject({ miss: "unavailable", status: 403 });
    expect((r as { detail: string }).detail).toMatch(/Apple Maps token HTTP 500; Nominatim: HTTP 403/);
  });
});

describe("a thrown fetch never puts the typed address in detail (Q2493)", () => {
  const quoting = vi.fn(async (u: string) => {
    throw new TypeError(`error sending request for url (${u}): connection refused`);
  });
  it("Nominatim: detail is the error's name only", async () => {
    const r = await geocodeDropoff("7 Secret Ln, Baker LA", quoting as unknown as typeof fetch);
    expect(r).toEqual({ miss: "unavailable", status: null, detail: "threw TypeError" });
  });
  it("Apple Maps then Nominatim: neither part carries the address", async () => {
    let n = 0;
    const f = vi.fn(async (u: string) => {
      n += 1;
      if (n === 1) return new Response(JSON.stringify({ accessToken: "t" }), { status: 200 });
      throw new TypeError(`error sending request for url (${u})`);
    });
    const r = await geocodeDropoff("7 Secret Ln, Baker LA", f as unknown as typeof fetch, { developerToken: async () => "jwt" });
    expect(JSON.stringify(r)).not.toMatch(/Secret|Baker/);
    expect(r).toMatchObject({ miss: "unavailable" });
  });
});

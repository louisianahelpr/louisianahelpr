/**
 * The server side of the address lookup: Apple Maps, with how precise the match was, and nothing carrying the address.
 *
 * @mutate supabase/functions/_shared/geocodeAddressPoint.ts |   if (!Array.isArray(results)) return { result: "unavailable", status: null }; |   if (!Array.isArray(results)) return { result: "not_found" };
 * @mutate supabase/functions/_shared/geocodeAddressPoint.ts |     if (!res.ok) return { result: "unavailable", status: res.status }; |     if (!res.ok) return { result: "not_found" };
 * @mutate supabase/functions/geocode-address/index.ts |   if (authError \|\| !authData?.user) return errorResponse("not_authenticated", 401, corsHeadersFull); |
 * @mutate supabase/functions/geocode-address/index.ts |   if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeadersFull); |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { geocodeAddressPoint } from "../../supabase/functions/_shared/geocodeAddressPoint";
import { loadEdgeFunction } from "./edge/harness";
import { resetEnv, setEnv } from "./edge/mocks/deno-runtime";
import { resetSupabaseMock, scenario } from "./edge/mocks/supabase";
import { rateLimitState, resetSharedMocks } from "./edge/mocks/shared";

const TYPED = "101 Sample Bayou Rd, Exampleville, LA 70000";
const dev = async () => "dev-jwt";
function apple(geocode: unknown, status = 200) {
  return vi.fn(async (u: string) => (String(u).endsWith("/v1/token")
    ? new Response(JSON.stringify({ accessToken: "a" }), { status: 200 })
    : new Response(JSON.stringify(geocode), { status }))) as unknown as typeof fetch;
}
const row = (over: Record<string, unknown> = {}) => ({
  coordinate: { latitude: 30.5, longitude: -92.1 },
  structuredAddress: { subThoroughfare: "101", thoroughfare: "Sample Bayou Rd", locality: "Exampleville", administrativeAreaCode: "LA", postCode: "70000", ...over },
});

describe("geocodeAddressPoint", () => {
  it("the house is exact", async () => {
    expect(await geocodeAddressPoint(TYPED, dev, apple({ results: [row()] }))).toEqual({ result: "found", lat: 30.5, lng: -92.1, precision: "exact" });
  });
  it("Apple's answer without the house is street, or town, and never exact", async () => {
    expect(await geocodeAddressPoint(TYPED, dev, apple({ results: [row({ subThoroughfare: undefined })] }))).toMatchObject({ precision: "street" });
    expect(await geocodeAddressPoint(TYPED, dev, apple({ results: [row({ subThoroughfare: undefined, thoroughfare: undefined })] }))).toMatchObject({ precision: "town" });
  });
  it("another state is not found; so is an empty list", async () => {
    expect(await geocodeAddressPoint(TYPED, dev, apple({ results: [row({ administrativeAreaCode: "TX" })] }))).toEqual({ result: "not_found" });
    expect(await geocodeAddressPoint(TYPED, dev, apple({ results: [] }))).toEqual({ result: "not_found" });
  });
  it("a refusal, a body with no list or a dead connection is unavailable, and holds no error text", async () => {
    expect(await geocodeAddressPoint(TYPED, dev, apple({}, 429))).toEqual({ result: "unavailable", status: 429 });
    expect(await geocodeAddressPoint(TYPED, dev, apple({ error: "x" }))).toEqual({ result: "unavailable", status: null });
    const boom = vi.fn(async () => { throw new Error(`failed for ${TYPED}`); }) as unknown as typeof fetch;
    expect(JSON.stringify(await geocodeAddressPoint(TYPED, dev, boom))).not.toContain("Sample");
  });
});

describe("the geocode-address function", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "s" });
  });
  const post = async () => {
    const fn = await loadEdgeFunction("geocode-address");
    return fn.fetch(fn.request({ method: "POST", body: { address: TYPED }, headers: { Authorization: "Bearer t" } }));
  };

  it("is rate limited", async () => {
    rateLimitState.allowed = false;
    rateLimitState.retryAfter = 30;
    expect((await post()).status).toBe(429);
  });
  it("is signed-in only", async () => {
    scenario.authUser = null;
    expect((await post()).status).toBe(401);
  });
  it("without the key it says unavailable, and logs no address", async () => {
    scenario.authUser = { id: "u1" };
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("Sample");
    expect(JSON.stringify([...err.mock.calls, ...log.mock.calls])).not.toContain("Sample");
    err.mockRestore();
    log.mockRestore();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { composeJobAddress, geocodeAddress } from "./geocode";

describe("composeJobAddress", () => {
  it("formats full address as 'street, city, state zip'", () => {
    expect(
      composeJobAddress({
        streetAddress: "123 Main St",
        city: "Baton Rouge",
        state: "LA",
        zipCode: "70801",
      }),
    ).toBe("123 Main St, Baton Rouge, LA 70801");
  });

  it("drops empty segments", () => {
    expect(
      composeJobAddress({
        streetAddress: "456 Oak Ave",
        city: "New Orleans",
        state: "LA",
        zipCode: "",
      }),
    ).toBe("456 Oak Ave, New Orleans, LA");
  });

  it("trims whitespace from each segment", () => {
    expect(
      composeJobAddress({
        streetAddress: "  789 Bourbon  ",
        city: "  NOLA  ",
        state: "  LA  ",
        zipCode: "  70130  ",
      }),
    ).toBe("789 Bourbon, NOLA, LA 70130");
  });

  it("handles all-null input gracefully", () => {
    expect(
      composeJobAddress({
        streetAddress: null,
        city: null,
        state: null,
        zipCode: null,
      }),
    ).toBe("");
  });

  it("handles partial input (city + state only)", () => {
    expect(
      composeJobAddress({
        city: "Lafayette",
        state: "LA",
      }),
    ).toBe("Lafayette, LA");
  });

  it("collapses state-zip group cleanly when only one is present", () => {
    expect(
      composeJobAddress({
        streetAddress: "123 Main",
        city: "Houma",
        state: "LA",
      }),
    ).toBe("123 Main, Houma, LA");
    expect(
      composeJobAddress({
        streetAddress: "123 Main",
        city: "Houma",
        zipCode: "70360",
      }),
    ).toBe("123 Main, Houma, 70360");
  });
});

/**
 * `composeJobAddress` was the only thing this file tested. The half that
 * decides WHERE A JOB IS — and therefore which helprs see it, how far away
 * every card says it is, and where the map pin drops — is `geocodeAddress`,
 * and it had no test at all.
 *
 * Nominatim answers `{ lat, lon }`. The mapping onto `{ latitude, longitude }`
 * is two assignments on one line and a swap survives every plausibility check
 * you could apply to a Louisiana job: 30.45 / -91.19 swapped is -91.19 / 30.45,
 * which parses, is finite, and is a point in the South Atlantic. Nothing
 * downstream would refuse it.
 */
const okResponse = (rows: unknown) => ({ ok: true, json: async () => rows });

describe("geocodeAddress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps Nominatim's lat/lon onto latitude/longitude WITHOUT swapping them", async () => {
    const fetchMock = vi.fn(async () => okResponse([{ lat: "30.4515", lon: "-91.1871" }]));
    vi.stubGlobal("fetch", fetchMock);

    // Both components differ in magnitude AND sign, so a swap, a sign flip and
    // a transposition each produce a different pair.
    await expect(geocodeAddress("123 Main St, Baton Rouge, LA 70801")).resolves.toEqual({
      latitude: 30.4515,
      longitude: -91.1871,
    });
  });

  it("asks Nominatim for one US result", async () => {
    const fetchMock = vi.fn(async (_url: string) => okResponse([{ lat: "30.4515", lon: "-91.1871" }]));
    vi.stubGlobal("fetch", fetchMock);

    await geocodeAddress("123 Main St, Baton Rouge, LA 70801");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(url.searchParams.get("countrycodes")).toBe("us");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("q")).toBe("123 Main St, Baton Rouge, LA 70801");
  });

  it("answers null rather than a coordinate on every failure shape", async () => {
    // A wrong coordinate is worse than none: the job still posts without one,
    // it just does not appear on the map until it is filled in.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => [] })));
    await expect(geocodeAddress("123 Main St, Baton Rouge, LA")).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => okResponse([])));
    await expect(geocodeAddress("123 Main St, Baton Rouge, LA")).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => okResponse([{ lat: "not-a-number", lon: "-91.1871" }])));
    await expect(geocodeAddress("123 Main St, Baton Rouge, LA")).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(geocodeAddress("123 Main St, Baton Rouge, LA")).resolves.toBeNull();
  });

  it("never spends a Nominatim request on empty or near-empty input", async () => {
    const fetchMock = vi.fn(async () => okResponse([{ lat: "30", lon: "-91" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeAddress(null)).resolves.toBeNull();
    await expect(geocodeAddress(undefined)).resolves.toBeNull();
    await expect(geocodeAddress("")).resolves.toBeNull();
    await expect(geocodeAddress("LA")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The defect this file now exists to prevent: latitude and longitude crossing
// over on the way out of the geocoder, which puts every job posted with a
// street address somewhere it is not — and sends any helpr who hires on it to
// the wrong address.
// @mutate src/lib/geocode.ts | return { latitude: lat, longitude: lon }; | return { latitude: lon, longitude: lat };
// A job without coordinates is a job that is not on the map; a job with the
// FIRST match of an unscoped search is a job in the wrong state.
// @mutate src/lib/geocode.ts | url.searchParams.set("countrycodes", "us"); | url.searchParams.set("countrycodes", "de");

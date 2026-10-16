/**
 * currentPosition: the point for a photo taken "at the address", and one
 * refusal word (location_required) for location off or refused, on the web
 * and in the app.
 *
 * @mutate src/lib/declutter/position.ts |       () => reject(new Error("location_required")), |       (e) => reject(e),
 * @mutate src/lib/declutter/position.ts |       throw new Error("location_required", { cause: e }); |       throw e;
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ on: false, get: vi.fn() }));
vi.mock("@/lib/nativeInit", () => ({ get isNativePlatform() { return native.on; } }));
vi.mock("@capacitor/geolocation", () => ({ Geolocation: { getCurrentPosition: native.get } }));
import { currentPosition } from "./position";

const realGeo = navigator.geolocation;
afterEach(() => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: realGeo });
  native.on = false;
  native.get.mockReset();
});

describe("currentPosition (web)", () => {
  it("returns the device's point", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 30.45, longitude: -91.15 } } as GeolocationPosition),
    } });
    await expect(currentPosition()).resolves.toEqual({ lat: 30.45, lng: -91.15 });
  });

  it("refused or off: location_required (worded by declutterErrorMessage)", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      getCurrentPosition: (_ok: PositionCallback, no: PositionErrorCallback) => no({ code: 1 } as GeolocationPositionError),
    } });
    await expect(currentPosition()).rejects.toThrow("location_required");
  });
});

describe("currentPosition (app)", () => {
  it("returns the plugin's point", async () => {
    native.on = true;
    native.get.mockResolvedValue({ coords: { latitude: 30.5, longitude: -91.1 } });
    await expect(currentPosition()).resolves.toEqual({ lat: 30.5, lng: -91.1 });
  });

  it("a refused permission or a timeout is location_required, not the plugin's own words", async () => {
    native.on = true;
    native.get.mockRejectedValue(new Error("Location permission was denied"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(currentPosition()).rejects.toThrow(/^location_required$/);
  });
});

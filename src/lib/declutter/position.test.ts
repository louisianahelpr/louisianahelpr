import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
import { currentPosition } from "./position";

const realGeo = navigator.geolocation;
afterEach(() => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: realGeo });
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

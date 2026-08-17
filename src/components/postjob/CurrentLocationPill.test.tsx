// "Use my location" — regression cover for the reported "it doesn't work".
//
// The failure was not an error, it was SILENCE. reverseLookup is a callback
// API, and an unauthorized MapKit never invokes the callback at all: no error,
// no rejection, nothing. The promise wrapping it had no timeout, so it never
// settled — setLoading(false) never ran, the Nominatim fallback was never
// reached, and the button sat on "Locating…" forever with no toast.
//
// These tests pin the property that matters: the interaction ALWAYS finishes.
// Whatever the geocoders do, the user ends up either with an address or with
// an explanation — never stranded on a spinner.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

const mapKitStatus = vi.fn(() => "ready");
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => mapKitStatus() }));

// Run the native call immediately — the rationale dialog itself is covered
// elsewhere and would only add a click to every case here.
vi.mock("@/hooks/usePermissionRationale", () => ({
  usePermissionRationale: () => ({
    request: async (_kind: string, run: () => Promise<void> | void) => {
      await run();
      return true;
    },
  }),
}));

vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) } }));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

import { CurrentLocationPill } from "./CurrentLocationPill";

const BATON_ROUGE = { latitude: 30.4515, longitude: -91.1871 };

/** Geolocation that always succeeds — the geocoders are what vary here. */
function stubGeolocation() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: BATON_ROUGE }),
    },
  });
}

/** A MapKit whose Geocoder NEVER answers — the real-world unauthorized case. */
function stubSilentMapKit() {
  (window as { mapkit?: unknown }).mapkit = {
    Coordinate: function () {} as unknown as new (a: number, b: number) => unknown,
    Geocoder: function () {
      return { reverseLookup: () => { /* never calls back — this is the bug */ } };
    } as unknown as new () => unknown,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default to the config actually shipping today: VITE_APPLE_MAPKIT_TOKEN is
  // an empty string, so MapKit is skipped and only Nominatim runs. Tests that
  // exercise the MapKit hang opt into "ready" explicitly — they pay a real 8s
  // timeout, so only the one that must have it does.
  mapKitStatus.mockReturnValue("missing-token");
  stubGeolocation();
});

afterEach(() => {
  delete (window as { mapkit?: unknown }).mapkit;
  vi.unstubAllGlobals();
});

/** Click the pill and let its async chain run. */
async function tapAndSettle() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /use my current location/i }));
  });
}

describe("CurrentLocationPill", () => {
  it("recovers when MapKit never answers, instead of hanging on 'Locating…'", async () => {
    mapKitStatus.mockReturnValue("ready");
    stubSilentMapKit();
    // Nominatim answers, so a working fallback chain must still fill the form.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          address: { house_number: "100", road: "Main St", city: "Baton Rouge", state: "Louisiana", postcode: "70802" },
        }),
      })),
    );

    const onResolved = vi.fn();
    render(<CurrentLocationPill onResolved={onResolved} />);
    await tapAndSettle();

    // The whole point: this resolves at all. Before the fix it never did.
    await waitFor(
      () => expect(onResolved).toHaveBeenCalledWith(
        expect.objectContaining({ city: "Baton Rouge", state: "Louisiana" }),
      ),
      { timeout: 15_000 },
    );
    expect(screen.getByRole("button", { name: /use my current location/i })).not.toBeDisabled();
  }, 20_000); // real 8s MapKit budget elapses here — that IS the regression

  it("tells the user something when every geocoder fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    const onResolved = vi.fn();
    render(<CurrentLocationPill onResolved={onResolved} />);
    await tapAndSettle();

    // Silence is the bug. An explanation is the fix.
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /use my current location/i })).not.toBeDisabled();
  });

  it("rejects an out-of-state geocode rather than mislabelling it Louisiana", async () => {
    mapKitStatus.mockReturnValue("missing-token"); // the shipped config today
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          address: { city: "San Francisco", state: "California", postcode: "94108" },
        }),
      })),
    );

    const onResolved = vi.fn();
    render(<CurrentLocationPill onResolved={onResolved} />);
    await tapAndSettle();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Louisiana only/i)));
    expect(onResolved).not.toHaveBeenCalled();
  });
});

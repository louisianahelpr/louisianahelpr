/**
 * ONCE THE ARRIVAL IS SETTLED, THE HELPER PIN IS NOT DRAWN.
 *
 * Owner decision, 2026-09-19, from the browser-verification pass: with the
 * helper standing at the job the two pins coincide (measured at 375: helper
 * disc 32x32 centred at y=596, job drop-pin 24x32 at y=612) and the arrival
 * pill sits on top of both. All that survived of the helper pin was a ~6px
 * dark crescent between the pill and the orange drop-pin — it read as a
 * compositing smudge, not a marker. (`--olivewood` resolves near-black,
 * rgb(46,47,34), in the live theme, so the disc had no hue to separate it
 * from the pill's shadow either — pre-existing, and deliberately not touched.)
 *
 * The job pin plus its arrival label already say everything at that point, and
 * the helper pin's own accessible name there is merely "your Helpr's LAST
 * SHARED location" — so it goes, name and all.
 *
 * WHAT THIS FILE GUARDS, and why each half is here:
 *   1. UNIT — the settled case drops the helper annotation entirely (not
 *      merely fades it), so no orphan `role="img"` node and no focus stop is
 *      left behind; and the UN-ARRIVED case is unchanged to the attribute.
 *   2. INTEGRATION — rendering TrackingMap directly proves nothing about the
 *      tracker that mounts it. JobTracking owns the "is this arrival settled"
 *      decision and hands the map a label from a CLOSED SET; if its label ever
 *      stopped matching `DESTINATION_LABELS`, `safeDestinationLabel` would
 *      return null, the pill would vanish AND the helper pin would come back.
 *      So the second block drives the real JobTracking → lazy TrackingMap →
 *      MapKit path and counts the annotations MapKit was actually handed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  DESTINATION_LABELS,
  helperMarkerElement,
} from "./trackingMarkers";

// --- Mocks (the map's own) --------------------------------------------

const mapKitStatus = { value: "ready" as string };
vi.mock("@/hooks/useMapKitJs", () => ({
  useMapKitJs: () => mapKitStatus.value,
  useMapKitTokenSource: () => "server",
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

// --- Mocks (JobTracking's, so the tracker can render in jsdom) ---------

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
  hapticHeavy: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  const methods = [
    "from", "select", "eq", "neq", "in", "order", "limit", "insert", "update",
    "upsert", "delete", "gte", "lte", "is", "not", "filter",
  ];
  for (const m of methods) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
});

// --- A minimal window.mapkit (the same stub shape TrackingMap.test.ts uses) --

class Coordinate {
  constructor(public latitude: number, public longitude: number) {}
}
class CoordinateSpan {
  constructor(public latitudeDelta: number, public longitudeDelta: number) {}
}
class CoordinateRegion {
  constructor(public center: Coordinate, public span: CoordinateSpan) {}
}
interface StubAnnotation {
  coordinate: Coordinate;
  factory: () => HTMLElement;
  options?: Record<string, unknown>;
}

const maps: StubMap[] = [];

class StubMap {
  element: HTMLElement;
  region: CoordinateRegion;
  colorScheme: string;
  options: Record<string, unknown>;
  annotations: StubAnnotation[] = [];
  addAnnotations = vi.fn((a: StubAnnotation[]) => {
    this.annotations.push(...a);
  });
  removeAnnotations = vi.fn((a: StubAnnotation[]) => {
    this.annotations = this.annotations.filter((x) => !a.includes(x));
  });
  setRegionAnimated = vi.fn((r: CoordinateRegion, _animate?: boolean) => {
    this.region = r;
  });
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  destroy = vi.fn();
  constructor(el: HTMLElement, options: Record<string, unknown>) {
    this.element = el;
    this.options = options;
    this.region = options.region as CoordinateRegion;
    this.colorScheme = options.colorScheme as string;
    maps.push(this);
  }
}

function installMapKit() {
  (window as unknown as { mapkit: unknown }).mapkit = {
    Map: StubMap,
    Coordinate,
    CoordinateSpan,
    CoordinateRegion,
    Annotation: class {
      constructor(
        public coordinate: Coordinate,
        public factory: () => HTMLElement,
        public options?: Record<string, unknown>,
      ) {}
    },
    FeatureVisibility: { Hidden: "hidden" },
  };
}

const HELPER = { lat: 30.2242, lng: -92.0198 };
const DEST = { lat: 30.2241, lng: -92.0198 };

beforeEach(() => {
  vi.clearAllMocks();
  maps.length = 0;
  mapKitStatus.value = "ready";
  document.documentElement.removeAttribute("data-theme");
  installMapKit();
  if (typeof (globalThis as { DOMPoint?: unknown }).DOMPoint !== "function") {
    (globalThis as { DOMPoint?: unknown }).DOMPoint = class {
      constructor(public x: number, public y: number) {}
    };
  }
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { mapkit?: unknown }).mapkit;
});

async function renderMap(props: Record<string, unknown> = {}) {
  const { TrackingMap } = await import("@/components/TrackingMap");
  return render(
    createElement(TrackingMap, {
      helperLat: HELPER.lat,
      helperLng: HELPER.lng,
      destLat: DEST.lat,
      destLng: DEST.lng,
      ...props,
    } as never),
  );
}

/** Every marker element MapKit would mount, built from its own factory. */
function markerElements(map: StubMap): HTMLElement[] {
  return map.annotations.map((a) => a.factory());
}

describe("TrackingMap — the helper pin once the arrival is settled", () => {
  for (const label of DESTINATION_LABELS) {
    it(`draws the job pin alone ("${label}")`, async () => {
      await renderMap({ destinationLabel: label, helperLive: false });
      await waitFor(() => expect(maps).toHaveLength(1));
      const map = maps[0];

      expect(map.annotations).toHaveLength(1);
      const [only] = map.annotations;
      expect(only.coordinate.latitude).toBe(DEST.lat);
      expect(only.coordinate.longitude).toBe(DEST.lng);

      const els = markerElements(map);
      // The pin that remains is the job pin, wearing the arrival label.
      expect(els[0].dataset.trackingMarker).toBe("destination");
      expect(els[0].querySelector("[data-arrival-label]")!.textContent).toBe(label);
      // NOTHING is left of the helper pin — not a hidden one, not a named one.
      expect(els.some((el) => el.dataset.trackingMarker === "helper")).toBe(false);
      expect(els.some((el) => /Helpr/.test(el.getAttribute("aria-label") ?? ""))).toBe(false);
      // …and therefore nothing announced or focusable for a pin that is gone.
      expect(els.filter((el) => el.getAttribute("role") === "img")).toHaveLength(1);
    });
  }

  it("a ping arriving after the arrival is settled moves nothing and throws nothing", async () => {
    const view = await renderMap({ destinationLabel: "Location confirmed", helperLive: false });
    await waitFor(() => expect(maps).toHaveLength(1));
    const map = maps[0];

    const { TrackingMap } = await import("@/components/TrackingMap");
    view.rerender(
      createElement(TrackingMap, {
        helperLat: 30.99,
        helperLng: -92.5,
        destLat: DEST.lat,
        destLng: DEST.lng,
        destinationLabel: "Location confirmed",
        helperLive: false,
      } as never),
    );

    // Still one pin, still the job's, and the camera still re-framed.
    expect(map.annotations).toHaveLength(1);
    expect(map.annotations[0].coordinate.latitude).toBe(DEST.lat);
    expect(map.setRegionAnimated).toHaveBeenCalled();
    expect(map.setRegionAnimated.mock.calls.every((c) => c[1] === false)).toBe(true);
  });

  it("un-arrived is UNCHANGED: helper pin drawn, named live, at its own coordinate", async () => {
    await renderMap({ destinationLabel: null, helperLive: true });
    await waitFor(() => expect(maps).toHaveLength(1));
    const map = maps[0];

    expect(map.annotations).toHaveLength(2);
    const [helper, destination] = map.annotations;
    expect(helper.coordinate.latitude).toBe(HELPER.lat);
    expect(helper.coordinate.longitude).toBe(HELPER.lng);
    expect(helper.options?.calloutEnabled).toBe(false);
    expect(helper.options?.enabled).toBe(false);
    expect(helper.options?.anchorOffset).toBeUndefined();
    expect(destination.coordinate.latitude).toBe(DEST.lat);

    // Byte-identical to the marker builder's own output — same disc, same
    // opacity, same name. (The builder itself is untouched by this change.)
    expect(helper.factory().outerHTML).toBe(helperMarkerElement(true).outerHTML);
  });

  it("an UNSETTLED arrival claim keeps the helper pin (the label is not one of the two facts)", async () => {
    // `claimed` — the helper says they are there and nothing has confirmed it.
    // JobTracking sends no label for that state; anything outside the closed
    // set is rejected by `safeDestinationLabel`, and the pin must survive it.
    await renderMap({ destinationLabel: "Arrival not confirmed", helperLive: false });
    await waitFor(() => expect(maps).toHaveLength(1));
    expect(maps[0].annotations).toHaveLength(2);
    expect(markerElements(maps[0])[0].getAttribute("aria-label")).toBe(
      "Your Helpr's last shared location",
    );
  });
});

// --- The wiring that mounts it ----------------------------------------

describe("the rendered tracker hands MapKit one pin once the arrival is settled", () => {
  const AT = "2026-09-14T15:00:00.000Z";

  async function renderTracker(props: Record<string, unknown>) {
    const { JobTracking } = await import("@/components/JobTracking");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          {createElement(JobTracking, {
            jobId: "job-1",
            helperId: "helper-1",
            helperName: "Hallie Helper",
            isHelper: false,
            isOwner: true,
            jobDateNeeded: "2026-09-14",
            jobStartTime: "09:00:00",
            helperConfirmedAt: AT,
            helperDayofConfirmedAt: AT,
            posterConfirmedAt: AT,
            helperOnTheWayAt: AT,
            helperArrivedAt: AT,
            jobLatitude: DEST.lat,
            jobLongitude: DEST.lng,
            ...props,
          } as never)}
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("GPS-verified arrival: the job pin, labelled, and no helper pin", async () => {
    await renderTracker({
      jobStatus: "in_progress",
      helperArrivalVerifiedAt: AT,
      initialTracking: {
        id: "t-1",
        status: "arrived",
        latitude: HELPER.lat,
        longitude: HELPER.lng,
        eta_minutes: null,
        updated_at: AT,
      },
    });
    // The map is a lazy chunk behind Suspense.
    await waitFor(() => expect(maps).toHaveLength(1));
    const map = maps[0];
    await waitFor(() => expect(map.annotations).toHaveLength(1));
    const el = map.annotations[0].factory();
    expect(el.dataset.trackingMarker).toBe("destination");
    expect(el.getAttribute("aria-label")).toBe("The job location · Location confirmed");
  });

  it("still en route: the tracker's own map keeps both pins", async () => {
    await renderTracker({
      jobStatus: "in_progress",
      initialTracking: {
        id: "t-1",
        status: "on_the_way",
        latitude: HELPER.lat + 0.05,
        longitude: HELPER.lng,
        eta_minutes: 12,
        updated_at: AT,
      },
    });
    await waitFor(() => expect(maps).toHaveLength(1));
    const map = maps[0];
    await waitFor(() => expect(map.annotations).toHaveLength(2));
    expect(map.annotations[0].factory().getAttribute("aria-label")).toBe(
      "Your Helpr's current location",
    );
  });
});

// Proof this guard can fail: rebuild the helper annotation unconditionally —
// the exact pre-2026-09-19 behaviour — and the settled cases see two pins.
// @mutate src/components/TrackingMap.tsx | const helper = labelled | const helper = false

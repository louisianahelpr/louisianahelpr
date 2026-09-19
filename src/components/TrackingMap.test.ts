/**
 * TrackingMap — Apple MapKit JS (ported off Leaflet, owner 2026-09-19).
 *
 * Three things this file is the guard for:
 *
 *   1. VN-20 — the settled arrival fact is drawn ON the job pin, from a CLOSED
 *      SET of labels. It used to be interpolated into a Leaflet divIcon HTML
 *      string; it is `textContent` on a real DOM node now, and the closed set
 *      stays as the product contract and as defence in depth.
 *   2. ACCESSIBLE NAMES — both pins are named, and (unlike BrowseMap's pins)
 *      neither is a control or a tab stop, because activating them does
 *      nothing. The Leaflet version shipped two UNNAMED focusable buttons
 *      (docs/OPEN.md 2026-09-14); this is the runtime half of the source-grep
 *      guard in src/test/mapMarkerAccessibleName.test.ts.
 *   3. THE DEGRADED PATH — MapKit is a script from Apple's CDN, so "the map
 *      didn't load" is a first-class state: the frame still draws, it says so,
 *      and it keeps the arrival fact that JobTracking's status line has
 *      already handed over to the job pin.
 *
 * No JSX (this file is `.ts`) — `createElement` does the same job.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";

import {
  destinationMarkerElement,
  destinationMarkerName,
  helperMarkerElement,
  helperMarkerName,
  safeDestinationLabel,
} from "./trackingMap/trackingMarkers";

// --- Mocks ------------------------------------------------------------

const mapKitStatus = { value: "ready" as string };
vi.mock("@/hooks/useMapKitJs", () => ({
  useMapKitJs: () => mapKitStatus.value,
  useMapKitTokenSource: () => "server",
}));

const reported = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => reported(...args),
}));

// --- A minimal window.mapkit ------------------------------------------

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
/** Set to make the Map constructor throw, standing in for a MapKit that
 *  loaded but cannot build a map (the "construction threw" degraded path). */
const constructorThrows = { value: false };

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
  // MapKit's real signature is setRegionAnimated(region, animate) — the stub
  // must take both, or `c[1]` below is a compile error against a 1-tuple and
  // the "never animated" assertion cannot be written at all.
  setRegionAnimated = vi.fn((r: CoordinateRegion, _animate?: boolean) => {
    this.region = r;
  });
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  destroy = vi.fn();
  constructor(el: HTMLElement, options: Record<string, unknown>) {
    if (constructorThrows.value) throw new Error("MapKit said no");
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

const HELPER = { lat: 30.45, lng: -91.18 };
const DEST = { lat: 30.51, lng: -91.11 };

async function renderMap(props: Record<string, unknown> = {}) {
  const { TrackingMap } = await import("./TrackingMap");
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

beforeEach(() => {
  vi.clearAllMocks();
  maps.length = 0;
  mapKitStatus.value = "ready";
  constructorThrows.value = false;
  document.documentElement.removeAttribute("data-theme");
  installMapKit();
  // jsdom ships no DOMPoint, and the destination pin's anchor offset is the
  // thing that puts its TIP on the coordinate — stub it so that branch runs.
  if (typeof (globalThis as { DOMPoint?: unknown }).DOMPoint !== "function") {
    (globalThis as { DOMPoint?: unknown }).DOMPoint = class {
      constructor(public x: number, public y: number) {}
    };
  }
});

afterEach(() => {
  delete (window as unknown as { mapkit?: unknown }).mapkit;
});

// --- Markers ----------------------------------------------------------

describe("TrackingMap destination marker", () => {
  it("draws no label when there is no settled arrival", () => {
    const el = destinationMarkerElement(null);
    expect(el.querySelector("[data-arrival-label]")).toBeNull();
    expect(el.getAttribute("aria-label")).toBe("The job location");
  });

  it("draws the arrival label on the pin and names it for screen readers", () => {
    const el = destinationMarkerElement("Location confirmed");
    const pill = el.querySelector("[data-arrival-label]");
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toBe("Location confirmed");
    expect(el.getAttribute("aria-label")).toBe("The job location · Location confirmed");
  });

  it("refuses any string outside the fixed label set", () => {
    const el = destinationMarkerElement("<img src=x onerror=alert(1)>");
    expect(el.querySelector("[data-arrival-label]")).toBeNull();
    expect(el.innerHTML).not.toContain("onerror");
    expect(el.querySelector("img")).toBeNull();
    expect(el.getAttribute("aria-label")).toBe("The job location");
    expect(safeDestinationLabel("<img src=x onerror=alert(1)>")).toBeNull();
    expect(destinationMarkerName("<img src=x onerror=alert(1)>")).toBe("The job location");
  });
});

describe("TrackingMap helper marker", () => {
  it("names a live position only while en route; after arrival it is the last ping", () => {
    expect(helperMarkerElement(true).getAttribute("aria-label")).toBe(
      "Your Helpr's current location",
    );
    expect(helperMarkerElement(false).getAttribute("aria-label")).toBe(
      "Your Helpr's last shared location",
    );
    expect(helperMarkerName(true)).toBe("Your Helpr's current location");
  });
});

describe("TrackingMap markers are named, but are not controls", () => {
  // The Leaflet version put two UNNAMED role="button" nodes in the tab order.
  // Both halves of that are regressions: an unnamed marker, OR a marker that
  // is a focus stop for an action that does not exist.
  for (const [what, el] of [
    ["helper", helperMarkerElement(true)],
    ["destination", destinationMarkerElement("Location confirmed")],
  ] as const) {
    it(`${what}: role=img, a real name, and no tab stop`, () => {
      expect(el.getAttribute("role")).toBe("img");
      expect(el.getAttribute("aria-label")).toBeTruthy();
      expect(el.getAttribute("role")).not.toBe("button");
      expect(el.tabIndex).toBe(-1);
      // The SVG itself must not be announced separately or focusable.
      const svg = el.querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
    });
  }
});

// --- The MapKit path --------------------------------------------------

describe("TrackingMap on MapKit", () => {
  it("builds one static, non-hijacking map and pins both points", async () => {
    await renderMap({ destinationLabel: null, helperLive: true });
    await waitFor(() => expect(maps).toHaveLength(1));
    const map = maps[0];

    // Static: a 180px map inside a scrolling card must never eat the page
    // scroll (Leaflet's `scrollWheelZoom={false}`, and MapKit has no separate
    // wheel flag) and must show no chrome.
    expect(map.options.isZoomEnabled).toBe(false);
    expect(map.options.isScrollEnabled).toBe(false);
    expect(map.options.isRotationEnabled).toBe(false);
    expect(map.options.showsZoomControl).toBe(false);
    expect(map.options.showsUserLocationControl).toBe(false);

    expect(map.annotations).toHaveLength(2);
    const [helper, destination] = map.annotations;
    expect(helper.coordinate.latitude).toBe(HELPER.lat);
    expect(helper.coordinate.longitude).toBe(HELPER.lng);
    expect(destination.coordinate.latitude).toBe(DEST.lat);
    expect(destination.coordinate.longitude).toBe(DEST.lng);

    // The elements MapKit will mount are the real marker elements.
    expect(helper.factory().getAttribute("aria-label")).toBe("Your Helpr's current location");
    expect(destination.factory().getAttribute("aria-label")).toBe("The job location");

    // Neither pin opens a callout, and neither responds to interaction.
    for (const a of map.annotations) {
      expect(a.options?.calloutEnabled).toBe(false);
      expect(a.options?.enabled).toBe(false);
    }
    // The destination's coordinate is its TIP: MapKit centres an element on
    // its coordinate, so it is lifted by half the pin height.
    expect((destination.options?.anchorOffset as { y: number }).y).toBe(-16);
    expect(helper.options?.anchorOffset).toBeUndefined();
  });

  it("frames both points with room to spare", async () => {
    await renderMap();
    await waitFor(() => expect(maps).toHaveLength(1));
    const { center, span } = maps[0].region;
    expect(center.latitude).toBeCloseTo((HELPER.lat + DEST.lat) / 2, 5);
    expect(center.longitude).toBeCloseTo((HELPER.lng + DEST.lng) / 2, 5);
    // Padded: the span is strictly wider than the gap between the two pins,
    // so neither sits on the frame's edge.
    expect(span.latitudeDelta).toBeGreaterThan(Math.abs(DEST.lat - HELPER.lat));
    expect(span.longitudeDelta).toBeGreaterThan(Math.abs(DEST.lng - HELPER.lng));
  });

  it("shifts the camera north when the job pin wears an arrival pill", async () => {
    const plain = await renderMap();
    await waitFor(() => expect(maps).toHaveLength(1));
    const plainCenter = maps[0].region.center.latitude;
    plain.unmount();

    maps.length = 0;
    await renderMap({ destinationLabel: "Location confirmed" });
    await waitFor(() => expect(maps).toHaveLength(1));
    // North of the un-labelled frame ⇒ both pins sit lower and the pill above
    // the job pin stays inside the 180px frame.
    expect(maps[0].region.center.latitude).toBeGreaterThan(plainCenter);
  });

  it("moves the existing pins as pings arrive instead of rebuilding them", async () => {
    const view = await renderMap();
    await waitFor(() => expect(maps).toHaveLength(1));
    const map = maps[0];
    const before = map.annotations.slice();

    const { TrackingMap } = await import("./TrackingMap");
    view.rerender(
      createElement(TrackingMap, {
        helperLat: 30.48,
        helperLng: -91.15,
        destLat: DEST.lat,
        destLng: DEST.lng,
      } as never),
    );

    expect(map.annotations).toEqual(before);
    expect(map.annotations[0].coordinate.latitude).toBe(30.48);
    expect(map.setRegionAnimated).toHaveBeenCalled();
    // Never animated: an animation that outlives its container is the crash
    // that put "_leaflet_pos" in error_logs 13 times.
    expect(map.setRegionAnimated.mock.calls.every((c) => c[1] === false)).toBe(true);
  });

  it("follows the app's theme", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    await renderMap();
    await waitFor(() => expect(maps).toHaveLength(1));
    // At CONSTRUCTION, not only via the later observer effect — otherwise a
    // dark-mode tracker paints a light map for a frame first.
    expect(maps[0].options.colorScheme).toBe("dark");
    expect(maps[0].colorScheme).toBe("dark");
  });

  it("destroys the map on unmount", async () => {
    const view = await renderMap();
    await waitFor(() => expect(maps).toHaveLength(1));
    view.unmount();
    expect(maps[0].destroy).toHaveBeenCalled();
  });
});

// --- The degraded path ------------------------------------------------

describe("TrackingMap when MapKit can't be used", () => {
  for (const status of ["missing-token", "error"]) {
    it(`says so instead of leaving a blank frame (${status})`, async () => {
      mapKitStatus.value = status;
      await renderMap();
      expect(await screen.findByTestId("tracking-map-unavailable")).toBeInTheDocument();
      expect(screen.queryByTestId("tracking-map-surface")).not.toBeInTheDocument();
      expect(maps).toHaveLength(0);
    });
  }

  it("keeps the settled arrival fact on screen when there is no pin to carry it", async () => {
    // JobTracking DROPS the arrival clause from its status line whenever the
    // map is shown (VN-20 / `arrivalOnMap`), so if the map goes quiet here the
    // fact leaves the screen entirely. It must not.
    mapKitStatus.value = "error";
    await renderMap({ destinationLabel: "Location confirmed" });
    expect(await screen.findByTestId("tracking-map-arrival-fallback")).toHaveTextContent(
      "Location confirmed",
    );
  });

  it("degrades rather than throwing when the map constructor fails", async () => {
    constructorThrows.value = true;
    await renderMap();
    expect(await screen.findByTestId("tracking-map-unavailable")).toBeInTheDocument();
    expect(reported).toHaveBeenCalled();
  });

  it("renders without throwing when the SDK never defines window.mapkit", async () => {
    delete (window as unknown as { mapkit?: unknown }).mapkit;
    const view = await renderMap();
    // Still the frame, still no crash — the map simply never draws.
    expect(view.container.querySelector("[data-testid='tracking-map-surface']")).not.toBeNull();
  });
});

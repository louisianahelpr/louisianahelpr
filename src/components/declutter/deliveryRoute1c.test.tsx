/**
 * Audit 1c (Declutter Helpr delivery on prod, 2026-10-29), My route:
 *   D3-2 (1c-h3-tab-p3-375): two pickups at one seller sent "900 North 3rd Street" as destination AND waypoint, and the
 *        screen said "Opens all 2 stops". Open in Maps never repeats a stop back to back.
 *   D3-9 (1c-h2-tab-p3-375, 1c-h5-tab-p3-1440): "Opens all 1 stop in this order"; one pin zoomed to the street; the
 *        "Take a photo" step showed on the map panel AND the stop card. Now "Opens the stop.", a minimum map span, and
 *        the photo step only on the stop card.
 *
 * @mutate src/lib/declutter/route.ts |   const unique = addressed.filter((a, i) => i === 0 \|\| !same(a, addressed[i - 1])); |   const unique = addressed;
 * @mutate src/components/declutter/DeliveryRoute.tsx |               : maps.count === 1 ? "Opens the stop." : `Opens all ${maps.count} stops in this order.`} |               : `Opens all ${maps.count} ${maps.count === 1 ? "stop" : "stops"} in this order.`}
 * @mutate src/components/declutter/DeliveryRouteMap.tsx |       map.current.showItems(pins, fitOptions(mk)); |       map.current.showItems(pins);
 * @mutate src/components/declutter/DeliveryRouteMap.tsx |   const pinned = useMemo(() => routeVisits(stops).map((v) => v[0]).filter((s) => s.lat !== null && s.lng !== null), [stops]); |   const pinned = useMemo(() => stops.filter((s) => s.lat !== null && s.lng !== null), [stops]);
 * @mutate src/components/declutter/DeliveryRoute.tsx |   const visits = routeVisits(stops); |   const visits = stops.map((s) => [s]);
 * @mutate src/lib/declutter/route.ts |     if (last && last[0].seq === s.seq) last.push(s); |     if (false) last.push(s);
 * @mutate src/components/declutter/DeliveryRoute.tsx | about {Math.ceil(s.leg_miles)} mi from | about {s.leg_miles} mi from
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RouteStop } from "@/lib/helprTasks/api";

const state = vi.hoisted(() => ({ route: null as unknown, shown: [] as { n: number; options: unknown }[] }));

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => ({ lat: 30.5, lng: -91.15 }) }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "ready" }));
vi.mock("@/lib/declutter/api", () => ({ photoPublicUrl: (p: string) => `https://cdn.test/${p}` }));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchMyRoute: async () => state.route,
  fetchRouteSuggestions: async () => ({ suggestions: [], reason: "none_near" }),
  markPickedUp: vi.fn(),
  markDelivered: vi.fn(),
  uploadTaskPhoto: vi.fn(),
}));

import { DeliveryRoute } from "./DeliveryRoute";
import { MIN_SPAN_DEG } from "./DeliveryRouteMap";
import { routeMapsUrl } from "@/lib/declutter/route";

// A stand-in MapKit JS runtime: records what each showItems call fits and with which options.
class Span { constructor(public lat: number, public lng: number) {} }
(window as unknown as { mapkit: unknown }).mapkit = {
  Coordinate: class { constructor(public latitude: number, public longitude: number) {} },
  CoordinateSpan: Span,
  Map: class {
    addAnnotations() {} removeAnnotations() {} addAnnotation() {} addOverlays() {} removeOverlays() {}
    showItems(items: unknown[], options?: unknown) { state.shown.push({ n: items.length, options }); }
  },
  MarkerAnnotation: class { constructor(public coordinate: unknown) {} },
  Style: class {},
  FeatureVisibility: { Hidden: "hidden" },
};

const stop = (over: Partial<RouteStop>): RouteStop => ({
  seq: 1, task_id: "t1", kind: "pickup", status: "accepted", title: "Blue mug", size: "small", area: "Downtown",
  address: "900 North 3rd Street", lat: 30.45, lng: -91.18, place: "door", items: [], slot_start: "2026-10-31T14:00:00Z",
  slot_end: "2026-10-31T14:30:00Z", arrive_at: "2026-10-31T14:00:00Z", late: false, leg_miles: 3.3, address_shows_at: null, ...over,
});

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeliveryRoute userId="u1" where={null} /></QueryClientProvider>);
}

beforeEach(() => {
  state.shown = [];
});

describe("My route (audit 1c D3-2, D3-9)", () => {
  it("D3-2: Open in Maps never repeats a stop back to back; a stop visited again later is kept", () => {
    const twice = routeMapsUrl([{ address: "900 North 3rd Street" }, { address: null }, { address: "900 north 3rd  street" }, { address: "22 Buyer Ln" }]);
    expect(twice?.count).toBe(2);
    expect(twice?.href).toContain(`destination=${encodeURIComponent("22 Buyer Ln")}`);
    expect(twice?.href).toContain(`waypoints=${encodeURIComponent("900 North 3rd Street")}&`.replace(/&$/, ""));
    expect(twice?.href.split(encodeURIComponent("900 North 3rd Street")).length).toBe(2);
    const loop = routeMapsUrl([{ address: "A St" }, { address: "B St" }, { address: "A St" }]);
    expect(loop?.count).toBe(3);
  });

  it("D3-2 + D3-9: two pickups at one seller with the drop-off hidden open ONE stop, said as 'Opens the stop.'", async () => {
    state.route = { miles: 3.3, drive_minutes: 20, finish_at: null, stops: [
      stop({ seq: 1, task_id: "t1" }),
      stop({ seq: 2, task_id: "t1", kind: "dropoff", address: null, lat: null, lng: null, area: "Baker", address_shows_at: "2026-10-31T12:00:00Z" }),
      stop({ seq: 3, task_id: "t2", title: "Brass lamp" }),
    ] };
    show();
    const link = await screen.findByRole("link", { name: /Open in Maps/ });
    expect(link.getAttribute("href")).toContain(`destination=${encodeURIComponent("900 North 3rd Street")}`);
    expect(link.getAttribute("href")).not.toContain("waypoints=");
    expect(screen.getByText(/Opens the stop\./)).toBeInTheDocument();
    expect(screen.queryByText(/Opens all 1 stop/)).toBeNull();
  });

  it("D3-2: pickups the server joined (one seq) are one visit: one card, one pin, counted once, each with its own photo step", async () => {
    state.route = { miles: 3.3, drive_minutes: 20, finish_at: null, stops: [
      stop({ seq: 1, task_id: "t1", leg_miles: 3.3 }),
      stop({ seq: 1, task_id: "t2", title: "Brass lamp", leg_miles: 0, address: "902 North 3rd Street" }),
      stop({ seq: 2, task_id: "t1", kind: "dropoff", address: "22 Buyer Ln", lat: 30.5, lng: -91.1, place: "door" }),
      stop({ seq: 3, task_id: "t2", kind: "dropoff", title: "Brass lamp", address: "33 Buyer Ln", lat: 30.6, lng: -91.1, place: "door" }),
    ] };
    show();
    const list = await screen.findByRole("list", { name: "Stops in order" });
    expect(screen.getByText(/3 stops · about 4 mi/)).toBeInTheDocument();
    const cards = within(list).getAllByRole("listitem").filter((li) => li.parentElement === list);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent("Pick up 2 deliveries here");
    expect(cards[0]).toHaveTextContent("Blue mug");
    expect(cards[0]).toHaveTextContent("Brass lamp");
    // @mutate src/components/declutter/DeliveryRoute.tsx |           {n > 0 && s.address && s.address !== stop.address && | {false &&
    expect(cards[0]).toHaveTextContent("902 North 3rd Street");
    // D3-9: the same whole-mile rounding as the delivery's own quote: 3.3 reads 4, and a joined pickup has no leg.
    expect(cards[0]).toHaveTextContent("about 4 mi from you");
    expect(within(cards[0]).getByLabelText("Picked up: a photo of the item, taken here (Blue mug, stop 1)")).toBeInTheDocument();
    expect(within(cards[0]).getByLabelText("Picked up: a photo of the item, taken here (Brass lamp, stop 1)")).toBeInTheDocument();
    // One pin for the visit: 3 pins, not 4.
    await waitFor(() => expect(state.shown.length).toBeGreaterThan(0));
    expect(state.shown[0].n).toBe(3);
  });

  it("D3-9: the map never zooms closer than the minimum span, and the photo step shows once (on the stop card)", async () => {
    state.route = { miles: 3.3, drive_minutes: 20, finish_at: null, stops: [stop({ seq: 1 })] };
    show();
    await waitFor(() => expect(state.shown.length).toBeGreaterThan(0));
    for (const s of state.shown) {
      const span = (s.options as { minimumSpan?: Span } | undefined)?.minimumSpan;
      expect(span?.lat).toBe(MIN_SPAN_DEG);
      expect(span?.lng).toBe(MIN_SPAN_DEG);
    }
    expect(MIN_SPAN_DEG).toBeGreaterThan(0.01);
    expect(await screen.findByText(/Next: stop 1, pick up/)).toBeInTheDocument();
    // One photo input for the one stop: the stop card's.
    expect(screen.getAllByLabelText(/Picked up: a photo of the item/)).toHaveLength(1);
    const list = screen.getByRole("list", { name: "Stops in order" });
    expect(within(list).getByLabelText(/Picked up: a photo of the item/)).toBeInTheDocument();
  });
});

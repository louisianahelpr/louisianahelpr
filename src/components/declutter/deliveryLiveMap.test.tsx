/**
 * Delivery live map (owner 11-01 11:53 AM; 20261101184555). The seller sees the Helpr from Start until Picked up, the
 * buyer from Picked up until delivered, with an ETA (the server's RLS decides who may read; this side only asks in
 * that phase). The Helpr's route map sends the position only after Start, and Stop deletes it.
 * The SQL side (who reads, deleted on every status change, no history) is src/test/pglite/helprLivePosition.pglite.mjs.
 *
 * @mutate src/components/declutter/DeliveryLiveMap.tsx |   const live = (side === "seller" && status === "accepted") \|\| (side === "buyer" && status === "picked_up"); |   const live = status === "accepted" \|\| status === "picked_up";
 * @mutate src/components/declutter/DeliveryRouteMap.tsx |     if (!tracking \|\| !here \|\| Date.now() - lastShare.current < SHARE_MS) return; |     if (!here \|\| Date.now() - lastShare.current < SHARE_MS) return;
 * @mutate src/components/declutter/DeliveryRouteMap.tsx |       stopSharingPosition().catch((err) => console.warn("[route map] stop sharing", err)); |       void 0;
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       <DeliveryLiveMap taskId={taskId} side={side} status={v.status} who={who} /> |       {null}
 * @mutate src/components/declutter/DeliveryLiveMap.tsx |   const p = pos.data ?? last; |   const p = pos.data;
 * @mutate src/components/declutter/DeliveryLiveMap.tsx |   const paused = !pos.data; |   const paused = false;
 * @mutate src/components/declutter/DeliveryRouteMap.tsx |  they stop seeing you while you're in Apple Maps. |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import type { RouteStop } from "@/lib/helprTasks/api";

const state = vi.hoisted(() => ({
  pos: null as unknown,
  fetched: [] as string[],
  shared: [] as [number, number][],
  stopped: 0,
}));

vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "ready" }));
vi.mock("@/components/TrackingMap", () => ({
  TrackingMap: (p: { helperLat: number; destLat: number }) => <div data-testid="tracking-map">{`${p.helperLat}->${p.destLat}`}</div>,
}));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchLivePosition: async (id: string) => { state.fetched.push(id); return state.pos; },
  shareMyPosition: async (lat: number, lng: number) => { state.shared.push([lat, lng]); return 1; },
  stopSharingPosition: async () => { state.stopped++; },
}));

import { DeliveryLiveMap, etaWords } from "./DeliveryLiveMap";
import DeliveryRouteMap from "./DeliveryRouteMap";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const POS = { lat: 30.05, lng: -91.8, dest_lat: 30.07, dest_lng: -91.75, eta_minutes: 12, updated_at: new Date().toISOString() };

beforeEach(() => { state.pos = POS; state.fetched = []; state.shared = []; state.stopped = 0; });

describe("the seller's and the buyer's live map", () => {
  it("the seller sees the Helpr coming while the delivery is accepted, with an ETA", async () => {
    wrap(<DeliveryLiveMap taskId="t1" side="seller" status="accepted" who="Yusef" />);
    expect(await screen.findByText("Yusef is on the way to pick it up, about 12 min away.")).toBeTruthy();
    expect((await screen.findByTestId("tracking-map")).textContent).toBe("30.05->30.07");
  });
  it("the buyer sees the Helpr after Picked up", async () => {
    wrap(<DeliveryLiveMap taskId="t1" side="buyer" status="picked_up" who="Yusef" />);
    expect(await screen.findByText("Yusef is on the way with your item, about 12 min away.")).toBeTruthy();
  });
  it("outside each side's phase nothing is asked or shown", async () => {
    for (const [side, status] of [["buyer", "accepted"], ["seller", "picked_up"], ["buyer", "delivered"], ["seller", "open"]] as const) {
      const { container, unmount } = wrap(<DeliveryLiveMap taskId="t1" side={side} status={status} who="Yusef" />);
      await new Promise((r) => setTimeout(r, 20));
      expect(container.textContent).toBe("");
      unmount();
    }
    expect(state.fetched).toEqual([]);
  });
  it("no row (not started, stopped, or stale) shows nothing", async () => {
    state.pos = null;
    const { container } = wrap(<DeliveryLiveMap taskId="t1" side="buyer" status="picked_up" who="Yusef" />);
    await waitFor(() => expect(state.fetched).toEqual(["t1"]));
    expect(container.textContent).toBe("");
  });
  // A3-61: the Helpr opens Apple Maps to drive, the app stops sending, and the row goes. The viewer's map stayed blank
  // without a word; it now keeps the last fix and says the location is paused, with the last ETA.
  it("A3-61: a row that goes away after one was seen leaves the last fix, paused, with when it was seen", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    state.pos = { ...POS, updated_at: new Date(Date.now() - 3 * 60_000).toISOString() };
    render(<QueryClientProvider client={client}><DeliveryLiveMap taskId="t1" side="buyer" status="picked_up" who="Yusef" /></QueryClientProvider>);
    expect(await screen.findByText("Yusef is on the way with your item, about 12 min away.")).toBeTruthy();
    state.pos = null;
    await act(async () => { await client.refetchQueries({ queryKey: ["helpr-tasks", "live-position", "t1"] }); });
    expect(await screen.findByText(/^Yusef's location paused · last seen [34] min ago$/)).toBeTruthy();
    expect(screen.getByText("When last seen, about 12 min away. It comes back when Yusef opens Louisiana Helpr again.")).toBeTruthy();
    expect(screen.getByTestId("tracking-map").textContent).toBe("30.05->30.07");
  });
  it("A3-61: the Helpr is told viewers stop seeing them in Apple Maps", () => {
    const src = readFileSync("src/components/declutter/DeliveryRouteMap.tsx", "utf8");
    expect(src).toContain("they stop seeing you while you're in Apple Maps.");
  });
  it("ETA words", () => {
    expect([etaWords(0), etaWords(1), etaWords(12), etaWords(60), etaWords(75)]).toEqual(
      ["almost there", "almost there", "about 12 min away", "about 1 h away", "about 1 h 15 min away"]);
  });
  it("the order's delivery panel renders the live map", () => {
    const src = readFileSync("src/components/declutter/DeclutterDeliveryViews.tsx", "utf8");
    expect(src).toContain("<DeliveryLiveMap taskId={taskId} side={side} status={v.status} who={who} />");
  });
});

describe("the Helpr's route map shares only between Start and Stop", () => {
  const stop: RouteStop = {
    seq: 1, task_id: "t1", kind: "pickup", status: "accepted", title: "Lamp", size: "small", area: "New Iberia",
    address: "1 Main St", address_shows_at: null, lat: 30, lng: -91.8, place: "seller", items: [], slot_start: null,
    slot_end: null, arrive_at: new Date().toISOString(), late: false, leg_miles: 1,
  };
  beforeEach(() => {
    (window as unknown as { mapkit: unknown }).mapkit = {
      Coordinate: class { constructor(public latitude: number, public longitude: number) {} },
      Map: class { addAnnotations() {} removeAnnotations() {} addAnnotation() {} addOverlays() {} removeOverlays() {} showItems() {} },
      MarkerAnnotation: class { constructor(public coordinate: unknown) {} },
      Style: class {},
    };
    let cb: ((p: { coords: { latitude: number; longitude: number } }) => void) | null = null;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: (ok: typeof cb) => { cb = ok; setTimeout(() => cb?.({ coords: { latitude: 30.05, longitude: -91.8 } }), 0); return 1; },
        clearWatch: () => { cb = null; },
      },
    });
  });
  it("nothing is sent before Start; Start sends the position; Stop deletes it", async () => {
    render(<DeliveryRouteMap stops={[stop]} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(state.shared).toEqual([]);
    expect(screen.getByText(/the seller sees where you are until you pick it up, then the buyer until you deliver it/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start" })); });
    await waitFor(() => expect(state.shared).toEqual([[30.05, -91.8]]));
    expect(state.stopped).toBe(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop" })); });
    await waitFor(() => expect(state.stopped).toBe(1));
    // Nothing is sent again after Stop (the last known position stays on screen, never re-sent).
    await new Promise((r) => setTimeout(r, 30));
    expect(state.shared).toHaveLength(1);
  });
});

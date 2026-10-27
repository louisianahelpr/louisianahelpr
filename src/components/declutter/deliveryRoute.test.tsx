/**
 * "My route" (owner request 2026-10-27, multi-stop Declutter delivery): every stop in the order
 * helpr_my_route plans, what to do at each, Open in Maps for the whole ordered trip, the next turn
 * on the in-app map. The ordering, the address rule and the grants are proven in SQL
 * (src/test/pglite/helprMyRoute.pglite.mjs); this pins what the screen does with them.
 *
 * @mutate src/components/declutter/DeliveryRoute.tsx |               ? <span className="font-medium">{stop.address}</span> |               ? <span className="font-medium">{stop.area}</span>
 * @mutate src/lib/declutter/route.ts |   const addressed = stops.map((s) => s.address?.trim() ?? "").filter((a) => a.length > 0); |   const addressed = stops.map((s) => s.address?.trim() ?? "near the buyer");
 * @mutate src/lib/declutter/route.ts |   while (i < steps.length && metersBetween(here, steps[i].start) < STEP_REACHED_M) i++; |   while (false) i++;
 * @mutate src/components/declutter/StopActions.tsx |   if (stop.status !== "picked_up") return <p className="text-ds-13 text-muted-foreground">Pick this item up first.</p>; |   if (false) return null;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RouteStop } from "@/lib/helprTasks/api";

const state = { route: null as unknown, calls: [] as unknown[][] };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => ({ lat: 30.5, lng: -91.15 }) }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/lib/declutter/api", () => ({ photoPublicUrl: (p: string) => `https://cdn.test/${p}` }));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchMyRoute: async () => state.route,
  fetchRouteSuggestions: async () => ({ suggestions: [], reason: "none_near" }),
  markPickedUp: async (...a: unknown[]) => { state.calls.push(["picked_up", ...a]); },
  markDelivered: async (...a: unknown[]) => { state.calls.push(["delivered", ...a]); return { result: "delivered" }; },
  uploadTaskPhoto: async (_u: string, t: string) => `u1/task/${t}/photo.jpg`,
}));

import { DeliveryRoute } from "./DeliveryRoute";
import { MAX_MAPS_STOPS, nextStep, routeMapsUrl } from "@/lib/declutter/route";

const stop = (over: Partial<RouteStop>): RouteStop => ({
  seq: 1, task_id: "t1", kind: "pickup", status: "accepted", title: "Oak dresser", size: "small", area: "Mid City",
  address: "1 Seller St, Baton Rouge", lat: 30.45, lng: -91.15, place: "porch", items: [], slot_start: "2026-10-28T19:00:00Z",
  slot_end: "2026-10-28T19:30:00Z", arrive_at: "2026-10-28T19:00:00Z", late: false, leg_miles: 2.4, address_shows_at: null, ...over,
});

const ROUTE = {
  miles: 14.2, drive_minutes: 48, finish_at: "2026-10-28T20:10:00Z",
  stops: [
    stop({ seq: 1, task_id: "t9", kind: "dropoff", status: "picked_up", title: "Blue lamp", area: "Shenandoah", address: "9 Buyer Ln", place: "door", slot_start: null, slot_end: null }),
    stop({ seq: 2, items: [{ title: "Oak dresser", photo_path: "s/declutter/i/a.jpg" }, { title: "Mirror", photo_path: null }] }),
    stop({ seq: 3, kind: "dropoff", area: "Prairieville", address: "22 Buyer Ln, Prairieville", lat: 30.31, lng: -90.98, place: "door", slot_start: null, slot_end: null }),
    stop({ seq: 4, task_id: "t5", kind: "dropoff", area: "Baker", address: null, address_shows_at: "2026-10-28T21:00:00Z", lat: null, lng: null, place: "door", slot_start: null, slot_end: null }),
  ],
};

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><DeliveryRoute userId="u1" where={null} /></QueryClientProvider>) };
}
const jpeg = () => new File([new Uint8Array([1])], "p.jpg", { type: "image/jpeg" });

beforeEach(() => {
  state.route = ROUTE;
  state.calls = [];
});

describe("My route", () => {
  it("lists every stop in the planned order with its type, place, time and items", async () => {
    show();
    const list = await screen.findByRole("list", { name: "Stops in order" });
    const cards = within(list).getAllByRole("listitem").filter((li) => li.parentElement === list);
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveTextContent("Drop off");
    expect(cards[0]).toHaveTextContent("9 Buyer Ln");
    expect(cards[1]).toHaveTextContent("Pick up");
    expect(cards[1]).toHaveTextContent("On the seller's porch");
    expect(within(cards[1]).getByRole("img", { name: "Oak dresser" })).toHaveAttribute("src", "https://cdn.test/s/declutter/i/a.jpg");
    expect(cards[1]).toHaveTextContent("Mirror");
    expect(screen.getByText(/4 stops · about 14 mi · about 48 min/)).toBeInTheDocument();
  });

  it("a taken delivery's drop-off shows its address from the start (owner 2026-10-27) and waits for the pickup", async () => {
    show();
    const list = await screen.findByRole("list", { name: "Stops in order" });
    const third = within(list).getAllByRole("listitem").filter((li) => li.parentElement === list)[2];
    expect(third).toHaveTextContent("22 Buyer Ln, Prairieville");
    expect(third).toHaveTextContent("Pick this item up first.");
    expect(within(third).queryByRole("button", { name: "Left at the door" })).toBeNull();
  });

  it("Open in Maps carries every stop's address in order, and no point", async () => {
    show();
    const link = await screen.findByRole("link", { name: /Open in Maps/ });
    const href = link.getAttribute("href") ?? "";
    expect(href).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/);
    expect(href).toContain(`destination=${encodeURIComponent("22 Buyer Ln, Prairieville")}`);
    expect(href).toContain(`waypoints=${encodeURIComponent("9 Buyer Ln")}%7C${encodeURIComponent("1 Seller St, Baton Rouge")}`);
    expect(href).not.toMatch(/30\.45|-91\.15|30\.31|-90\.98|Baker/);
    expect(screen.getByText(/Opens all 3 stops in this order\. A drop-off joins once its address shows, 2 hours before its pickup\./)).toBeInTheDocument();
  });

  it("a new Helpr's drop-off more than 2 hours out shows its area and when the address shows (issue #3684)", async () => {
    show();
    const list = await screen.findByRole("list", { name: "Stops in order" });
    const fourth = within(list).getAllByRole("listitem").filter((li) => li.parentElement === list)[3];
    expect(fourth).toHaveTextContent(/Near Baker\. The drop-off address shows .*2 hours before the pickup\./);
  });

  it("the Picked up photo and Left at the door send the existing steps", async () => {
    show();
    const list = await screen.findByRole("list", { name: "Stops in order" });
    const cards = within(list).getAllByRole("listitem").filter((li) => li.parentElement === list);
    fireEvent.change(within(cards[1]).getByLabelText(/Picked up: a photo of the item/), { target: { files: [jpeg()] } });
    await waitFor(() => expect(state.calls).toContainEqual(["picked_up", "t1", "u1/task/t1/photo.jpg", { lat: 30.5, lng: -91.15 }]));
    const leave = within(cards[0]).getByRole("button", { name: "Left at the door" });
    expect(leave).toBeDisabled();
    fireEvent.change(within(cards[0]).getByLabelText("Photo at the drop-off address"), { target: { files: [jpeg()] } });
    fireEvent.click(leave);
    await waitFor(() => expect(state.calls).toContainEqual(["delivered", "t9", "u1/task/t9/photo.jpg", { lat: 30.5, lng: -91.15 }]));
  });

  it("with no map available it says so and Open in Maps still works", async () => {
    show();
    expect(await screen.findByText(/The map isn't available right now/)).toBeInTheDocument();
  });

  it("no stops: nothing shows", async () => {
    state.route = { stops: [], miles: 0, drive_minutes: 0, finish_at: null };
    const { container, qc } = show();
    // Wait on the QUERY (waitForEmptyIsVacuous): once the route read settles, an empty container is the
    // no-stops branch, not the first paint.
    await waitFor(() => {
      const entry = qc.getQueryCache().find({ queryKey: ["helpr-tasks", "route", null, null] });
      expect(entry?.state.status, "the route query never settled").toBe("success");
    });
    expect(screen.queryByText("Loading your route…")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("route helpers", () => {
  it("Open in Maps takes at most MAX_MAPS_STOPS stops and counts the rest", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ address: `${i} Main St` }));
    const r = routeMapsUrl(many);
    expect(r?.count).toBe(MAX_MAPS_STOPS);
    expect(r?.left_out).toBe(2);
    expect(r?.href).toContain(`destination=${encodeURIComponent("3 Main St")}`);
    expect(routeMapsUrl([{ address: null }])).toBeNull();
  });

  it("the next turn advances as the Helpr reaches each one", () => {
    const steps = [
      { instructions: "Head north on Oak St", start: { lat: 30.4, lng: -91.1 } },
      { instructions: "Turn right on Main St.", start: { lat: 30.41, lng: -91.1 } },
      { instructions: "Turn left on Elm St", start: { lat: 30.41, lng: -91.09 } },
    ];
    const a = nextStep(steps, 1, { lat: 30.4042, lng: -91.1 });
    expect(a).toEqual({ index: 1, line: "In 0.4 mi, turn right on Main St" });
    const b = nextStep(steps, a.index, { lat: 30.41, lng: -91.1 });
    expect(b.index).toBe(2);
    expect(b.line).toMatch(/^In 0\.6 mi, turn left on Elm St$/);
    expect(nextStep(steps, 2, { lat: 30.41, lng: -91.09 }).line).toBeNull();
  });
});

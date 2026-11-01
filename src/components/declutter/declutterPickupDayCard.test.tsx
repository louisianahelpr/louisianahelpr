/**
 * D-NEW11 (owner request 2026-10-29): the pickup-day card on Buying: one card with each of today's pickups, its place,
 * time, directions and "I'm on my way", and one route link for several. The server's side is
 * src/test/pglite/declutterOnMyWay.pglite.mjs.
 *
 * @mutate src/lib/declutter/pickupDay.ts |     if (day !== today) continue; |
 * @mutate src/lib/declutter/pickupDay.ts |     if (!booking \|\| order.status !== "paid" \|\| !PICKUP_KINDS.has(order.handover ?? "")) continue; |     if (!booking) continue;
 * @mutate src/lib/declutter/pickupDay.ts |   return out.sort((a, b) => at(a) - at(b)); |   return out;
 * @mutate src/lib/declutter/pickupDay.ts |     const said = booking.buyer_on_way_at ? ymd(new Date(booking.buyer_on_way_at)) === today : false; |     const said = !!booking.buyer_on_way_at;
 * @mutate src/components/declutter/DeclutterPickupDayCard.tsx |       {route && route.count > 1 && ( |       {route && (
 * @mutate src/components/declutter/DeclutterPickupDayCard.tsx |   if (sent \|\| go.isSuccess) return | if (go.isSuccess) return
 * @mutate src/components/declutter/DeclutterPickupDayCard.tsx |     queries: today.map((p) => p.order.handover === "meetup" |     queries: today.map((p) => p.order.handover === "never"
 * BUY-6: a porch pickup not out yet offers no "I'm on my way" or Directions, only "Not out yet".
 * @mutate src/components/declutter/DeclutterPickupDayCard.tsx |          const notOut = p.order.handover === "porch" && !porchRows[i]?.data?.set_out_at; |          const notOut = false;
 * @mutate src/components/declutter/DeclutterPickupDayCard.tsx |          const notOut = p.order.handover === "porch" && !porchRows[i]?.data?.set_out_at; |          const notOut = p.order.handover === "porch";
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyBooking } from "@/lib/declutter/handover";
import type { PickupOrderLike } from "@/lib/declutter/pickupDay";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  addressAsked: [] as string[],
  addressFails: false,
  errors: [] as string[],
  outAt: {} as Record<string, string | null>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (m: string) => state.errors.push(m) } }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async (id: string) => ({ order_id: id, set_out_at: state.outAt[id] ?? null }),
  onMyWay: async (id: string) => { state.calls.push(id); return "on_way"; },
  fetchItemAddress: async (id: string) => {
    state.addressAsked.push(id);
    if (state.addressFails) throw new Error("nope");
    return { pickup_address: `${id} Main St`, pickup_lat: 30, pickup_lng: -91 };
  },
}));
vi.mock("@/lib/declutter/meetup", () => ({
  fetchOrderMeetup: async () => ({ spot_name: "Central Library", spot_address: "7711 Goodwood Blvd", spot_lat: 30.44, spot_lng: -91.1 }),
  meetupMapUrl: (m: { spot_name: string }) => `https://maps.apple.com/?q=${encodeURIComponent(m.spot_name)}`,
}));

import { PickupDayCard } from "./DeclutterPickupDayCard";
import { pickupsToday } from "@/lib/declutter/pickupDay";
import { deviceLocalDateISO, deviceLocalShiftISO } from "@/test/helpers/deviceLocalDay";

const order = (id: string, handover: string, status = "paid"): PickupOrderLike => ({
  orderId: id, handover, status, lines: [{ item_id: `item-${id}`, item_title: `Thing ${id}` }],
});
const at = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const ymdToday = () => deviceLocalDateISO(0);
const booked = (id: string, over: Partial<MyBooking> = {}): MyBooking => ({
  order_id: id, slot_start: at(14), slot_end: at(15), porch_mode: null, porch_until: null, ...over,
});

function show(orders: PickupOrderLike[], bookings: MyBooking[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PickupDayCard orders={orders} bookings={bookings} /></QueryClientProvider>);
}

beforeEach(() => {
  state.calls = [];
  state.addressAsked = [];
  state.addressFails = false;
  state.errors = [];
  state.outAt = {};
});

describe("which orders are today's pickups", () => {
  it("only paid pickups booked today, in time order, a whole-day pickup last", () => {
    const orders = [order("late", "pickup_home"), order("porch", "porch"), order("early", "meetup"), order("tomorrow", "pickup_home"),
      order("helpr", "delivery"), order("done", "pickup_home", "handed_over"), order("unbooked", "pickup_home")];
    const tomorrow = deviceLocalShiftISO(1);
    const got = pickupsToday(orders, [
      booked("late", { slot_start: at(16) }), booked("porch", { pickup_day: ymdToday(), slot_start: at(9) }), booked("early", { slot_start: at(9) }),
      booked("tomorrow", { slot_start: tomorrow }), booked("helpr"), booked("done"),
    ]);
    expect(got.map((p) => p.order.orderId)).toEqual(["early", "late", "porch"]);
    // A floor, so an empty result can never pass this guard by accident.
    expect(got.length).toBeGreaterThan(2);
  });

  // NIGHT-BUYINGopenpr-1 (night audit 10-30): an order on hold never says "set off".
  // @mutate src/lib/declutter/pickupDay.ts |     if (held.has(order.orderId)) continue; |
  it("an order on hold (open problem) is left out", () => {
    const orders = [order("held", "pickup_home"), order("fine", "pickup_home")];
    const bookings = [booked("held", { slot_start: at(10) }), booked("fine", { slot_start: at(11) })];
    expect(pickupsToday(orders, bookings).map((p) => p.order.orderId)).toEqual(["held", "fine"]);
    expect(pickupsToday(orders, bookings, new Date(), new Set(["held"])).map((p) => p.order.orderId)).toEqual(["fine"]);
  });

  it("said yesterday is not said today", () => {
    const yesterday = deviceLocalShiftISO(-1);
    const [p] = pickupsToday([order("a", "pickup_home")], [booked("a", { buyer_on_way_at: yesterday })]);
    expect(p.onWay).toBe(false);
    const [q] = pickupsToday([order("a", "pickup_home")], [booked("a", { buyer_on_way_at: new Date().toISOString() })]);
    expect(q.onWay).toBe(true);
  });
});

describe("the pickup-day card", () => {
  it("nothing today: no card", () => {
    const { container } = show([order("a", "pickup_home")], [booked("a", { slot_start: new Date(Date.now() + 3 * 86_400_000).toISOString() })]);
    expect(container).toBeEmptyDOMElement();
  });

  it("one pickup: place, time, directions, I'm on my way, and no route", async () => {
    show([order("a", "pickup_home")], [booked("a")]);
    expect(screen.getByRole("heading", { name: "Your pickup today" })).toBeInTheDocument();
    expect(await screen.findByText("item-a Main St")).toBeInTheDocument();
    expect(screen.getByText(/^Today, /)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Directions" }).getAttribute("href")).toContain(encodeURIComponent("item-a Main St"));
    expect(screen.getByRole("button", { name: "I'm on my way" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Route for all/ })).toBeNull();
  });

  it("I'm on my way tells the server once, then says so; already said shows no button", async () => {
    show([order("a", "pickup_home")], [booked("a")]);
    fireEvent.click(screen.getByRole("button", { name: "I'm on my way" }));
    await waitFor(() => expect(state.calls).toEqual(["a"]));
    expect(await screen.findByRole("status")).toHaveTextContent("The seller knows you're on the way.");
    expect(screen.queryByRole("button", { name: "I'm on my way" })).toBeNull();
  });

  it("said earlier today: the card says so, with no button", async () => {
    show([order("a", "pickup_home")], [booked("a", { buyer_on_way_at: new Date().toISOString() })]);
    expect(screen.getByRole("status")).toHaveTextContent("The seller knows you're on the way.");
    expect(screen.queryByRole("button", { name: "I'm on my way" })).toBeNull();
  });

  it("several pickups: one route link through every place, in time order", async () => {
    show([order("b", "pickup_home"), order("a", "pickup_home")], [booked("b", { slot_start: at(16), slot_end: at(17) }), booked("a")]);
    expect(screen.getByRole("heading", { name: "Your 2 pickups today" })).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "Route for all 2" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain(`destination=${encodeURIComponent("item-b Main St")}`);
    expect(href).toContain(`waypoints=${encodeURIComponent("item-a Main St")}`);
    const items = within(screen.getByRole("region", { name: "Your pickups today" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Thing a");
  });

  it("a meetup shows the safe spot and never reads the seller's home address", async () => {
    show([order("m", "meetup")], [booked("m")]);
    expect(await screen.findByText("Central Library, 7711 Goodwood Blvd")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Directions" }).getAttribute("href")).toContain("Central%20Library");
    expect(state.addressAsked).toEqual([]);
  });

  it("a whole-day porch pickup says so", () => {
    show([order("p", "porch")], [booked("p", { pickup_day: ymdToday() })]);
    expect(screen.getByText("Today, any time")).toBeInTheDocument();
  });

  it("BUY-6: a porch pickup not out yet says so and offers no I'm on my way or Directions", async () => {
    show([order("p", "porch")], [booked("p", { pickup_day: ymdToday() })]);
    expect(await screen.findByText("Not out yet. Don't go until we tell you it's on the porch.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I'm on my way" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Directions" })).toBeNull();
  });

  it("BUY-6: once the seller's porch photo is in, I'm on my way and Directions come back", async () => {
    state.outAt = { p: new Date().toISOString() };
    show([order("p", "porch")], [booked("p", { pickup_day: ymdToday() })]);
    expect(await screen.findByRole("button", { name: "I'm on my way" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Directions" })).toBeInTheDocument();
    expect(screen.queryByText(/Not out yet/)).toBeNull();
  });

  it("a place that will not load says so, and I'm on my way still works", async () => {
    state.addressFails = true;
    show([order("a", "pickup_home")], [booked("a")]);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load the place.");
    expect(screen.getByRole("button", { name: "I'm on my way" })).toBeInTheDocument();
  });
});

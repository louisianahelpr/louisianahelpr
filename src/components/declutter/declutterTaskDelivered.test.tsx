/**
 * The Helpr's card after the drop-off (Declutter deep audit #40, 2026-10-28; still open in audit 3,
 * a3-44-helpr-dropoff-p1-390): once the drop-off photo was in and "Left at the door" sent, the card said nothing
 * until the buyer confirmed: no "Delivered, waiting for the buyer" line. It now says so. The toasts of both photo steps
 * are in deliveryRoute.test.tsx (the steps live on the route's stop card, audit 1c D3-9).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  view: null as unknown,
  mine: [] as unknown[],
  delivered: { result: "delivered" } as Record<string, unknown>,
  toasts: [] as string[],
}));

vi.mock("@/components/DateTimeField", () => ({ DateTimeField: () => null }));
vi.mock("sonner", () => ({ toast: { success: (m: string) => state.toasts.push(m), error: vi.fn() } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: undefined }) }));
vi.mock("@/components/payouts/useHiredPayoutPrompt", () => ({ useHiredPayoutPrompt: () => ({ open: false, offer: async () => true, close: () => {} }) }));
vi.mock("@/components/busyAreas/BusyAreasCard", () => ({ BusyAreasCard: () => null }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => ({ lat: 30.5, lng: -91.15 }) }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false, usePayoutSetupBlock: () => null }));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchTaskView: async () => state.view,
  fetchOpenTasks: async () => [],
  fetchMyTasks: async () => state.mine,
  fetchMyRoute: async () => ({ stops: [], miles: 0, drive_minutes: 0, finish_at: null }),
  fetchRouteSuggestions: async () => ({ suggestions: [], reason: "none_near" }),
  fetchMyVehicle: async () => ({ has_car: true, has_truck: false, second_person: false, photo_path: null }),
  fetchOpenCount: async () => null,
  taskPhotoUrl: async (p: string) => `https://signed.test/${p}`,
  acceptTask: async () => {},
  releaseTask: async () => ({ result: "released", strike: false }),
  markPickedUp: async () => {},
  markDelivered: async () => state.delivered,
  reportPickupNoShow: async () => {},
  saveVehicle: async () => {},
  uploadTaskPhoto: async (_u: string, t: string) => `u1/task/${t}/photo.jpg`,
  uploadVehiclePhoto: async () => "u1/vehicle/truck.jpg",
}));
vi.mock("@/lib/helprTasks/online", () => ({ fetchOnlineStatus: async () => null, isOnline: () => false, setOnline: vi.fn() }));
vi.mock("@/lib/declutter/deliveryRaise", () => ({ fetchDeliveryRaiseStatus: async () => null, startDeliveryRaise: vi.fn() }));
vi.mock("@/lib/declutter/deliveryTip", () => ({
  fetchMyPaidDeliveryTips: async () => [],
  fetchTipsOnMyDeliveries: async () => new Map(),
  startDeliveryTip: vi.fn(),
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn() }));
// A taken or picked-up delivery also draws these; each reads its own rows, which this file does not serve.
vi.mock("./DeclutterNoHelpr", async (orig) => ({ ...(await orig<object>()), HelprNoShowAnswer: () => null }));
vi.mock("./DeliveryCantFinish", async (orig) => ({ ...(await orig<object>()), HelprCantFinish: () => null }));
vi.mock("./DeliveryTalk", async (orig) => ({ ...(await orig<object>()), DeliveryTalkButton: () => null }));

import { DeliverView } from "./DeclutterDeliveryViews";

const TASK = { task_id: "t1", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA", trip_miles: 9,
  take_home_cents: 2620, pickup_slot_start: "2026-10-20T15:00:00Z", payout_status: null };
const VIEW = {
  task_id: "t1", source_kind: "declutter_delivery", source_id: "o1", role: "helpr", size: "small", title: "Lamp",
  pickup_area: "Mid-City", dropoff_area: "Baker, LA", trip_miles: 9, take_home_cents: 2620, pay_cents: null, fee_cents: null,
  open_until: "2026-10-18T15:00:00Z", latest_pickup_at: "2026-10-23T15:00:00Z", pickup_slot_start: "2026-10-20T15:00:00Z",
  accepted_at: null, picked_up_at: null, delivered_at: null, confirmed_at: null, confirmed_by: null, helpr_first_name: null,
  pickup_address: "1234 Example St", pickup_lat: null, pickup_lng: null, dropoff_address: "900 Far Rd", dropoff_lat: null,
  dropoff_lng: null, pickup_photo_path: null, dropoff_photo_path: null,
};

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeliverView /></QueryClientProvider>);
}

beforeEach(() => {
  state.toasts = [];
  state.delivered = { result: "delivered" };
});

describe("the Helpr's card after the drop-off (deep audit #40)", () => {
  // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       {t.status === "delivered" && ( |       {false && (
  // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |             <NextStep className="!text-sm" value={{ who: "you", text: "Pick it up from the seller", by: v.pickup_slot_start ? when(v.pickup_slot_start) : null }} /> |             null
  // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |             <NextStep className="!text-sm" value={{ who: "you", text: "Take it to the buyer and tap Left at the door" }} /> |             null
  it("the Helpr's next step on a taken delivery, then on the road (owner 11-01)", async () => {
    state.mine = [{ ...TASK, status: "accepted" }];
    state.view = { ...VIEW, status: "accepted", pickup_slot_start: "2037-10-20T15:00:00Z" };
    const a = show();
    const first = await screen.findByText("Next: pick it up from the seller");
    expect(first.closest("[data-next-step]")!.textContent).toMatch(/^Next: pick it up from the seller · \S/);
    a.unmount();
    state.mine = [{ ...TASK, status: "picked_up" }];
    state.view = { ...VIEW, status: "picked_up", picked_up_at: "2037-10-20T15:10:00Z" };
    show();
    expect(await screen.findByText("Next: take it to the buyer and tap Left at the door")).toBeInTheDocument();
  });

  it("delivered, not yet confirmed: the card says it is waiting for the buyer", async () => {
    state.mine = [{ ...TASK, status: "delivered" }];
    state.view = { ...VIEW, status: "delivered", delivered_at: "2026-10-20T16:00:00Z" };
    show();
    const line = await screen.findByText("Delivered. Waiting for the buyer to confirm it arrived.");
    // The shared next-step line (owner 11-01): whose move it is now, in a status region.
    expect(line.closest("[role=status]")).not.toBeNull();
    expect(line.closest("[data-next-step]")?.getAttribute("data-next-step")).toBe("them");
    // No photo step is offered again.
    expect(screen.queryByRole("button", { name: "Left at the door" })).toBeNull();
  });
});

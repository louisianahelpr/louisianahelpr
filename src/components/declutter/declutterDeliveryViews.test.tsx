/**
 * The Declutter Helpr-delivery screens (slice five, docs/specs/declutter-auctions.md
 * rows 24, 29-30, 40-43): what each STATE renders and what each button sends.
 * The shared task module's calls are stubbed; the backend proof is
 * src/test/pglite/declutterDelivery.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const canConfirm = side === "buyer" && (v.status === "picked_up" \|\| v.status === "delivered"); |   const canConfirm = v.status === "picked_up" \|\| v.status === "delivered";
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       {side === "buyer" && v.dropoff_code && ( |       {v.dropoff_code && (
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |                 disabled={deliver.isPending \|\| (v.status === "picked_up" && !dropPhoto) \|\| (v.status === "delivered" && code.length !== 4)} |                 disabled={deliver.isPending}
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       await reportPickupNoShow(t.task_id, path, await currentPosition()); |       await reportPickupNoShow(t.task_id, "", { lat: 0, lng: 0 });
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |         disabled={save.isPending \|\| (hasTruck && !photo && !vehicle.data?.photo_path)} onClick={() => save.mutate()}> |         disabled={save.isPending} onClick={() => save.mutate()}>
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  view: null as unknown,
  open: [] as unknown[],
  mine: [] as unknown[],
  vehicle: null as unknown,
  calls: [] as unknown[][],
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => ({ lat: 30.5, lng: -91.15 }) }));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchTaskView: async () => state.view,
  fetchOpenTasks: async () => state.open,
  fetchMyTasks: async () => state.mine,
  fetchMyVehicle: async () => state.vehicle,
  taskPhotoUrl: async (p: string) => { if (p.includes("broken")) throw new Error("photo_unavailable"); return `https://signed.test/${p}`; },
  acceptTask: async (...a: unknown[]) => { state.calls.push(["accept", ...a]); },
  releaseTask: async (...a: unknown[]) => { state.calls.push(["release", ...a]); return { result: "released", strike: false }; },
  markPickedUp: async (...a: unknown[]) => { state.calls.push(["picked_up", ...a]); },
  markDelivered: async (...a: unknown[]) => { state.calls.push(["delivered", ...a]); return { result: "confirmed" }; },
  reportPickupNoShow: async (...a: unknown[]) => { state.calls.push(["no_show", ...a]); },
  confirmReceived: async (...a: unknown[]) => { state.calls.push(["got_it", ...a]); },
  saveVehicle: async (...a: unknown[]) => { state.calls.push(["vehicle", ...a]); },
  uploadTaskPhoto: async (_u: string, t: string) => `u1/task/${t}/photo.jpg`,
  uploadVehiclePhoto: async () => "u1/vehicle/truck.jpg",
}));

import { DeliverView, OrderDeliveryPanel } from "./DeclutterDeliveryViews";

function show(el: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>);
}

const VIEW = {
  task_id: "t1", source_kind: "declutter_delivery", source_id: "o1", role: "customer", status: "open", size: "large",
  title: "Oak rocking chair", pickup_area: "Mid-City, Baton Rouge", dropoff_area: "Baker, LA", trip_miles: 9,
  take_home_cents: null, pay_cents: null, fee_cents: null, open_until: "2026-10-18T15:00:00Z", latest_pickup_at: "2026-10-23T15:00:00Z",
  pickup_slot_start: null, accepted_at: null, picked_up_at: null, delivered_at: null, confirmed_at: null, confirmed_by: null,
  helpr_first_name: null, pickup_address: null, pickup_lat: null, pickup_lng: null, dropoff_address: null, dropoff_lat: null,
  dropoff_lng: null, dropoff_code: null, code_locked: false, pickup_photo_path: null, dropoff_photo_path: null,
};
const jpeg = () => new File([new Uint8Array([1])], "p.jpg", { type: "image/jpeg" });

beforeEach(() => {
  state.view = null;
  state.open = [];
  state.mine = [];
  state.vehicle = null;
  state.calls = [];
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("OrderDeliveryPanel (the buyer's and the seller's card)", () => {
  it("waiting for a Helpr: the buyer is told the fallback (row 40)", async () => {
    state.view = VIEW;
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText(/Finding a Helpr\. If nobody takes it by/)).toBeInTheDocument();
    expect(screen.getByText(/delivery fee comes back and you pick it up/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
  });

  it("taken: the buyer sees the Helpr's first name, the pickup time and their drop-off code", async () => {
    state.view = { ...VIEW, status: "accepted", pickup_slot_start: "2026-10-17T20:00:00Z", helpr_first_name: "Dana", dropoff_code: "4821" };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText(/Dana picks it up from the seller/)).toBeInTheDocument();
    expect(screen.getByText("4821")).toBeInTheDocument();
    expect(screen.getByText(/Never share it before/)).toBeInTheDocument();
  });

  it("the seller never sees the drop-off code", async () => {
    state.view = { ...VIEW, role: "pickup_contact", status: "accepted", pickup_slot_start: "2026-10-17T20:00:00Z", dropoff_code: "4821" };
    show(<OrderDeliveryPanel taskId="t1" side="seller" orderId="o1" />);
    expect(await screen.findByText(/Have it ready/)).toBeInTheDocument();
    expect(screen.queryByText("4821")).toBeNull();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
  });

  it("the seller never gets the buyer's \"I got it\", even once the Helpr has the item", async () => {
    state.view = { ...VIEW, role: "pickup_contact", status: "delivered", delivered_at: "2026-10-17T21:00:00Z", dropoff_photo_path: "h/task/t1/d.jpg" };
    show(<OrderDeliveryPanel taskId="t1" side="seller" orderId="o1" />);
    expect(await screen.findByAltText("At the drop-off")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
  });

  it("left at the door: the photo shows and the buyer's \"I got it\" confirms", async () => {
    state.view = { ...VIEW, status: "delivered", delivered_at: "2026-10-17T21:00:00Z", dropoff_photo_path: "h/task/t1/d.jpg", pickup_photo_path: "h/task/t1/p.jpg" };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText(/left it at your drop-off address/)).toBeInTheDocument();
    expect(await screen.findByAltText("At the drop-off")).toHaveAttribute("src", "https://signed.test/h/task/t1/d.jpg");
    expect(screen.getByAltText("At the pickup")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I got it" }));
    await waitFor(() => expect(state.calls).toEqual([["got_it", "t1"]]));
  });
});

describe("a delivery photo that cannot load says so (lh-silent-failure #6)", () => {
  it("the buyer sees \"couldn't load\" with a retry, not an empty space", async () => {
    state.view = { ...VIEW, status: "delivered", delivered_at: "2026-10-17T21:00:00Z", dropoff_photo_path: "h/task/t1/broken.jpg" };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText(/At the drop-off: the photo couldn't load/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("DeliverView (the Helpr's screen)", () => {
  it("a truck needs a photo before it can be saved (row 41)", async () => {
    show(<DeliverView />);
    fireEvent.click(await screen.findByLabelText("I have a truck"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Photo of your truck"), { target: { files: [jpeg()] } });
    fireEvent.click(screen.getByLabelText(/second person/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.calls).toEqual([["vehicle", true, true, "u1/vehicle/truck.jpg"]]));
  });

  it("an open delivery shows area words and take-home pay, and is taken with a pickup time", async () => {
    state.open = [{ task_id: "t9", source_kind: "declutter_delivery", size: "small", title: "Lamp", pickup_area: "Mid-City",
      dropoff_area: "Baker, LA", trip_miles: 9, miles_to_pickup: 3, take_home_cents: 2620, open_until: "2026-10-18T15:00:00Z",
      latest_pickup_at: "2026-10-23T15:00:00Z" }];
    show(<DeliverView />);
    expect(await screen.findByText("Mid-City to Baker, LA · about 9 miles")).toBeInTheDocument();
    expect(screen.getByText(/You get \$26\.20/)).toBeInTheDocument();
    const take = screen.getByRole("button", { name: "Take it" });
    expect(take).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Pickup time/), { target: { value: "2026-10-20T10:00" } });
    fireEvent.click(take);
    await waitFor(() => expect(state.calls[0]?.[0]).toBe("accept"));
    expect(state.calls[0]?.[1]).toBe("t9");
  });

  it("my delivery, taken: the pickup address, the \"Picked up\" photo, and backing out", async () => {
    state.mine = [{ task_id: "t1", status: "accepted", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
      trip_miles: 9, take_home_cents: 2620, pickup_slot_start: "2026-10-20T15:00:00Z", payout_status: null }];
    state.view = { ...VIEW, role: "helpr", status: "accepted", pickup_slot_start: "2099-10-20T15:00:00Z", pickup_address: "1234 Example St" };
    show(<DeliverView />);
    expect(await screen.findByText("1234 Example St")).toBeInTheDocument();
    expect(screen.queryByText(/Deliver to:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "The seller wasn't there" })).toBeNull();
    fireEvent.change(screen.getByLabelText(/Photo of the item when you pick it up/), { target: { files: [jpeg()] } });
    await waitFor(() => expect(state.calls[0]).toEqual(["picked_up", "t1", "u1/task/t1/photo.jpg", { lat: 30.5, lng: -91.15 }]));
    fireEvent.click(screen.getByRole("button", { name: "Back out" }));
    await waitFor(() => expect(state.calls[1]).toEqual(["release", "t1"]));
  });

  it("the seller wasn't there: reported with a photo at the pickup and the Helpr's location, after 15 minutes", async () => {
    state.mine = [{ task_id: "t1", status: "accepted", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
      trip_miles: 9, take_home_cents: 2620, pickup_slot_start: "2026-10-20T15:00:00Z", payout_status: null }];
    state.view = { ...VIEW, role: "helpr", status: "accepted", pickup_slot_start: "2000-01-01T15:00:00Z", pickup_address: "1234 Example St" };
    show(<DeliverView />);
    fireEvent.change(await screen.findByLabelText(/The seller wasn't there: a photo of the door/), { target: { files: [jpeg()] } });
    await waitFor(() => expect(state.calls[0]).toEqual(["no_show", "t1", "u1/task/t1/photo.jpg", { lat: 30.5, lng: -91.15 }]));
  });

  it("my delivery, picked up: the drop-off needs a photo; with the code it is handed over", async () => {
    state.mine = [{ task_id: "t1", status: "picked_up", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
      trip_miles: 9, take_home_cents: 2620, pickup_slot_start: "2026-10-20T15:00:00Z", payout_status: null }];
    state.view = { ...VIEW, role: "helpr", status: "picked_up", pickup_slot_start: "2026-10-20T15:00:00Z", pickup_address: "1234 Example St", dropoff_address: "900 Far Rd" };
    show(<DeliverView />);
    expect(await screen.findByText("900 Far Rd")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Left at the door" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Photo at the drop-off address"), { target: { files: [jpeg()] } });
    fireEvent.change(screen.getByLabelText(/4-digit code/), { target: { value: "48a21" } });
    fireEvent.click(screen.getByRole("button", { name: "Handed over" }));
    await waitFor(() => expect(state.calls[0]).toEqual(["delivered", "t1", "u1/task/t1/photo.jpg", { lat: 30.5, lng: -91.15 }, "4821"]));
  });

  it("a finished delivery says whether it was paid", async () => {
    state.mine = [{ task_id: "t2", status: "confirmed", size: "small", title: "Rug", pickup_area: "A", dropoff_area: "B",
      trip_miles: 2, take_home_cents: 1000, pickup_slot_start: null, payout_status: "succeeded" }];
    show(<DeliverView />);
    expect(await screen.findByText("Delivered and paid.")).toBeInTheDocument();
  });
});

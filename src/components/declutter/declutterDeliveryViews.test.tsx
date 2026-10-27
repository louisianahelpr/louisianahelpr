/**
 * The Declutter Helpr-delivery screens (slice five, docs/specs/declutter-auctions.md
 * rows 24, 29-30, 40-43): what each STATE renders and what each button sends.
 * The shared task module's calls are stubbed; the backend proof is
 * src/test/pglite/declutterDelivery.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const canConfirm = side === "buyer" && (v.status === "picked_up" \|\| v.status === "delivered"); |   const canConfirm = v.status === "picked_up" \|\| v.status === "delivered";
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | disabled={deliver.isPending \|\| !dropPhoto} | disabled={deliver.isPending}
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | { accepted: 0, picked_up: 1, delivered: 2, confirmed: 2 } | { accepted: 0, picked_up: 1, delivered: 1, confirmed: 2 }
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       await reportPickupNoShow(t.task_id, awayUploaded.current.path, where); |       await reportPickupNoShow(t.task_id, "", { lat: 0, lng: 0 });
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
  openError: null as null | { message: string },
  setupPaused: false,
  profile: undefined as undefined | Record<string, unknown>,
  offered: [] as string[],
};

// The shared day + time pickers are exercised in their own tests; here a plain input stands in, same value shape.
vi.mock("@/components/DateTimeField", () => ({
  DateTimeField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: state.profile }) }));
// Q2416: the hired-Helpr payout prompt after taking a delivery (its own dialog test is payoutAfterHire.test.tsx).
vi.mock("@/components/payouts/useHiredPayoutPrompt", () => ({
  useHiredPayoutPrompt: () => ({ open: false, offer: async (id: string) => { state.offered.push(id); return true; }, close: () => {} }),
}));
// Q2435: the Busy right now card reads the Browse map's jobs and loads MapKit; not what this file tests.
vi.mock("@/components/busyAreas/BusyAreasCard", () => ({ BusyAreasCard: () => null }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => ({ lat: 30.5, lng: -91.15 }) }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({
  usePayoutSetupPaused: () => state.setupPaused,
  usePayoutSetupBlock: () => (state.setupPaused ? "needs_hire" : null),
}));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchTaskView: async () => state.view,
  fetchOpenTasks: async () => { if (state.openError) throw state.openError; return state.open; },
  fetchMyTasks: async () => state.mine,
  // My route has its own test (deliveryRoute.test.tsx); here it has no stops and renders nothing.
  fetchMyRoute: async () => ({ stops: [], miles: 0, drive_minutes: 0, finish_at: null }),
  // "On your way" has its own test (routeSuggestions.test.tsx).
  fetchRouteSuggestions: async () => ({ suggestions: [], reason: "none_near" }),
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
// "Go online for deliveries" has its own test (goOnline.test.tsx); here the Helpr is offline.
vi.mock("@/lib/helprTasks/online", () => ({ fetchOnlineStatus: async () => null, isOnline: () => false, setOnline: vi.fn() }));
// Q1929's "Raise the pay" panel has its own test (deliveryRaisePanel.test.tsx); here it shows nothing.
vi.mock("@/lib/declutter/deliveryRaise", () => ({ fetchDeliveryRaiseStatus: async () => null, startDeliveryRaise: vi.fn() }));

import { DeliverView, OrderDeliveryPanel } from "./DeclutterDeliveryViews";
import { PAYOUT_SETUP_NEEDS_HIRE_COPY } from "@/lib/payoutSetupPaused";

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
  dropoff_lng: null, pickup_photo_path: null, dropoff_photo_path: null,
};
const jpeg = () => new File([new Uint8Array([1])], "p.jpg", { type: "image/jpeg" });

beforeEach(() => {
  state.view = null;
  state.open = [];
  state.mine = [];
  state.vehicle = null;
  state.calls = [];
  state.openError = null;
  state.setupPaused = false;
  state.profile = undefined;
  state.offered = [];
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("OrderDeliveryPanel (the buyer's and the seller's card)", () => {
  it("waiting for a Helpr: the buyer is told the fallback (row 40)", async () => {
    state.view = VIEW;
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText(/Finding a Helpr\. If nobody takes it by/)).toBeInTheDocument();
    expect(screen.getByText(/what you paid for delivery comes back and you pick it up/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
  });

  it("taken: the buyer sees the Helpr's first name and the pickup time, and no drop-off code (owner 2026-10-18)", async () => {
    state.view = { ...VIEW, status: "accepted", pickup_slot_start: "2026-10-17T20:00:00Z", helpr_first_name: "Dana", dropoff_code: "4821" };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText(/Dana picks it up from the seller/)).toBeInTheDocument();
    expect(screen.queryByText("4821")).toBeNull();
    expect(screen.queryByText(/drop-off code/i)).toBeNull();
  });

  it("the seller sees progress only", async () => {
    state.view = { ...VIEW, role: "pickup_contact", status: "accepted", pickup_slot_start: "2026-10-17T20:00:00Z" };
    show(<OrderDeliveryPanel taskId="t1" side="seller" orderId="o1" />);
    expect(await screen.findByText(/Have it ready/)).toBeInTheDocument();
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
    // Board 76: the one tracker on its last step, and each real step as a note.
    expect(screen.getByRole("list", { name: /^Step 3 of 3: Delivered$/ })).toBeInTheDocument();
    expect(screen.getByText(/left it at the drop-off ·/)).toBeInTheDocument();
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
    // Board 50: the route as areas only, the take-home amount, addresses only after accepting.
    expect(await screen.findByText("Pick up in Mid-City")).toBeInTheDocument();
    expect(screen.getByText("From the seller · about 3 miles from you")).toBeInTheDocument();
    expect(screen.getByText("Drop off near Baker, LA")).toBeInTheDocument();
    expect(screen.getByText("To the buyer · about 9 miles")).toBeInTheDocument();
    expect(screen.getByText("$26.20")).toBeInTheDocument();
    expect(screen.getByText("Exact addresses unlock when you accept.")).toBeInTheDocument();
    const take = screen.getByRole("button", { name: "Accept delivery" });
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

  it("my delivery, picked up: the drop-off needs a photo and no code (owner 2026-10-18)", async () => {
    state.mine = [{ task_id: "t1", status: "picked_up", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
      trip_miles: 9, take_home_cents: 2620, pickup_slot_start: "2026-10-20T15:00:00Z", payout_status: null }];
    state.view = { ...VIEW, role: "helpr", status: "picked_up", pickup_slot_start: "2026-10-20T15:00:00Z", pickup_address: "1234 Example St", dropoff_address: "900 Far Rd" };
    show(<DeliverView />);
    expect(await screen.findByText("900 Far Rd")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Left at the door" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Photo at the drop-off address"), { target: { files: [jpeg()] } });
    expect(screen.queryByLabelText(/code/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Left at the door" }));
    await waitFor(() => expect(state.calls[0]).toEqual(["delivered", "t1", "u1/task/t1/photo.jpg", { lat: 30.5, lng: -91.15 }]));
  });

  it("a finished delivery says whether it was paid", async () => {
    state.mine = [{ task_id: "t2", status: "confirmed", size: "small", title: "Rug", pickup_area: "A", dropoff_area: "B",
      trip_miles: 2, take_home_cents: 1000, pickup_slot_start: null, payout_status: "succeeded" }];
    show(<DeliverView />);
    expect(await screen.findByText("Delivered and paid.")).toBeInTheDocument();
  });
});

/**
 * Q2351 (ledger cae29df0662b, measured 2026-10-27): helpr_tasks_open_near refuses a member with no
 * payout account ('payout_setup_incomplete', 233 of 234 members on prod), and the page showed
 * "We couldn't load deliveries." with the selling sentence, filing an error_logs row each time.
 * A who-may-deliver answer is a plain notice with the next step; a real failure keeps ErrorState.
 *
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const notYet = deliverNotYet(open.error) ?? deliverNotYet(mine.error); |   const notYet = null as DeliverNotYet \| null;
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |     if (setupPaused) return <PayoutSetupPausedNotice />; |
 */
describe("DeliverView: who may not deliver yet (Q2351)", () => {
  const showRouted = async (el: React.ReactNode) => {
    const { MemoryRouter } = await import("react-router-dom");
    return show(<MemoryRouter>{el}</MemoryRouter>);
  };

  it("no payout account: a 'Set up payouts' notice, never the error screen", async () => {
    state.openError = { message: "payout_setup_incomplete" };
    await showRouted(<DeliverView />);
    expect(await screen.findByText("Set up payouts to deliver.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up payouts" })).toHaveAttribute("href", "/profile?tab=payment");
    expect(screen.queryByText("We couldn't load deliveries.")).toBeNull();
    expect(screen.queryByText(/when your item sells/)).toBeNull();
  });

  it("payout setup paused: the paused notice instead of a setup link", async () => {
    state.openError = { message: "payout_setup_incomplete" };
    state.setupPaused = true;
    await showRouted(<DeliverView />);
    // Wait for the paused notice itself (a positive), then assert the setup notice is absent.
    expect(await screen.findByText(PAYOUT_SETUP_NEEDS_HIRE_COPY)).toBeInTheDocument();
    expect(screen.queryByText("Set up payouts to deliver.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Set up payouts" })).toBeNull();
    expect(screen.queryByText("We couldn't load deliveries.")).toBeNull();
  });

  it("under 18, strikes or a restricted account: their own plain notice", async () => {
    const cases = [
      ["under_18", "You must be 18 or older to deliver."],
      ["declutter_strikes_blocked", "Deliveries aren't open to you right now."],
      ["account_restricted", "Deliveries aren't open to you right now."],
    ] as const;
    for (const [code, words] of cases) {
      state.openError = { message: code };
      const { unmount } = await showRouted(<DeliverView />);
      expect(await screen.findByText(words)).toBeInTheDocument();
      expect(screen.queryByText("We couldn't load deliveries.")).toBeNull();
      unmount();
    }
  });

  it("a real failure still shows the error screen", async () => {
    state.openError = { message: "boom" };
    await showRouted(<DeliverView />);
    expect(await screen.findByText("We couldn't load deliveries.")).toBeInTheDocument();
  });
});

/**
 * Q2416 (owner 2026-10-27, #3675): a delivery is taken without a payout account; right after, the Helpr
 * is offered payout setup (the hired-Helpr prompt), and their list says the pay is held until it is done.
 *
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       if (user?.id) void hiredPayout.offer(user.id); |
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   if (!profile \|\| !owed \|\| payoutAccountReady(profile)) return null; |   return null;
 */
describe("DeliverView: payout setup comes after taking a delivery (Q2416)", () => {
  const showRouted = async (el: React.ReactNode) => {
    const { MemoryRouter } = await import("react-router-dom");
    return show(<MemoryRouter>{el}</MemoryRouter>);
  };
  const TAKEN = { task_id: "t1", status: "accepted", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
    trip_miles: 9, take_home_cents: 2620, pickup_slot_start: "2099-10-20T15:00:00Z", payout_status: null };

  it("taking a delivery offers payout setup to the Helpr who took it", async () => {
    state.open = [{ task_id: "t9", source_kind: "declutter_delivery", size: "small", title: "Lamp", pickup_area: "Mid-City",
      dropoff_area: "Baker, LA", trip_miles: 9, miles_to_pickup: 3, take_home_cents: 2620, open_until: "2026-10-18T15:00:00Z",
      latest_pickup_at: "2026-10-23T15:00:00Z" }];
    await showRouted(<DeliverView />);
    fireEvent.change(await screen.findByLabelText(/Pickup time/), { target: { value: "2026-10-20T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept delivery" }));
    await waitFor(() => expect(state.offered).toEqual(["u1"]));
  });

  it("a Helpr with a delivery in hand and no payout account is told the pay is held, with Set up payouts", async () => {
    state.mine = [TAKEN];
    state.view = { ...VIEW, role: "helpr", status: "accepted", pickup_slot_start: "2099-10-20T15:00:00Z" };
    state.profile = { stripe_account_id: null, stripe_payouts_enabled: null, is_seed: false };
    await showRouted(<DeliverView />);
    expect(await screen.findByText("Set up payouts to get paid for your deliveries.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up payouts" })).toHaveAttribute("href", "/profile?tab=payment");
  });

  it("no prompt once payouts are ready, or when nothing is owed", async () => {
    state.mine = [TAKEN];
    state.view = { ...VIEW, role: "helpr", status: "accepted", pickup_slot_start: "2099-10-20T15:00:00Z" };
    state.profile = { stripe_account_id: "acct_1", stripe_payouts_enabled: true, is_seed: false };
    const { unmount } = await showRouted(<DeliverView />);
    expect(await screen.findByText("Lamp")).toBeInTheDocument();
    expect(screen.queryByText("Set up payouts to get paid for your deliveries.")).toBeNull();
    unmount();
    state.mine = [{ ...TAKEN, status: "confirmed", payout_status: "nothing_due" }];
    state.profile = { stripe_account_id: null, stripe_payouts_enabled: null, is_seed: false };
    await showRouted(<DeliverView />);
    expect(await screen.findByText("Lamp")).toBeInTheDocument();
    expect(screen.queryByText("Set up payouts to get paid for your deliveries.")).toBeNull();
  });
});

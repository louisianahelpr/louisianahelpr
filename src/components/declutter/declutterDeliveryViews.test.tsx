/**
 * The Declutter Helpr-delivery screens (slice five, docs/specs/declutter-auctions.md
 * rows 24, 29-30, 40-43): what each STATE renders and what each button sends.
 * The shared task module's calls are stubbed; the backend proof is
 * src/test/pglite/declutterDelivery.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const canConfirm = side === "buyer" && buyerMayConfirm(v)\n | \n  const canConfirm = buyerMayConfirm(v)\n
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | (v.status === "picked_up" && (collecting \|\| stillInHandLine(who, v.picked_up_at) !== null))); | v.status === "picked_up");
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | Tapping I got it finishes the sale: the Helpr and the seller are paid. | Tapping I got it pays the Helpr.
 * BUY-45: a failed or cancelled delivery says which, never only "This delivery was closed."
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   } else if (v.status === "failed") { |   } else if (v.status === "failed_never") {
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   } else if (v.status === "cancelled") { |   } else if (v.status === "cancelled_never") {
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |           {v.status === "picked_up" && !v.stuck_stage && toRoute} |           {null}
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | { accepted: 0, picked_up: 1, delivered: 2, confirmed: 2 } | { accepted: 0, picked_up: 1, delivered: 1, confirmed: 2 }
 * @mutate src/lib/declutter/stillInHand.ts |   if (!pickedUpAt \|\| !heldPastADay(pickedUpAt)) return null; |   if (true) return null;
 * @mutate src/components/declutter/DeliverVehicleForm.tsx |         disabled={save.isPending \|\| (hasTruck && !photo && !vehicle.data?.photo_path)} onClick={() => save.mutate()}> |         disabled={save.isPending} onClick={() => save.mutate()}>
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  tips: [] as unknown[],
  /** helpr_task_pickup_windows (20261028232930): null = not deployed (the free field). */
  sameSlot: null as string | null,
  taskWindows: null as null | { windows: { weekday: number; starts: string; ends: string }[]; latestPickupAt: string | null },
};

// The shared day + time pickers are exercised in their own tests; here a plain input stands in, same value shape.
vi.mock("@/components/DateTimeField", () => ({
  DateTimeField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
// soldstates-5: the seller's report and the Helpr's answer read their own RPC; none on these cards.
vi.mock("@/lib/declutter/noHelpr", () => ({ fetchHelprNoShowReport: async () => null, fetchNoHelprChoice: async () => null }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: state.profile }) }));
// Q2416: the hired-Helpr payout prompt after taking a delivery (its own dialog test is payoutAfterHire.test.tsx).
vi.mock("@/components/payouts/useHiredPayoutPrompt", () => ({
  useHiredPayoutPrompt: () => ({ open: false, offer: async (id: string) => { state.offered.push(id); return true; }, close: () => {} }),
}));
// Q2435: the Busy right now card reads the Browse map's jobs and loads MapKit; not what this file tests.
vi.mock("@/components/busyAreas/BusyAreasCard", () => ({ BusyAreasCard: () => null }));
// BUY-36: the corrected-address field loads MapKit (mapkit-token); its search is not under test here.
vi.mock("@/components/postjob/AddressAutocomplete", () => ({ AddressAutocomplete: () => null }));
const position = { off: false };
vi.mock("@/lib/declutter/position", () => ({
  currentPosition: async () => {
    if (position.off) throw new Error("location_required");
    return { lat: 30.5, lng: -91.15 };
  },
}));
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
  fetchOpenCount: async () => null,
  fetchTaskPickupWindows: async () => state.taskWindows,
  fetchSamePickupSlot: async () => state.sameSlot,
  taskPhotoUrl: async (p: string) => { if (p.includes("broken")) throw new Error("photo_unavailable"); return `https://signed.test/${p}`; },
  acceptTask: async (...a: unknown[]) => { state.calls.push(["accept", ...a]); },
  releaseTask: async (...a: unknown[]) => { state.calls.push(["release", ...a]); return { result: "released", strike: false }; },
  markPickedUp: async (...a: unknown[]) => { state.calls.push(["picked_up", ...a]); },
  reportCantFinish: async (...a: unknown[]) => { state.calls.push(["cant_finish", ...a]); },
  buyerFixDelivery: async (...a: unknown[]) => { state.calls.push(["buyer_fix", ...a]); },
  buyerChooseAfterCantFinish: async (...a: unknown[]) => { state.calls.push(["buyer_choose", ...a]); },
  markReturned: async (...a: unknown[]) => { state.calls.push(["returned", ...a]); },
  sellerReturnAnswer: async (...a: unknown[]) => { state.calls.push(["return_answer", ...a]); },
  markDelivered: async (...a: unknown[]) => { state.calls.push(["delivered", ...a]); return { result: "confirmed" }; },
  reportPickupNoShow: async (...a: unknown[]) => { state.calls.push(["no_show", ...a]); },
  markHandedOver: async (...a: unknown[]) => { state.calls.push(["handed_over", ...a]); return { result: "handed_over" }; },
  confirmReceived: async (...a: unknown[]) => { state.calls.push(["got_it", ...a]); },
  saveVehicle: async (...a: unknown[]) => { state.calls.push(["vehicle", ...a]); },
  uploadTaskPhoto: async (_u: string, t: string) => `u1/task/${t}/photo.jpg`,
  uploadVehiclePhoto: async () => "u1/vehicle/truck.jpg",
}));
// "Go online for deliveries" has its own test (goOnline.test.tsx); here the Helpr is offline.
vi.mock("@/lib/helprTasks/online", () => ({ fetchOnlineStatus: async () => null, isOnline: () => false, setOnline: vi.fn() }));
// Q1929's "Raise the pay" panel has its own test (deliveryRaisePanel.test.tsx); here it shows nothing.
vi.mock("@/lib/declutter/deliveryRaise", () => ({ fetchDeliveryRaiseStatus: async () => null, startDeliveryRaise: vi.fn() }));
// Q2453: the delivery tip (its money is proven in src/test/edge/declutter-delivery-tip.test.ts).
vi.mock("@/lib/declutter/deliveryTip", () => ({
  fetchMyPaidDeliveryTips: async () => state.tips,
  fetchTipsOnMyDeliveries: async () => new Map((state.tips as { task_id?: string; tip_cents: number }[]).filter((t) => t.task_id).map((t) => [t.task_id!, t.tip_cents])),
  startDeliveryTip: async (...a: unknown[]) => { state.calls.push(["tip", ...a]); return "https://checkout.stripe.test/tip"; },
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: async (url: string) => { state.calls.push(["open", url]); } }));

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
  position.off = false;
  state.view = null;
  state.open = [];
  state.mine = [];
  // Q2452: every delivery needs a car; the usual Helpr here has one.
  state.vehicle = { has_car: true, has_truck: false, second_person: false, photo_path: null };
  state.calls = [];
  state.openError = null;
  state.setupPaused = false;
  state.profile = undefined;
  state.offered = [];
  state.tips = [];
  state.taskWindows = null;
  state.sameSlot = null;
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

  it("BUY-45: the buyer's failed or cancelled delivery says which, and where the money is", async () => {
    state.view = { ...VIEW, status: "failed" };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText("Louisiana Helpr decided this delivery as damaged on the way. What happens to your money shows on this order.")).toBeInTheDocument();
  });

  it("BUY-45: a cancelled delivery says so", async () => {
    state.view = { ...VIEW, status: "cancelled" };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText("This delivery was cancelled. What happens to your money shows on this order.")).toBeInTheDocument();
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
    // The in-app sheet first, never window.confirm (lead 2026-10-28): nothing is paid until its own "I got it".
    // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |         <button type="button" className={primary} disabled={gotIt.isPending} onClick={() => setAskGot(true)}> |         <button type="button" className={primary} disabled={gotIt.isPending} onClick={() => gotIt.mutate()}>
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Do you have it?");
    expect(sheet).toHaveTextContent("finishes the sale: the Helpr and the seller are paid");
    expect(state.calls).toEqual([]);
    fireEvent.click(within(sheet).getByRole("button", { name: "I got it" }));
    await waitFor(() => expect(state.calls).toEqual([["got_it", "t1"]]));
    expect(window.confirm).not.toHaveBeenCalled();
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

describe("OrderDeliveryPanel: a tip for the delivery Helpr (Q2453)", () => {
  const done = { ...VIEW, status: "confirmed", helpr_first_name: "Hank", accepted_at: "2026-10-17T15:00:00Z", picked_up_at: "2026-10-17T18:00:00Z",
    delivered_at: "2026-10-17T21:00:00Z", confirmed_at: "2026-10-17T21:30:00Z", confirmed_by: "customer" };

  it("once it is done the buyer may tip: the job tip's picker, the one total, and the Helpr gets the whole tip", async () => {
    state.view = done;
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText("Add a tip for Hank?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^\$10/ }));
    // tipChargeBreakdown(1000): $10.61 charged, the whole $10.00 to the Helpr; the fee in words only.
    expect(screen.getByText("$10.61")).toBeInTheDocument();
    expect(screen.getByText(/Hank receives the whole \$10\.00 tip/)).toBeInTheDocument();
    // Owner rule #20 (2026-10-28, "Words only"; F30): the fee is named in words, never as a figure or a line.
    expect(screen.getByText("Includes a small Louisiana Helpr service fee.")).toBeInTheDocument();
    expect(screen.queryByText(/fee[^.]*\$|\$[^.]*fee/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tip $10.00" }));
    await waitFor(() => expect(state.calls[0]?.slice(0, 3)).toEqual(["tip", "t1", 1000]));
    expect(String(state.calls[0]?.[3])).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(state.calls[1]).toEqual(["open", "https://checkout.stripe.test/tip"]));
  });

  it("before it is done, and for the seller, there is no tip", async () => {
    state.view = { ...done, status: "delivered", confirmed_at: null, confirmed_by: null };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText(/left it at your drop-off address/)).toBeInTheDocument();
    expect(screen.queryByText(/Add a tip/)).toBeNull();
    state.view = done;
    show(<OrderDeliveryPanel taskId="t1" side="seller" orderId="o1" />);
    expect(await screen.findAllByText("Delivered.")).not.toHaveLength(0);
    expect(screen.queryByText(/Add a tip/)).toBeNull();
  });

  // Audit 2026-10-28 A3-1: the handed-over order card shows only the tip (the card already says "Handed over.").
  // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   if (tipOnly) return side === "buyer" && v.status === "confirmed" ? |   if (false) return side === "buyer" && v.status === "confirmed" ?
  it("tipOnly (the handed-over card): just the tip once confirmed, nothing before or for the seller (A3-1)", async () => {
    state.view = done;
    const a = show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" tipOnly />);
    expect(await screen.findByText("Add a tip for Hank?")).toBeInTheDocument();
    expect(screen.queryByText("Delivered.")).toBeNull();
    expect(screen.queryByRole("list", { name: "What happened" })).toBeNull();
    a.unmount();
    state.view = { ...done, status: "delivered", confirmed_at: null, confirmed_by: null };
    const b = show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" tipOnly />);
    await waitFor(() => expect(state.calls).toEqual([]));
    expect(b.container.textContent).toBe("");
    b.unmount();
    state.view = done;
    const c = show(<OrderDeliveryPanel taskId="t1" side="seller" orderId="o1" tipOnly />);
    await waitFor(() => expect(c.container.textContent).toBe(""));
    expect(screen.queryByText(/Add a tip/)).toBeNull();
  });

  it("a tip already paid is thanked, not offered again", async () => {
    state.view = done;
    state.tips = [{ id: "tip1", tip_cents: 1500, payment_status: "paid", paid_at: "2026-10-17T22:00:00Z" }];
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText("You tipped Hank $15.00. Thank you.")).toBeInTheDocument();
    expect(screen.queryByText(/Add a tip/)).toBeNull();
  });
});

describe("DeliverView: the Helpr sees the buyer's tip on the delivery (Q2453)", () => {
  it("a paid tip shows on its delivery card, the whole amount", async () => {
    state.mine = [{ task_id: "t1", status: "confirmed", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
      trip_miles: 9, take_home_cents: 2620, pickup_slot_start: "2026-10-20T15:00:00Z", payout_status: "succeeded" }];
    state.tips = [{ task_id: "t1", tip_cents: 1000 }];
    show(<DeliverView />);
    expect(await screen.findByText("The buyer tipped you $10.")).toBeInTheDocument();
  });
});

describe("DeliverView: a finished delivery that paid nothing promises no pay (AUD31-27)", () => {
  // @mutate src/components/declutter/DeclutterDeliveryViews.tsx | {active \|\| t.status === "confirmed" ? <> | {true ? <>
  it("closed and damaged rows say why and show no take-home; a paid one still shows it", async () => {
    const row = { size: "small", pickup_area: "Mid-City", dropoff_area: "Baker, LA", trip_miles: 9, take_home_cents: 2100, pickup_slot_start: null };
    state.mine = [
      { ...row, task_id: "t1", status: "cancelled", title: "Lamp", payout_status: null },
      { ...row, task_id: "t2", status: "failed", title: "Mirror", payout_status: null },
      { ...row, task_id: "t3", status: "confirmed", title: "Chair", payout_status: "succeeded" },
    ];
    show(<DeliverView />);
    expect(await screen.findByText("Closed.")).toBeInTheDocument();
    expect(screen.getByText("Decided as damaged in delivery. Not paid.")).toBeInTheDocument();
    expect(screen.getByText("Delivered and paid.")).toBeInTheDocument();
    expect(screen.getAllByText(/\$21 for you/)).toHaveLength(1);
  });

  // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |           {t.ended_at && <span className="text-muted-foreground" data-task-ended=""> {ENDED_DAY.format(new Date(t.ended_at))}</span>} |
  // @mutate src/components/declutter/DeclutterDeliveryViews.tsx | const ENDED_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", | const ENDED_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo",
  it("AUD31-27: every finished row says the Louisiana day it ended; a row under way has none", async () => {
    const row = { size: "small", pickup_area: "Mid-City", dropoff_area: "Baker, LA", trip_miles: 9, take_home_cents: 2100, pickup_slot_start: "2026-10-30T15:00:00Z" };
    state.mine = [
      { ...row, task_id: "t1", status: "cancelled", title: "Lamp", payout_status: null, ended_at: "2026-10-27T15:00:00Z" },
      { ...row, task_id: "t2", status: "failed", title: "Mirror", payout_status: null, ended_at: "2026-10-28T15:00:00Z" },
      // 04:30 UTC on Oct 30 is still Thu, Oct 29 in Louisiana.
      { ...row, task_id: "t3", status: "confirmed", title: "Chair", payout_status: "succeeded", ended_at: "2026-10-30T04:30:00Z" },
    ];
    const { container } = show(<DeliverView />);
    await screen.findByText(/^Closed\./);
    const days = Array.from(container.querySelectorAll("[data-task-ended]")).map((e) => e.textContent?.trim());
    expect(days).toEqual(["Tue, Oct 27", "Wed, Oct 28", "Thu, Oct 29"]);
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
    await waitFor(() => expect(state.calls).toEqual([["vehicle", true, true, true, "u1/vehicle/truck.jpg"]]));
  });

  it("no car: Deliver says to add one instead of listing deliveries, and ticking the truck ticks the car (Q2452)", async () => {
    state.vehicle = null;
    state.open = [{ task_id: "t9", source_kind: "declutter_delivery", size: "small", title: "Lamp", pickup_area: "Mid-City",
      dropoff_area: "Baker, LA", trip_miles: 9, miles_to_pickup: 3, take_home_cents: 2620, open_until: "2026-10-18T15:00:00Z",
      latest_pickup_at: "2026-10-23T15:00:00Z" }];
    show(<DeliverView />);
    expect(await screen.findByText("Add your car under Your vehicle to take deliveries.")).toBeInTheDocument();
    expect(screen.queryByText("Pick up in Mid-City")).toBeNull();
    // The shared Checkbox (a button with role checkbox).
    const car = screen.getByRole("checkbox", { name: "I have a car" });
    expect(car).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("checkbox", { name: "I have a truck" }));
    expect(car).toHaveAttribute("aria-checked", "true");
    expect(car).toBeDisabled();
  });

  // Deep audit #38: a Helpr whose truck is saved is never told "Large items need a truck".
  // @mutate src/components/declutter/DeliverVehicleForm.tsx |         {hasTruck && twoPeople | {false && twoPeople
  it("the vehicle line says what this Helpr can take", async () => {
    state.vehicle = { has_car: true, has_truck: true, second_person: true, photo_path: "u1/vehicle/truck.jpg" };
    const { unmount } = show(<DeliverView />);
    const line = await waitFor(() => { const el = document.querySelector("[data-vehicle-reach]"); if (!el?.textContent?.includes("every size")) throw new Error("not yet"); return el; });
    expect(line.textContent).not.toMatch(/need a truck/);
    unmount();
    state.vehicle = { has_car: true, has_truck: false, second_person: false, photo_path: null };
    show(<DeliverView />);
    await waitFor(() => expect(document.querySelector("[data-vehicle-reach]")?.textContent).toMatch(/Large and extra large items need a truck/));
  });

  // Audit 3 (A3-2): with location off, "Nearest first" said "...confirm you're at the pickup address".
  // @mutate src/components/declutter/DeclutterDeliveryViews.tsx | "Turn on location to see the nearest deliveries first." | declutterErrorMessage(err)
  it("Nearest first with location off asks for location to sort, not about a pickup address", async () => {
    position.off = true;
    const { toast } = await import("sonner");
    show(<DeliverView />);
    fireEvent.click(await screen.findByRole("button", { name: "Nearest first" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Turn on location to see the nearest deliveries first."));
  });

  it("a car alone is saved as a car (Q2452)", async () => {
    state.vehicle = null;
    show(<DeliverView />);
    fireEvent.click(await screen.findByLabelText("I have a car"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.calls).toEqual([["vehicle", true, false, false, null]]));
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
    // BUY-38: the drop-off follows helpr_task_dropoff_shows_at, so "unlock when you accept" was untrue for a first delivery.
    // @mutate src/components/declutter/DeclutterDeliveryViews.tsx | <p className="text-ds-12 text-muted-foreground">{DELIVERY_ADDRESSES_SHOW}</p> | <p className="text-ds-12 text-muted-foreground">Exact addresses unlock when you accept.</p>
    expect(screen.getByText("The pickup address shows when you accept. The drop-off shows 2 hours before the pickup time, or at once after your first finished delivery.")).toBeInTheDocument();
    expect(screen.queryByText(/unlock when you accept/)).toBeNull();
    const take = screen.getByRole("button", { name: "Accept delivery" });
    expect(take).toBeDisabled();
    // Before helpr_task_pickup_windows is live (null), the free field stays, once that read answers.
    fireEvent.change((await screen.findAllByLabelText(/Pickup time/))[0], { target: { value: "2026-10-20T10:00" } });
    fireEvent.click(take);
    await waitFor(() => expect(state.calls[0]?.[0]).toBe("accept"));
    expect(state.calls[0]?.[1]).toBe("t9");
  });

  // Lead 2026-10-28: the Helpr picks from the seller's pickup times, the buyer's day + time chips
  // (helpr_task_pickup_windows, 20261028232930), never a free time the accept then refuses.
  // @mutate src/components/declutter/DeclutterPickupWindows.tsx | <PickupSlotPicker taskId={taskId} value={value} onPick={onPick} | <PickupSlotPicker taskId={taskId} value={value} onPick={() => onPick(null)}
  // @mutate src/components/declutter/DeclutterPickupWindows.tsx |   const q = useQuery(taskId |   const q = useQuery(false
  // Audit 1c D3-2: already going to this seller, the accept card offers that time first, so it is one visit.
  it("an open delivery from a seller the Helpr is already going to offers that same time, and taking it books it", async () => {
    state.sameSlot = new Date(Date.now() + 2 * 864e5).toISOString();
    state.taskWindows = { windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "09:00:00", ends: "17:00:00" })), latestPickupAt: new Date(Date.now() + 5 * 864e5).toISOString() };
    state.open = [{ task_id: "t9", source_kind: "declutter_delivery", size: "small", title: "Lamp", pickup_area: "Mid-City",
      dropoff_area: "Baker, LA", trip_miles: 9, miles_to_pickup: 3, take_home_cents: 2620, open_until: "2099-10-18T15:00:00Z",
      latest_pickup_at: "2099-10-23T15:00:00Z" }];
    show(<DeliverView />);
    const offer = await screen.findByTestId("helpr-same-pickup-slot");
    expect(offer).toHaveTextContent("You're already picking up from this seller");
    // @mutate src/components/declutter/DeclutterPickupWindows.tsx | onClick={() => onPick(same.data)} | onClick={() => onPick(null)}
    fireEvent.click(within(offer).getByRole("button", { name: /^Same time: / }));
    fireEvent.click(screen.getByRole("button", { name: "Accept delivery" }));
    await waitFor(() => expect(state.calls[0]).toEqual(["accept", "t9", state.sameSlot]));
  });

  it("no pickup at this seller: no offer", async () => {
    state.taskWindows = { windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "09:00:00", ends: "17:00:00" })), latestPickupAt: new Date(Date.now() + 5 * 864e5).toISOString() };
    state.open = [{ task_id: "t9", source_kind: "declutter_delivery", size: "small", title: "Lamp", pickup_area: "Mid-City",
      dropoff_area: "Baker, LA", trip_miles: 9, miles_to_pickup: 3, take_home_cents: 2620, open_until: "2099-10-18T15:00:00Z",
      latest_pickup_at: "2099-10-23T15:00:00Z" }];
    show(<DeliverView />);
    await screen.findByTestId("declutter-slot-picker");
    expect(screen.queryByTestId("helpr-same-pickup-slot")).toBeNull();
  });

  it("an open delivery is taken from the seller's pickup times: a day chip, then a time chip", async () => {
    const all = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "09:00:00", ends: "17:00:00" }));
    state.taskWindows = { windows: all, latestPickupAt: new Date(Date.now() + 5 * 864e5).toISOString() };
    state.open = [{ task_id: "t9", source_kind: "declutter_delivery", size: "small", title: "Lamp", pickup_area: "Mid-City",
      dropoff_area: "Baker, LA", trip_miles: 9, miles_to_pickup: 3, take_home_cents: 2620, open_until: "2099-10-18T15:00:00Z",
      latest_pickup_at: "2099-10-23T15:00:00Z" }];
    show(<DeliverView />);
    const picker = await screen.findByTestId("declutter-slot-picker");
    expect(picker).toHaveTextContent("The seller's pickup times:");
    expect(screen.queryByLabelText(/Pickup time \(inside/)).toBeNull();
    const take = screen.getByRole("button", { name: "Accept delivery" });
    expect(take).toBeDisabled();
    const times = within(screen.getByRole("group", { name: /^Pickup time on / })).getAllByRole("button");
    expect(times.length).toBeGreaterThan(0);
    fireEvent.click(times[0]);
    expect(take).toBeEnabled();
    fireEvent.click(take);
    await waitFor(() => expect(state.calls[0]?.[0]).toBe("accept"));
    expect(state.calls[0]?.[1]).toBe("t9");
    const iso = String(state.calls[0]?.[2]);
    expect(new Date(iso).getTime()).toBeGreaterThan(Date.now());
  });

  it("an open delivery whose seller has no pickup time left before its deadline says so and cannot be taken", async () => {
    state.taskWindows = { windows: [], latestPickupAt: new Date(Date.now() + 5 * 864e5).toISOString() };
    state.open = [{ task_id: "t9", source_kind: "declutter_delivery", size: "small", title: "Lamp", pickup_area: "Mid-City",
      dropoff_area: "Baker, LA", trip_miles: 9, miles_to_pickup: 3, take_home_cents: 2620, open_until: "2099-10-18T15:00:00Z",
      latest_pickup_at: "2099-10-23T15:00:00Z" }];
    show(<DeliverView />);
    expect(await screen.findByTestId("declutter-no-pickup-slots")).toHaveTextContent("None of the seller's pickup times are open before this delivery's deadline.");
    expect(screen.getByRole("button", { name: "Accept delivery" })).toBeDisabled();
  });

  // Audit 1c D3-9: the photo steps are on Your route's stop card only (deliveryRoute.test.tsx sends them).
  it("my delivery, taken: the pickup address, the way to its photo step, and backing out", async () => {
    state.mine = [{ task_id: "t1", status: "accepted", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
      trip_miles: 9, take_home_cents: 2620, pickup_slot_start: "2026-10-20T15:00:00Z", payout_status: null }];
    state.view = { ...VIEW, role: "helpr", status: "accepted", pickup_slot_start: "2000-01-01T15:00:00Z", pickup_address: "1234 Example St" };
    show(<DeliverView />);
    expect(await screen.findByText("1234 Example St")).toBeInTheDocument();
    expect(screen.queryByText(/Deliver to:/)).toBeNull();
    // One photo step: none here, even 15 minutes past the pickup.
    expect(screen.queryByLabelText(/Photo of the item/)).toBeNull();
    expect(screen.queryByLabelText(/The seller wasn't there/)).toBeNull();
    // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |               {toRoute}\n |               \n
    expect(screen.getByRole("button", { name: "Take the photo at this stop on your route" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back out" }));
    // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |                   onClick={() => setAsk({ kind: "backOut" })}> |                   onClick={() => backOut.mutate()}>
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Back out of this delivery?");
    // AUD31-26: this pickup is past, so THIS back-out costs a strike.
    expect(sheet).toHaveTextContent("It's less than 2 hours before the pickup, so backing out now costs a delivery strike, unless the seller moved the time.");
    expect(state.calls).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole("button", { name: "Back out" }));
    await waitFor(() => expect(state.calls[0]).toEqual(["release", "t1"]));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  // AUD31-26: 40 hours before the pickup the sheet says this back-out is free.
  // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   return !Number.isFinite(t) \|\| now > t - 2 * 3_600_000; |   return true;
  it("AUD31-26: backing out well before the pickup says it costs no strike", async () => {
    state.mine = [{ task_id: "t1", status: "accepted", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
      trip_miles: 9, take_home_cents: 2620, pickup_slot_start: new Date(Date.now() + 40 * 3_600_000).toISOString(), payout_status: null }];
    state.view = { ...VIEW, role: "helpr", status: "accepted", pickup_slot_start: new Date(Date.now() + 40 * 3_600_000).toISOString(), pickup_address: "1234 Example St" };
    show(<DeliverView />);
    fireEvent.click(await screen.findByRole("button", { name: "Back out" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("It's more than 2 hours before the pickup, so backing out now costs no strike.");
    expect(sheet).not.toHaveTextContent("delivery strike");
  });

  it("audit 1c #1: after the seller's \"Handed over\" the card says so", async () => {
    state.mine = [{ task_id: "t1", status: "accepted", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
      trip_miles: 9, take_home_cents: 2620, pickup_slot_start: "2099-10-20T15:00:00Z", payout_status: null }];
    state.view = { ...VIEW, role: "helpr", status: "accepted", pickup_slot_start: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      pickup_address: "1234 Example St", handed_over_at: new Date().toISOString() };
    show(<DeliverView />);
    expect(await screen.findByText("The seller says they handed it over.")).toBeInTheDocument();
  });

  it("audit 1c #4: after \"The seller wasn't there\" the card says it is held and hides the steps", async () => {
    state.mine = [{ task_id: "t1", status: "accepted", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
      trip_miles: 9, take_home_cents: 2620, pickup_slot_start: "2000-01-01T15:00:00Z", payout_status: null }];
    state.view = { ...VIEW, role: "helpr", status: "accepted", pickup_slot_start: "2000-01-01T15:00:00Z", pickup_address: "1234 Example St", problem_open: true };
    show(<DeliverView />);
    expect(await screen.findByText("Reported. Louisiana Helpr is deciding.")).toBeInTheDocument();
    // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |           {v.status === "accepted" && !v.problem_open && ( |           {v.status === "accepted" && (
    expect(screen.queryByRole("button", { name: "Take the photo at this stop on your route" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back out" })).toBeNull();
  });

  it("audit 1c #1: the seller taps \"Handed over\" (asked in the app), and reads the Helpr's word as theirs until then", async () => {
    state.view = { ...VIEW, role: "pickup_contact", status: "accepted", pickup_slot_start: "2026-10-17T20:00:00Z", helpr_first_name: "Hallie" };
    show(<OrderDeliveryPanel taskId="t1" side="seller" orderId="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Handed over" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Did you hand it to Hallie?");
    expect(state.calls).toEqual([]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Handed over" }));
    await waitFor(() => expect(state.calls[0]).toEqual(["handed_over", "t1"]));
  });

  it("BUY-37: on the way until 24 hours after pickup, then it says plainly that it isn't marked delivered", async () => {
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    state.view = { ...VIEW, status: "picked_up", picked_up_at: ago(23), helpr_first_name: "Hank" };
    const { unmount } = show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText("Hank has your item and is on the way.")).toBeInTheDocument();
    // BUY-39: no "I got it" while it is on the road (the server would finish the sale and pay the seller).
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
    unmount();
    state.view = { ...VIEW, status: "picked_up", picked_up_at: ago(25), helpr_first_name: "Hank" };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText(/Hank picked it up .* and hasn't marked it delivered\. If you have it, tap "I got it"\. If not, report a problem\./)).toBeInTheDocument();
    expect(screen.queryByText(/is on the way/)).toBeNull();
    // Held 24 hours without a drop-off: the buyer who has it may say so.
    expect(screen.getByRole("button", { name: "I got it" })).toBeInTheDocument();
  });

  it("BUY-36: the Helpr reports they can't finish, with a reason and what comes next", async () => {
    state.mine = [{ task_id: "t1", status: "picked_up", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA", trip_miles: 5, take_home_cents: 1600, pickup_slot_start: null, payout_status: null }];
    state.view = { ...VIEW, role: "helpr", status: "picked_up", picked_up_at: "2026-10-30T12:00:00Z", problem_open: false };
    show(<DeliverView />);
    fireEvent.click(await screen.findByRole("button", { name: "I can't deliver this" }));
    const sheet = await waitFor(() => { const e = document.querySelector<HTMLElement>('[data-confirm-sheet="delivery-cant-finish"]'); expect(e).not.toBeNull(); return e as HTMLElement; });
    fireEvent.click(within(sheet).getByRole("radio", { name: "My vehicle, or I can't finish" }));
    expect(within(sheet).getByText(/You aren't paid, and it's a delivery strike\./)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.calls).toContainEqual(["cant_finish", "t1", "cant_finish", ""]));
  });

  it("BUY-36: nobody's fault: the buyer can fix it once, and is told about the delivery fee and the card fee", async () => {
    state.view = { ...VIEW, status: "picked_up", picked_up_at: "2026-10-30T12:00:00Z", helpr_first_name: "Hank", stuck_stage: "waiting_fix", stuck_fault: "none", stuck_fix_by: "2026-10-31T12:00:00Z", problem_open: false };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    expect(await screen.findByText(/less what the delivery cost, which pays the Helpr for the trip, and less the small part the card network kept/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What the Helpr needs to know"), { target: { value: "Gate code 1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Send it to Hank" }));
    await waitFor(() => expect(state.calls).toContainEqual(["buyer_fix", "t1", "Gate code 1234", null, null]));
  });

  it("BUY-36: an item going back can't be confirmed, and the seller answers when it's back", async () => {
    state.view = { ...VIEW, role: "pickup_contact", status: "picked_up", picked_up_at: "2026-10-30T12:00:00Z", helpr_first_name: "Hank", stuck_stage: "returned", stuck_fault: "helpr", return_answer_by: "2026-10-31T12:00:00Z", problem_open: false };
    const seller = show(<OrderDeliveryPanel taskId="t1" side="seller" orderId="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "I have it back" }));
    const sheet = await waitFor(() => { const e = document.querySelector<HTMLElement>('[data-confirm-sheet="delivery-return-back"]'); expect(e).not.toBeNull(); return e as HTMLElement; });
    fireEvent.click(within(sheet).getByRole("button", { name: "I have it back" }));
    await waitFor(() => expect(state.calls).toContainEqual(["return_answer", "t1", true, ""]));
    seller.unmount();
    state.view = { ...(state.view as object), role: "customer" };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    await screen.findByText(/says it's back with the seller/);
    expect(screen.queryByRole("button", { name: "I got it" })).toBeNull();
  });

  it("BUY-36: the Helpr's fault: the buyer picks a full refund, another Helpr or collecting it", async () => {
    state.view = { ...VIEW, status: "picked_up", picked_up_at: "2026-10-30T12:00:00Z", helpr_first_name: "Hank", stuck_stage: "returning", stuck_fault: "helpr", stuck_return_by: "2026-11-01T12:00:00Z", problem_open: false };
    show(<OrderDeliveryPanel taskId="t1" side="buyer" orderId="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Refund me in full" }));
    const sheet = await waitFor(() => { const e = document.querySelector<HTMLElement>('[data-confirm-sheet="delivery-cant-finish-choice"]'); expect(e).not.toBeNull(); return e as HTMLElement; });
    expect(within(sheet).getByText(/All of your money comes back, delivery included/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Refund me" }));
    await waitFor(() => expect(state.calls).toContainEqual(["buyer_choose", "t1", "refund", ""]));
  });

  it("audit 1c #1: a pickup the seller never confirmed reads \"says it was picked up\" to the seller", async () => {
    state.view = { ...VIEW, role: "pickup_contact", status: "picked_up", picked_up_at: "2026-10-29T01:09:00Z", helpr_first_name: "Hallie" };
    const { unmount } = show(<OrderDeliveryPanel taskId="t1" side="seller" orderId="o1" />);
    expect(await screen.findByText(/Hallie says it was picked up\. .*If you didn't hand it over, report a problem\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Handed over" })).toBeNull();
    unmount();
    state.view = { ...(state.view as object), handed_over_at: "2026-10-29T01:05:00Z" };
    show(<OrderDeliveryPanel taskId="t1" side="seller" orderId="o1" />);
    expect(await screen.findByText(/Hallie picked it up\. You're paid when the buyer has it\./)).toBeInTheDocument();
  });

  it("my delivery, picked up: the drop-off address and the way to its photo step (audit 1c D3-9)", async () => {
    state.mine = [{ task_id: "t1", status: "picked_up", size: "small", title: "Lamp", pickup_area: "Mid-City", dropoff_area: "Baker, LA",
      trip_miles: 9, take_home_cents: 2620, pickup_slot_start: "2026-10-20T15:00:00Z", payout_status: null }];
    state.view = { ...VIEW, role: "helpr", status: "picked_up", pickup_slot_start: "2026-10-20T15:00:00Z", pickup_address: "1234 Example St", dropoff_address: "900 Far Rd" };
    show(<DeliverView />);
    expect(await screen.findByText("900 Far Rd")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Photo at the drop-off address/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Left at the door" })).toBeNull();
    expect(screen.getByRole("button", { name: "Take the photo at this stop on your route" })).toBeInTheDocument();
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

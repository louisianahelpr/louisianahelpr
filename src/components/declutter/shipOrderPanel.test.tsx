/**
 * B134 (Q2259, shipping section 6): a shipped Declutter order after the buyer paid.
 *   - B131 found a ship order read as a pickup on both sides: BuyingOrders' kindOf() fell back to "pickup_home"
 *     (OrderHandover had no "ship"), so the buyer's tracker said "Paid -> Time booked -> Picked up" and its action was
 *     "Book a pickup time". The buyer's facts now say "ship", the tracker is Paid -> Packed -> Shipped -> Delivered,
 *     and nothing is asked of the buyer.
 *   - The seller's label part: ONE next-step line with the Ship-by day, "Print label" (outline) and "Packed" (green
 *     primary, on the RIGHT, so last in the row), which calls declutter_mark_packed; after Packed the line says drop it
 *     off; after the carrier's scan, no buttons.
 *   - The buyer's part: the tracking number and "Track" (the carrier's page: USPS or UPS), nothing before the label is made.
 *   - A UPS label (ups_ground, 20261030012052) says UPS, never USPS, on both sides.
 * The order card's title and branch are declutterHandoverViews.test.tsx's "B134: a shipped order".
 *
 * @mutate src/components/declutter/BuyingOrders.tsx | const KINDS: readonly OrderHandover[] = ["porch", "pickup_home", "meetup", "delivery", "seller_delivery", "ship"]; | const KINDS: readonly OrderHandover[] = ["porch", "pickup_home", "meetup", "delivery", "seller_delivery"];
 * @mutate src/components/declutter/BuyingOrders.tsx |       return { ...base, packed: !!sh?.packed_at, pickedUp: !!sh?.accepted_at, delivered: !!sh?.delivered_at }; |       return { ...base, packed: !!sh?.packed_at, pickedUp: !!sh?.packed_at, delivered: !!sh?.delivered_at };
 * @mutate src/components/declutter/OrderSteps.tsx |       return f.delivered ? 3 : f.pickedUp ? 2 : f.packed ? 1 : 0; |       return f.delivered ? 3 : f.pickedUp ? 2 : 0;
 * @mutate src/components/declutter/OrderSteps.tsx |   ship: ["Paid", "Packed", "Shipped", "Delivered"], |   ship: ["Paid", "Time booked", "Picked up", "Done"],
 * @mutate src/components/declutter/BuyingOrders.tsx |       if (at === 1) return them(by ? `Packed. The seller drops it off by ${by}.` : "Packed. The seller drops it off next."); |
 * @mutate src/components/declutter/ShipOrderPanel.tsx |   const canPack = !!l.label_url && !l.packed_at && !l.accepted_at; |   const canPack = !!l.label_url && !l.accepted_at;
 * @mutate src/components/declutter/ShipOrderPanel.tsx |     : { who: "you", text: "Print the label and pack it", by: by ? `Ship by ${by}` : null }; |     : { who: "you", text: "Print the label and pack it", by: null };
 * @mutate src/components/declutter/ShipOrderPanel.tsx |   if (l.accepted_at) return { who: "info", text: `On its way. ${trackingStatusWords(l.tracking_status) ?? "In transit"}.` }; |
 * @mutate src/components/declutter/ShipOrderPanel.tsx |  if (!l.label_url) return { who: "info", text: "Your shipping label is being made." }; |
 * @mutate src/lib/declutter/shipOrder.ts |   if (!at) throw new Error("label_not_ready"); |
 * @mutate src/lib/declutter/shipOrder.ts |   return service?.startsWith("ups_") ? "UPS" : "USPS"; |   return "USPS";
 * @mutate src/components/declutter/BoughtWhatNext.tsx |     case "ship": |     case "ship_never":
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  label: null as Record<string, unknown> | null,
  tracking: null as Record<string, unknown> | null,
  packedReturns: "2026-11-02T15:00:00Z" as string | null,
  rpc: [] as [string, unknown][],
  opened: [] as string[],
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      state.rpc.push([fn, args]);
      if (fn === "declutter_my_ship_label") return { data: state.label, error: null };
      if (fn === "declutter_my_ship_tracking") return { data: state.tracking, error: null };
      if (fn === "declutter_mark_packed") {
        if (state.label) state.label = { ...state.label, packed_at: state.packedReturns };
        return { data: state.packedReturns, error: null };
      }
      return { data: null, error: { message: `unexpected ${fn}` } };
    },
  },
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: async (u: string) => { state.opened.push(u); } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { ShipOrderPanel, sellerShipNext } from "./ShipOrderPanel";
import { buyerOrderFacts, buyerNextAction, buyerNextStep } from "./BuyingOrders";
import { orderStepAt, orderStepWords, orderWaitsOnYou } from "./OrderSteps";
import { markPacked } from "@/lib/declutter/shipOrder";
import { nextStepWords } from "@/components/ui/NextStep";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const SHIP_BY = "2026-11-05T05:59:59Z"; // Wed, Nov 4, 11:59:59 PM Louisiana time
const ready = (over: Record<string, unknown> = {}) => ({
  order_status: "paid", label_state: "bought", label_url: "https://easypost-files.test/l.pdf", tracking_code: "9400111",
  tracking_status: "pre_transit", service: "usps_ground_advantage", ship_by: SHIP_BY, packed_at: null, accepted_at: null, delivered_at: null, ...over,
});
function mount(side: "buyer" | "seller") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ShipOrderPanel orderId="o1" side={side} /></QueryClientProvider>);
}
const order = { handover: "ship", status: "paid", lines: [{ price_cents: 2000 }] };

beforeEach(() => {
  state.label = null;
  state.tracking = null;
  state.packedReturns = "2026-11-02T15:00:00Z";
  state.rpc = [];
  state.opened = [];
});

describe("a ship order on the buyer's tracker is a ship order, never a pickup (B131's finding)", () => {
  it("reads as ship, with the shipping steps, and asks nothing of the buyer at any step", () => {
    const at = (ship: Record<string, string | null> | null) => buyerOrderFacts(order, { ship: ship as never });
    const paid = at(null);
    expect(paid.handover).toBe("ship");
    expect(orderStepWords(paid)).toEqual(["Paid", "Packed", "Shipped", "Delivered"]);
    expect(orderStepAt(paid)).toBe(0);
    expect(orderStepAt(at({ packed_at: "x", accepted_at: null, delivered_at: null }))).toBe(1);
    expect(orderStepAt(at({ packed_at: "x", accepted_at: "y", delivered_at: null }))).toBe(2);
    expect(orderStepAt(at({ packed_at: "x", accepted_at: "y", delivered_at: "z" }))).toBe(3);
    for (const f of [paid, at({ packed_at: "x", accepted_at: "y", delivered_at: "z" })]) {
      expect(orderWaitsOnYou(f)).toBe(false);
      expect(buyerNextAction(f)).toBeNull();
    }
  });

  it("the buyer's line at each step: the seller ships by the day, packed, the carrier's status, delivered", () => {
    const sh = { ship_by: SHIP_BY, tracking_status: "in_transit" };
    const line = (ship: Record<string, string | null> | null) => nextStepWords(buyerNextStep(buyerOrderFacts(order, { ship: ship as never }), null, null, null, null, undefined, sh));
    expect(line(null)).toBe("The seller packs it and ships it by Wed, Nov 4.");
    expect(line({ packed_at: "x", accepted_at: null, delivered_at: null })).toBe("Packed. The seller drops it off by Wed, Nov 4.");
    expect(line({ packed_at: "x", accepted_at: "y", delivered_at: null })).toBe("Shipped. In transit.");
    expect(line({ packed_at: "x", accepted_at: "y", delivered_at: "z" })).toBe("Delivered.");
  });

  it("the after-paying sheet says the seller ships it, never \"Book a pickup time\"", () => {
    const src = blankComments(readFileSync("src/components/declutter/BoughtWhatNext.tsx", "utf8"));
    const ship = src.slice(src.indexOf('case "ship":'), src.indexOf("case \"seller_delivery\":"));
    expect(ship).toContain("The seller ships it");
    expect(ship).not.toMatch(/pickup/i);
  });
});

describe("the seller's label part", () => {
  it("before Packed: print and pack, Ship by the day; Print label then Packed (the green primary, on the right)", async () => {
    state.label = ready();
    mount("seller");
    const line = await screen.findByText(/Next: print the label and pack it/);
    expect(line.closest("[data-next-step]")?.textContent).toBe("Next: print the label and pack it · Ship by Wed, Nov 4");
    expect(screen.getByText("9400111")).toBeTruthy();
    const row = screen.getByRole("button", { name: "Packed" }).parentElement!;
    const names = [...row.querySelectorAll("button")].map((b) => b.textContent);
    expect(names).toEqual(["Print label", "Packed"]);
    expect(screen.getByRole("button", { name: "Packed" }).className).toContain("btn-grad-primary");
    expect(screen.getByRole("button", { name: "Print label" }).className).not.toContain("btn-grad-primary");
    fireEvent.click(screen.getByRole("button", { name: "Print label" }));
    await waitFor(() => expect(state.opened).toEqual(["https://easypost-files.test/l.pdf"]));
    fireEvent.click(screen.getByRole("button", { name: "Packed" }));
    await waitFor(() => expect(state.rpc.some(([fn, a]) => fn === "declutter_mark_packed" && (a as { p_order_id: string }).p_order_id === "o1")).toBe(true));
    // After Packed the label is read again: drop it off, and no second Packed.
    const after = await screen.findByText(/Next: drop it off at USPS/);
    expect(after.closest("[data-next-step]")?.textContent).toBe("Next: drop it off at USPS · by Wed, Nov 4");
    expect(screen.queryByRole("button", { name: "Packed" })).toBeNull();
    expect(screen.getByRole("button", { name: "Print label" })).toBeTruthy();
  });

  it("after the carrier's scan: on its way, no buttons; delivered says when the payout comes", async () => {
    state.label = ready({ packed_at: "2026-11-02T15:00:00Z", accepted_at: "2026-11-03T15:00:00Z", tracking_status: "in_transit" });
    const { unmount } = mount("seller");
    await screen.findByText("On its way. In transit.");
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    expect(nextStepWords(sellerShipNext(ready({ accepted_at: "a", delivered_at: "b" }) as never))).toBe("Delivered. You get paid 24 hours later if nothing's wrong.");
  });

  it("no label yet (hold not captured) or a voided label: nothing to print or pack", async () => {
    state.label = ready({ label_url: null, tracking_code: null, ship_by: null, label_state: "claimed" });
    const { unmount } = mount("seller");
    await screen.findByText("Your shipping label is being made.");
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    expect(nextStepWords(sellerShipNext(ready({ label_url: null, label_state: "voided" }) as never))).toBe("This label was cancelled. Don't ship it.");
  });

  it("Packed with no time back from the server is not a write", async () => {
    state.packedReturns = null;
    await expect(markPacked("o1")).rejects.toThrow("label_not_ready");
  });
});

describe("the buyer's tracking part", () => {
  it("shows the USPS number and Track opens USPS's page", async () => {
    state.tracking = { ready: true, tracking_code: "9400111", tracking_status: "in_transit", ship_by: SHIP_BY, packed_at: null, accepted_at: null, delivered_at: null };
    mount("buyer");
    await screen.findByText("9400111");
    fireEvent.click(screen.getByRole("button", { name: "Track" }));
    await waitFor(() => expect(state.opened).toEqual(["https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111"]));
  });

  it("a UPS label: the buyer reads UPS tracking and Track opens UPS's page; the seller drops it off at UPS", async () => {
    state.tracking = { ready: true, service: "ups_ground", tracking_code: "1Z999", tracking_status: "in_transit", ship_by: SHIP_BY, packed_at: null, accepted_at: null, delivered_at: null };
    mount("buyer");
    expect((await screen.findByText("1Z999")).parentElement?.textContent).toBe("UPS tracking 1Z999");
    fireEvent.click(screen.getByRole("button", { name: "Track" }));
    await waitFor(() => expect(state.opened).toEqual(["https://www.ups.com/track?tracknum=1Z999"]));
    expect(nextStepWords(sellerShipNext(ready({ service: "ups_ground", packed_at: "x" }) as never))).toBe("Next: drop it off at UPS · by Wed, Nov 4");
  });

  it("before the label is made: says the number comes, no button", async () => {
    state.tracking = { ready: false, tracking_code: null, tracking_status: null, ship_by: null, packed_at: null, accepted_at: null, delivered_at: null };
    mount("buyer");
    await screen.findByText("The tracking number shows here once the label is made.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

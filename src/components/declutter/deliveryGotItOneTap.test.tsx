/**
 * Audit 1c D3-7 (2026-10-29, 1c-b4-gotit-press1-1440): on the buyer's delivered Helpr order, the first tap on
 * "I got it" only opened Details and a second tap was needed for "Do you have it?". The card now passes `askGot` to
 * OrderDeliveryPanel (buyingOrders.test.tsx proves the wiring); this file proves the panel opens its confirm sheet
 * from it, and only when the buyer may confirm (picked up or delivered), never for the seller or before pickup.
 *
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   useEffect(() => { if (mayAsk) setAskGot(true); }, [mayAsk]); |   useEffect(() => {}, [mayAsk]);
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const mayAsk = askOnOpen && !tipOnly && side === "buyer" && (task.data?.status === "picked_up" \|\| task.data?.status === "delivered"); |   const mayAsk = askOnOpen;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ status: "delivered" }));

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: undefined }) }));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchTaskView: async () => ({
    task_id: "t1", status: state.status, size: "small", title: "Blue mug", pickup_area: "Downtown", dropoff_area: "Baker",
    accepted_at: "2026-10-29T15:00:00Z", picked_up_at: state.status === "accepted" ? null : "2026-10-29T16:00:00Z",
    delivered_at: state.status === "delivered" ? "2026-10-29T17:00:00Z" : null, pickup_slot_start: "2026-10-29T15:30:00Z",
    helpr_first_name: "Hallie", pickup_photo_path: null, dropoff_photo_path: null, open_until: null,
  }),
  confirmReceived: vi.fn(),
  taskPhotoUrl: vi.fn(),
}));
vi.mock("@/lib/declutter/deliveryRaise", () => ({ fetchDeliveryRaiseStatus: async () => null, startDeliveryRaise: vi.fn() }));
vi.mock("@/lib/declutter/deliveryTip", () => ({ fetchMyPaidDeliveryTips: async () => [], fetchTipsOnMyDeliveries: async () => new Map(), startDeliveryTip: vi.fn() }));

import { OrderDeliveryPanel } from "./DeclutterDeliveryViews";

function show(side: "buyer" | "seller", askGot: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OrderDeliveryPanel taskId="t1" side={side} orderId="o1" askGot={askGot} /></QueryClientProvider>);
}

beforeEach(() => {
  state.status = "delivered";
});

describe("D3-7: OrderDeliveryPanel opens 'Do you have it?' when opened from the card's I got it", () => {
  it("asked from the card, a delivered order opens the sheet with no second tap", async () => {
    show("buyer", true);
    expect(await screen.findByText("Do you have it?")).toBeInTheDocument();
  });

  it("opened by Details (no ask), the sheet stays shut", async () => {
    show("buyer", false);
    expect(await screen.findByRole("button", { name: "I got it" })).toBeInTheDocument();
    expect(screen.queryByText("Do you have it?")).toBeNull();
  });

  it("never for the seller, and never before the Helpr has it", async () => {
    let n = 0;
    for (const [side, status] of [["seller", "delivered"], ["buyer", "accepted"]] as const) {
      state.status = status;
      const r = show(side, true);
      expect(await screen.findByText(/Blue mug/)).toBeInTheDocument();
      expect(screen.queryByText("Do you have it?")).toBeNull();
      r.unmount();
      n++;
    }
    expect(n).toBeGreaterThan(1);
  });
});

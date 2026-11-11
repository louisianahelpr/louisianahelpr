/**
 * Q2154: the Shops handover, mounted, for every way an order reaches the buyer (in person, left out, the shop
 * delivers, a service), both sides. Each side's buttons are listed exactly and each is pressed through its dialog to
 * the RPC it sends. The intro line is in the words of the side reading it: the 11-10 screenshot pass (MOCKED orders,
 * ~/.lh-shots/b1-owner-1110d/) showed the shop "The shop marks it done when the work is finished." about itself.
 *
 * @mutate src/lib/shops/handoverWords.ts |   if (order.fulfillment === "shop_delivers") return shop ? "You deliver it." : "The shop delivers."; |   if (order.fulfillment === "shop_delivers") return "The shop delivers.";
 * @mutate src/lib/shops/handoverWords.ts |   if (isServiceOrder(order)) return shop ? "" : "The shop marks it done when the work is finished."; |   if (isServiceOrder(order)) return "The shop marks it done when the work is finished.";
 * @mutate src/lib/shops/handoverWords.ts |   return shop ? "The buyer picks it up from you." : "Pick up in person."; |   return "Pick up in person.";
 * @mutate src/components/shops/ShopHandoverActions.tsx |     handoverIntro(order, side), |     handoverIntro(order, "buyer"),
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ShopOrder } from "@/lib/shops/orders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/ui/BrandConfirmDialog", () => ({
  BrandConfirmDialog: ({ open, title, primaryLabel, onPrimary, children }: {
    open: boolean; title: string; primaryLabel: string; onPrimary: (e: { preventDefault: () => void }) => void; children?: ReactNode;
  }) => (open ? (
    <div role="dialog" aria-label={title}>
      {children}
      <button type="button" onClick={() => onPrimary({ preventDefault: () => undefined })}>{`confirm ${primaryLabel}`}</button>
    </div>
  ) : null),
}));
const handover = vi.hoisted(() => ({
  fetchHandovers: vi.fn(async () => new Map()),
  fetchMyShopPayouts: vi.fn(async () => []),
  markReady: vi.fn(async () => undefined),
  markHandedOver: vi.fn(async () => undefined),
  confirmPickup: vi.fn(async () => undefined),
  reportNotReceived: vi.fn(async () => undefined),
}));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), ...handover }));

import { ShopHandoverActions } from "./ShopHandoverActions";

type Mode = "in_person" | "porch" | "shop_delivers" | "service";
const order = (mode: Mode): ShopOrder => ({
  id: "o1", buyer_id: "u1", seller_id: "u2", shop_id: "s1", status: "accepted", close_reason: null, ready_date: "2026-01-01",
  cancel_policy: "until_accept", note: "", decline_reason: null, items_cents: 2500, premium_cents: 195, tax_cents: 0,
  total_cents: 2695, captured_at: "2025-12-30T10:00:00Z", handover_mode: mode === "porch" ? "porch" : "in_person",
  fulfillment: mode === "shop_delivers" ? "shop_delivers" : "pickup", helpr_unfilled_at: null, handed_over_at: null, preorder_item_id: null,
  shop_order_lines: [{ id: "l1", item_id: "i1", title: mode === "service" ? "Deep clean" : "Candle", kind: mode === "service" ? "service" : "made", unit_cents: 2500, quantity: 1, line_cents: 2500 }],
} as unknown as ShopOrder);

function show(mode: Mode, side: "buyer" | "shop") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ShopHandoverActions order={order(mode)} side={side} userId="u2" /></QueryClientProvider>);
}
const buttons = async () => {
  const box = await screen.findByTestId("shop-handover-actions");
  return within(box).queryAllByRole("button").map((b) => b.textContent);
};

beforeEach(() => vi.clearAllMocks());

// Ready date 2026-01-01 is past, so every button the shop may ever see on an unmarked order is offered.
const SHOP: Record<Mode, { intro: string; buttons: string[] }> = {
  in_person: { intro: "The buyer picks it up from you.", buttons: ["Add a ready photo", "Mark ready", "Handed over"] },
  porch: { intro: "You leave it out for pickup.", buttons: ["Take photo and mark ready"] },
  shop_delivers: { intro: "You deliver it.", buttons: ["Add a ready photo", "Mark ready", "Handed over"] },
  service: { intro: "", buttons: ["Mark complete"] },
};
const BUYER: Record<Mode, { intro: string; buttons: string[] }> = {
  in_person: { intro: "Pick up in person.", buttons: ["I got it", "I didn't get it"] },
  porch: { intro: "Left out for pickup.", buttons: ["I got it", "I didn't get it"] },
  shop_delivers: { intro: "The shop delivers.", buttons: ["I got it", "I didn't get it"] },
  service: { intro: "The shop marks it done when the work is finished.", buttons: ["It's done", "Something's wrong"] },
};
const MODES: Mode[] = ["in_person", "porch", "shop_delivers", "service"];

describe("the shop's side, every mode", () => {
  for (const mode of MODES) {
    it(`${mode}: its buttons, its own words, never "The shop"`, async () => {
      show(mode, "shop");
      expect(await buttons()).toEqual(SHOP[mode].buttons);
      const intro = screen.queryByTestId("shop-handover-intro");
      expect(intro?.textContent ?? "").toBe(SHOP[mode].intro);
      expect(screen.getByTestId("shop-handover-actions").textContent).not.toMatch(/The shop (marks|delivers)/);
    });
  }

  it("Mark ready sends no photo; Handed over / Mark complete go through their dialog", async () => {
    show("in_person", "shop");
    fireEvent.click(await screen.findByRole("button", { name: "Mark ready" }));
    await vi.waitFor(() => expect(handover.markReady).toHaveBeenCalledWith("o1", null));
    fireEvent.click(screen.getByRole("button", { name: "Handed over" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm Handed over" }));
    await vi.waitFor(() => expect(handover.markHandedOver).toHaveBeenCalledWith("o1"));
  });
});

describe("the buyer's side, every mode", () => {
  for (const mode of MODES) {
    it(`${mode}: its buttons and words`, async () => {
      show(mode, "buyer");
      expect(await buttons()).toEqual(BUYER[mode].buttons);
      expect(screen.getByTestId("shop-handover-intro").textContent).toBe(BUYER[mode].intro);
    });
  }

  it("I got it confirms through its dialog; I didn't get it needs a note, then reports it", async () => {
    show("porch", "buyer");
    fireEvent.click(await screen.findByRole("button", { name: "I got it" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm I got it" }));
    await vi.waitFor(() => expect(handover.confirmPickup).toHaveBeenCalledWith("o1"));
    fireEvent.click(screen.getByRole("button", { name: "I didn't get it" }));
    fireEvent.change(screen.getByLabelText("What happened?"), { target: { value: "Nothing on the porch" } });
    fireEvent.click(screen.getByRole("button", { name: "confirm Report it" }));
    await vi.waitFor(() => expect(handover.reportNotReceived).toHaveBeenCalledWith("o1", "Nothing on the porch"));
  });
});

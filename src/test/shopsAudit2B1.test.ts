/**
 * GUARD (Shops audit 2, 11-12, Builder 1 list S2-034..S2-044).
 *   S2-034 custom orders have one switch: the shop page reads only shops.custom_orders, and Edit my shop's "Custom
 *          orders" box shows and sets that switch (no "Quotes for work").
 *   S2-037 the shop's own order card reads "Waiting for your answer", never the buyer's "Waiting for the shop".
 *   S2-041 each Edit my shop part that saves on its own reports unsaved edits (render guard: shopEditUnsaved.test.tsx).
 *   S2-044 an accepted order whose cancel window already closed no longer promises a free cancel.
 */
import { describe, expect, it } from "vitest";
import { orderCancelLine, orderStatusLabel } from "@/lib/shops/orders";

const base = {
  status: "accepted" as const,
  handed_over_at: null,
  preorder_item_id: null,
  ready_tap_cancel: "from_day_before" as const,
  ready_date: "2026-11-20",
};

describe("Shops audit 2 (Builder 1)", () => {
  it("S2-044: accepted until_accept order says the free-cancel time ended", () => {
    const line = orderCancelLine({ ...base, cancel_policy: "until_accept" }, new Date(2026, 10, 12));
    expect(line).not.toMatch(/Free to cancel until the shop accepts/);
    expect(line).toBe("The free-cancel time ended when the shop accepted.");
  });
  it("S2-044: a waiting until_accept order still shows the rule", () => {
    expect(orderCancelLine({ ...base, status: "held", cancel_policy: "until_accept" })).toBe("Free to cancel until the shop accepts.");
  });
  it("S2-044: date rules show until the cutoff, then say it ended", () => {
    const o = { ...base, cancel_policy: "until_24h_before_ready" as const };
    expect(orderCancelLine(o, new Date(2026, 10, 18, 12))).toBe("Cancel for a refund until 24 hours before the ready date.");
    expect(orderCancelLine(o, new Date(2026, 10, 19, 1))).toBe("The cancel-for-a-refund time has ended.");
    const h = { ...base, cancel_policy: "until_handover" as const };
    expect(orderCancelLine(h, new Date(2026, 10, 19, 23))).toMatch(/^Cancel for a refund until/);
    expect(orderCancelLine(h, new Date(2026, 10, 20, 0, 1))).toBe("The cancel-for-a-refund time has ended.");
  });
  it("S2-044: finished orders show nothing; the card uses the helper", async () => {
    expect(orderCancelLine({ ...base, status: "accepted", handed_over_at: "x", cancel_policy: "until_accept" })).toBeNull();
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/shops/ShopOrderCard.tsx", "utf8");
    expect(src).toContain("orderCancelLine(order)");
    expect(src).not.toContain("cancelPolicyText(order.cancel_policy, order.ready_tap_cancel).label");
  });
  it("S2-034: one switch for custom orders", async () => {
    const { readFileSync } = await import("node:fs");
    const view = readFileSync("src/components/shops/ShopView.tsx", "utf8");
    expect(view).toContain('const takesCustom = !!customOrders.data && customOrders.data !== "off";');
    expect(view).not.toMatch(/takesCustom = s\.offers_quotes/);
    const edit = readFileSync("src/components/shops/ShopEditView.tsx", "utf8");
    expect(edit).not.toContain("Quotes for work");
    expect(edit).toContain("Custom orders (made to order)");
    expect(edit).toContain('offersQuotes: customMode.data ? customMode.data !== "off" : s.offers_quotes,');
    expect(edit).toContain('await setCustomOrders(form.offersQuotes ? "full_hold" : "off");');
  });
  it("S2-037: the shop side reads its own status words", () => {
    const held = { status: "held" as const, close_reason: null, captured_at: null };
    expect(orderStatusLabel(held, "shop")).toBe("Waiting for your answer (card held, not charged)");
    expect(orderStatusLabel(held, "buyer")).toBe("Waiting for the shop (card held, not charged)");
    const acc = { status: "accepted" as const, close_reason: null, captured_at: null };
    expect(orderStatusLabel(acc, "shop")).toBe("Accepted (charging the buyer's card)");
    expect(orderStatusLabel(acc, "buyer")).toBe("Accepted (charging your card)");
  });
  it("S2-041: the parts that save on their own report unsaved edits", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/components/shops/ShopFaqsEditor.tsx", "utf8")).toContain('useReportUnsaved("Questions buyers ask",');
    expect(readFileSync("src/components/shops/ShopPickupAddressSection.tsx", "utf8")).toContain('useReportUnsaved("Pickup address",');
    expect(readFileSync("src/components/shops/ShopDailyCap.tsx", "utf8")).toContain('useReportUnsaved("Daily order limit",');
  });
});

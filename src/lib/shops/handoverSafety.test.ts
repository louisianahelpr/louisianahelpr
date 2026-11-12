/**
 * S055 (Shops audit 11-12): the buyer's order says which safety net its handover has. Left out: no ready photo by 3
 * days after the ready day refunds the card in full on its own (shop_refund_sweep, 20261108184654). In person: the
 * money stays held until "I got it" or the shop's "Handed over". Pickup goods only, and only before that step.
 *
 * @mutate src/lib/shops/handoverWords.ts |     return h?.ready_photo_path ? null\n |     return false ? null\n
 * @mutate src/lib/shops/handoverWords.ts |   return h?.shop_confirmed_at ? null\n |   return false ? null\n
 * @mutate src/lib/shops/handoverWords.ts |   if (!pickup) return null;\n |
 * @mutate src/lib/shops/handoverWords.ts |   if (isServiceOrder(order)) return null;\n  const pickup | const pickup
 * @mutate src/components/shops/ShopHandoverActions.tsx | {side === "buyer" && buyerHandoverSafety(order, h) && ( | {false && (
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buyerHandoverSafety } from "./handoverWords";

const goods = { shop_order_lines: [{ kind: "made" }], fulfillment: "pickup", helpr_unfilled_at: null } as never;
const order = (o: Record<string, unknown>) => ({ ...(goods as object), ...o }) as Parameters<typeof buyerHandoverSafety>[0];

describe("S055: the buyer reads which safety net the handover has", () => {
  it("left out, before the ready photo: the automatic full refund", () => {
    expect(buyerHandoverSafety(order({ handover_mode: "porch" }), null)).toBe(
      "If the shop hasn't posted its ready photo 3 days after the ready day, your card is refunded in full.",
    );
    expect(buyerHandoverSafety(order({ handover_mode: "porch" }), { ready_photo_path: "x.jpg" })).toBeNull();
  });

  it("in person, before the shop's Handed over: nothing pays on its own", () => {
    expect(buyerHandoverSafety(order({ handover_mode: "in_person" }), { ready_photo_path: null })).toMatch(/money stays held if the pickup doesn't happen/);
    expect(buyerHandoverSafety(order({ handover_mode: "in_person" }), { ready_photo_path: null, shop_confirmed_at: "2026-11-12T10:00:00Z" })).toBeNull();
  });

  it("never on a delivery or a service", () => {
    expect(buyerHandoverSafety(order({ handover_mode: "porch", fulfillment: "shop_delivers" }), null)).toBeNull();
    expect(buyerHandoverSafety(order({ handover_mode: "porch", fulfillment: "helpr_delivers" }), null)).toBeNull();
    expect(buyerHandoverSafety(order({ handover_mode: "porch", fulfillment: "helpr_delivers", helpr_unfilled_at: "2026-11-12" }), null)).not.toBeNull();
    expect(buyerHandoverSafety(order({ handover_mode: "in_person", shop_order_lines: [{ kind: "service" }] }), null)).toBeNull();
  });

  it("the buyer's order card shows it", () => {
    const src = readFileSync(resolve(__dirname, "../../components/shops/ShopHandoverActions.tsx"), "utf8");
    expect(src).toContain('{side === "buyer" && buyerHandoverSafety(order, h) && (');
    expect(src).toContain('data-testid="shop-handover-safety">{buyerHandoverSafety(order, h)}</p>');
  });
});

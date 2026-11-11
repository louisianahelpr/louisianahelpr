/**
 * F363 side effect (a) (owner pop-up 11-11 morning): "count each order ONCE in the Needs you chip". An order with two
 * moves on it (a refund offer to answer AND its handover still to do) was two Home To-do rows, so the Buying "Needs
 * you" chip (counts.needs_you = the Home To-do Buying rows, BuyingOrders) said 2 over ONE card, and Home and the
 * badges said 2 as well. Each order is now one row: the dated refund row wins and the handover row for that order is
 * dropped, for either side. The chip, its cards and the Home To-do count stay equal because all three read these rows.
 *
 * Every combination of side x refund status x handover is built here; for each, the rows per order are counted.
 *
 * @mutate src/lib/declutter/declutterTodos.ts |     if (ordersWithRow.has(id)) continue; |
 * @mutate src/lib/declutter/declutterTodos.ts |     ordersWithRow.add(r.order_id); |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { declutterBuyingTodos, declutterTodos } from "@/lib/declutter/declutterTodos";
import { deriveNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import { isDeclutterBuyingTodo } from "@/lib/declutter/buyingTodo";
import type { CartLine } from "@/lib/declutter/api";
import type { MyRefundTodo } from "@/lib/declutter/refundRequests";
import { blankComments } from "./helpers/blankNonCode";

const NOW = Date.UTC(2026, 10, 11, 15, 0, 0);
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

const line = (over: Partial<CartLine>): CartLine => ({
  line_id: "l1", item_id: "i1", item_title: "Brass lamp", my_side: "buyer", seller_id: "s1", price_cents: 800, status: "paid",
  checkout_by: inHours(20), order_id: "ord1", order_status: "paid", handover: "pickup_home", premium_cents: null, total_cents: 800,
  porch_ok: true, ...over,
}) as CartLine;
const refund = (over: Partial<MyRefundTodo>): MyRefundTodo => ({
  request_id: "r1", order_id: "ord1", my_side: "buyer", status: "offered", due_at: inHours(10), title: "Brass lamp", item_count: 1, ...over,
});

/** The order a declutter row is about: dh-<order>, or the refund's order. */
function orderOf(id: string, refunds: readonly MyRefundTodo[]): string | null {
  if (id.startsWith("dh-")) return id.slice(3);
  if (id.startsWith("dr-")) return refunds.find((r) => `dr-${r.request_id}` === id)?.order_id ?? null;
  return null;
}

describe("F363 (owner 11-11): each order is ONE Needs you row, even with two moves on it", () => {
  it("every side x refund status x handover: one row per order, and the Home count equals the chip count", () => {
    let combos = 0;
    for (const side of ["buyer", "seller"] as const) {
      for (const status of ["open", "offered"] as const) {
        for (const handover of ["pickup_home", "porch", "meetup", "seller_delivery"]) {
          const cart = [
            line({ my_side: side, handover }),
            // A second order with only its handover: still its own row.
            line({ line_id: "l2", item_id: "i2", item_title: "Oak chair", order_id: "ord2", my_side: side, handover }),
          ];
          const refunds = [refund({ my_side: side, status })];
          const rows = declutterTodos(cart, [], NOW, refunds).map((r) => r.item);
          const perOrder = new Map<string, number>();
          for (const r of rows) {
            const o = orderOf(r.id, refunds);
            if (o) perOrder.set(o, (perOrder.get(o) ?? 0) + 1);
          }
          const label = `${side} ${status} ${handover}`;
          expect(Object.fromEntries(perOrder), label).toEqual({ ord1: 1, ord2: 1 });
          expect(rows.find((r) => orderOf(r.id, refunds) === "ord1")?.id, `${label}: the dated refund row wins`).toBe("dr-r1");
          // The Home To-do list's Declutter Buying rows are the chip's rows (BuyingOrders: counts.needs_you).
          const home = deriveNeedsYouTodos({ postedJobs: [], pendingApplicantCounts: {}, appliedApps: [], shopOrders: [], backout: new Map(), declutterCart: cart, declutterRefunds: refunds }, NOW)
            .filter(isDeclutterBuyingTodo);
          expect(home.length, label).toBe(declutterBuyingTodos(cart, [], refunds, NOW).length);
          expect(home.length, label).toBe(side === "buyer" ? 2 : 0);
          combos++;
        }
      }
    }
    expect(combos).toBeGreaterThan(10);
  });

  it("the Buying chip counts the Home To-do Buying rows (the same rows the bucket set is built from)", () => {
    const src = blankComments(readFileSync("src/components/declutter/BuyingOrders.tsx", "utf8"));
    expect(src).toMatch(/const homeRows = declutterBuyingTodos\(/);
    expect(src).toMatch(/counts\.needs_you = homeRows\.length;/);
  });
});

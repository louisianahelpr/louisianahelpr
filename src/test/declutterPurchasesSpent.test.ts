/**
 * A3-112 parity: Spent's Declutter purchases (purchaseSpend.purchaseRows) use Receipts' rule for a paid order
 * (orderReceipts): the same orders, the same charged amount, a refunded order at $0 in Spent where Receipts shows
 * "Refunded" with no total. If either rule moves, this goes red.
 *
 * @mutate src/lib/declutter/purchaseSpend.ts | .filter((o) => o.paid_at && COUNTED.includes(o.status))\n    .map((o) => { | .filter((o) => COUNTED.includes(o.status))\n    .map((o) => {
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { purchaseRows } from "@/lib/declutter/purchaseSpend";
import { orderReceipts } from "@/pages/profile/Receipts";

const orders = [
  { id: "a", status: "paid", total_cents: 1200, paid_at: "2026-10-01T10:00:00Z" },
  { id: "b", status: "handed_over", total_cents: 3000, paid_at: "2026-10-02T10:00:00Z" },
  { id: "c", status: "refunded", total_cents: 900, paid_at: "2026-10-03T10:00:00Z" },
  { id: "d", status: "awaiting_payment", total_cents: 500, paid_at: null },
  { id: "e", status: "cancelled", total_cents: 700, paid_at: "2026-10-04T10:00:00Z" },
  { id: "f", status: "paid", total_cents: 800, paid_at: null },
];
const titles = new Map([["a", ["Mug"]], ["b", ["Chair", "Lamp"]]]);
const paid = new Map([["b", 3200]]);

describe("A3-112: Spent purchases follow Receipts' paid-order rule", () => {
  it("same orders, same amounts, same titles", () => {
    const spent = purchaseRows(orders, titles, paid);
    const receipts = orderReceipts(orders, titles, paid);
    expect(spent.length).toBeGreaterThan(2);
    expect(spent.map((r) => r.id)).toEqual(receipts.map((r) => r.key.replace("order-", "")));
    expect(spent.map((r) => r.title)).toEqual(receipts.map((r) => r.title));
    expect(spent.map((r) => (r.refunded ? null : r.cents))).toEqual(receipts.map((r) => r.cents));
    expect(spent.find((r) => r.id === "c")).toMatchObject({ cents: 0, refunded: true });
  });
});

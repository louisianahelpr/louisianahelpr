/**
 * A3-112 parity: Spent's Declutter purchases (purchaseSpend.purchaseRows) use Receipts' rule for a paid order
 * (orderReceipts): the same orders, the same charged amount, a refunded order at $0 in Spent where Receipts shows
 * "Refunded" with no total. If either rule moves, this goes red.
 *
 * A3-112 follow-up (B137): a PART refund (declutter_my_refunded_cents) is netted the same way on both screens, and said
 * "· $15.00 refunded"; a fully refunded order keeps "Refunded".
 * @mutate src/lib/declutter/purchaseSpend.ts |   return purchaseRows(orders, titles, paid, back); |   return purchaseRows(orders, titles, paid);
 * @mutate src/lib/declutter/purchaseSpend.ts | cents: refunded ? 0 : net.cents, | cents: refunded ? 0 : paid?.get(o.id) ?? o.total_cents,
 * @mutate src/pages/profile/Receipts.tsx |         cents: o.status === "refunded" ? null : netOfRefund(charged, refundedBack?.get(o.id)).cents, |         cents: o.status === "refunded" ? null : charged,
 * @mutate src/pages/profile/Receipts.tsx | paid.data ?? null, back.data ?? null)); | paid.data ?? null));
 * @mutate src/lib/declutter/refundedCents.ts |   return { cents: Math.max(0, charged - back), note: | return { cents: charged - back, note:
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

  it("a part refund is netted and said the same way on both screens; never below $0; a full refund keeps Refunded", () => {
    const back = new Map([["a", 500], ["b", 99999], ["c", 900]]);
    const spent = purchaseRows(orders, titles, paid, back);
    const receipts = orderReceipts(orders, titles, paid, back);
    expect(spent.find((r) => r.id === "a")).toMatchObject({ cents: 700, note: " · $5.00 refunded" });
    expect(receipts.find((r) => r.key === "order-a")).toMatchObject({ cents: 700, note: " · $5.00 refunded" });
    expect(spent.find((r) => r.id === "b")?.cents).toBe(0);
    expect(receipts.find((r) => r.key === "order-b")?.cents).toBe(0);
    expect(spent.find((r) => r.id === "c")).toMatchObject({ cents: 0, refunded: true, note: " · Refunded" });
    expect(receipts.find((r) => r.key === "order-c")).toMatchObject({ cents: null, note: " · Refunded" });
    expect(spent.map((r) => (r.refunded ? null : r.cents))).toEqual(receipts.map((r) => r.cents));
    expect(spent.map((r) => r.note)).toEqual(receipts.map((r) => r.note));
  });

  it("the Spent read fetches what came back and both screens pass it on", async () => {
    const { readFileSync } = await import("node:fs");
    const { blankComments } = await import("@/test/helpers/blankNonCode");
    const spendSrc = blankComments(readFileSync("src/lib/declutter/purchaseSpend.ts", "utf8"));
    expect(spendSrc).toContain("fetchMyRefundedCents(");
    expect(spendSrc).toContain("return purchaseRows(orders, titles, paid, back);");
    const rec = blankComments(readFileSync("src/pages/profile/Receipts.tsx", "utf8"));
    expect(rec).toContain("queryFn: () => fetchMyRefundedCents(paidIds)");
    expect(rec).toContain("paid.data ?? null, back.data ?? null));");
    expect(blankComments(readFileSync("src/components/profile/earningsTab/SpentSection.tsx", "utf8"))).toContain("{p.note}");
  });
});

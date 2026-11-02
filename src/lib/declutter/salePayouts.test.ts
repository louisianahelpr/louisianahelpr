/**
 * A3-56: Money > Earned counts Declutter sales and lists each sale payout. The read joins the seller's payout rows
 * (fetchMyPayouts) to the paid cart lines' item titles; a sale counts in Earned once its payout succeeded, on the day
 * it was sent.
 *
 * @mutate src/lib/declutter/salePayouts.ts |   const sent = rows.filter((r) => r.status === "succeeded" && r.executed_at && (sinceMs === null \|\| Date.parse(r.executed_at) >= sinceMs)); |   const sent = rows.filter((r) => sinceMs === null \|\| Date.parse(r.executed_at ?? "0") >= sinceMs);
 * @mutate src/lib/declutter/salePayouts.ts |     .filter((p) => p.status !== "nothing_due") |     .filter(() => true)
 * @mutate src/lib/declutter/salePayouts.ts |       const title = t.length === 0 ? "Declutter sale" : t.length === 1 ? t[0] : `${t[0]} and ${t.length - 1} more`; |       const title = "Declutter sale";
 * @mutate src/lib/declutter/salePayouts.ts |   if (r.status === "failed") return "Didn't go through"; |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ payouts: [] as unknown[], lines: [] as unknown[], calls: [] as unknown[][] }));
vi.mock("@/lib/declutter/handover", () => ({ fetchMyPayouts: async () => h.payouts }));
vi.mock("@/integrations/supabase/client", () => {
  const q = () => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) self[m] = (...a: unknown[]) => { h.calls.push([m, ...a]); return self; };
    (self as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: h.lines, error: null });
    return self;
  };
  return { supabase: { from: (t: string) => { h.calls.push(["from", t]); return q(); } } };
});

import { fetchMySalePayouts, salePayoutWords, salesEarnedIn, type SalePayout } from "./salePayouts";

const pay = (order_id: string, status: string, amount_cents: number, executed_at: string | null) =>
  ({ order_id, items_cents: amount_cents, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, amount_cents, status, executed_at });

beforeEach(() => { h.calls = []; });

describe("Declutter sale payouts in Money > Earned (A3-56)", () => {
  it("names each payout by its item, drops nothing-due rows, newest first, and reads only the seller's own lines", async () => {
    h.payouts = [pay("o1", "succeeded", 4000, "2026-10-29T15:00:00Z"), pay("o2", "pending", 2500, null), pay("o3", "nothing_due", 0, null),
      pay("o4", "succeeded", 1800, "2026-10-30T15:00:00Z")];
    h.lines = [{ order_id: "o1", item_title: "Oak rocking chair" }, { order_id: "o4", item_title: "Lamp" }, { order_id: "o4", item_title: "Rug" }];
    const rows = await fetchMySalePayouts("s1");
    expect(rows.map((r) => [r.order_id, r.title])).toEqual([["o2", "Declutter sale"], ["o4", "Lamp and 1 more"], ["o1", "Oak rocking chair"]]);
    expect(h.calls).toContainEqual(["from", "declutter_cart_items"]);
    expect(h.calls).toContainEqual(["eq", "seller_id", "s1"]);
  });

  it("Earned counts only sent payouts, inside the range", () => {
    const rows = [pay("a", "succeeded", 4000, "2026-10-29T15:00:00Z"), pay("b", "succeeded", 1000, "2026-09-01T15:00:00Z"),
      pay("c", "pending", 9999, null), pay("d", "failed", 7777, null)].map((r) => ({ ...r, title: "x" })) as SalePayout[];
    expect(salesEarnedIn(rows, null)).toEqual({ cents: 5000, count: 2 });
    expect(salesEarnedIn(rows, Date.parse("2026-10-01T00:00:00Z"))).toEqual({ cents: 4000, count: 1 });
  });

  it("each row's words: Paid <day> / Not sent yet / Didn't go through", () => {
    const r = (status: string, at: string | null) => ({ ...pay("o", status, 100, at), title: "x" }) as SalePayout;
    expect(salePayoutWords(r("succeeded", "2026-10-29T15:00:00Z"))).toBe("Paid Oct 29");
    expect(salePayoutWords(r("pending", null))).toBe("Not sent yet");
    expect(salePayoutWords(r("failed", null))).toBe("Didn't go through");
  });
});

/**
 * Shops launch pass 2 (2026-11-18): server notices about a cancelled Shops order use the buyer's words (S2-030):
 * "free" only for until_accept, "refund" for the date rules. An accepted order is only cancellable under a date rule,
 * so no newest Shops function body may say "free-cancel time" in its text (20261118055756 changed the last four in
 * shops_buyer_cancel_order). Class guard over every newest function body that touches shop_orders.
 */
// @mutate supabase/migrations/20261118055756_shops_cancel_notices_refund_words.sql | inside your refund time. Do not make it. | inside your free-cancel time. Do not make it.
// @mutate supabase/migrations/20261118055756_shops_cancel_notices_refund_words.sql | 'The cancel-for-a-refund time for this order has changed. | 'The free-cancel time for this order has changed.
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));

describe("Shops cancel notices say refund time, not free-cancel time", () => {
  const shopFns = [...DEFS.entries()].filter(([, d]) => /shop_orders/.test(blankSqlComments(d.stmt)));

  it("reads a real inventory (floor)", () => {
    expect(shopFns.length).toBeGreaterThan(40);
    expect(shopFns.map(([n]) => n)).toContain("shops_buyer_cancel_order");
  });

  it("no newest Shops function body says free-cancel time", () => {
    const bad = shopFns.filter(([, d]) => /free[- ]cancel time/i.test(blankSqlComments(d.stmt))).map(([n]) => n);
    expect(bad).toEqual([]);
  });

  it("the buyer's late-cancel notice and the hint use the buyer's words", () => {
    const body = blankSqlComments(DEFS.get("shops_buyer_cancel_order")?.stmt ?? "");
    expect(body).toContain("The cancel-for-a-refund time for this order has changed.");
    expect(body).toContain("after the shop''s cancel-for-a-refund time, so nothing is refunded");
    expect(body).toContain("inside your refund time. Do not make it.");
  });
});

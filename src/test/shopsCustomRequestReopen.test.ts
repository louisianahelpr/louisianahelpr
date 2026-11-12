/**
 * S2-020 (Shops audit 2, the rest): a request that became an order reopens when that order closes uncharged (the shop
 * declines, its 24 hours run out, the buyer cancels before the accept): 'quoted' while its price is good, 'expired'
 * after. A charged order never reopens it. Behaviour: src/test/pglite/shopsCustomRequestReopen.pglite.mjs (3x;
 * NEW_MIGRATION=skip RED; 5 planted defects RED). S2-021: the shop's notice names the answer-by day (same file).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SQL = readFileSync("supabase/migrations/20261112224850_shops_custom_request_reopen.sql", "utf8");

describe("S2-020 a request reopens when its held order closes uncharged", () => {
  it("only an order leaving 'held' for an uncharged close, only its own accepted request", () => {
    expect(SQL).toContain("IF OLD.status = 'held' AND NEW.status IN ('declined', 'expired', 'cancelled') THEN");
    expect(SQL).toMatch(/WHERE cr\.order_id = NEW\.id\s+AND cr\.status = 'accepted'\s+RETURNING/);
    // Past its 7 days the buyer hears the price ended (as the request sweep says it), never across a block.
    expect(SQL).toContain("CONTINUE WHEN v_owner IS NULL OR public.are_users_blocked(r.buyer_id, v_owner);");
    expect(SQL).toContain("SET status = CASE WHEN cr.expires_at > now() THEN 'quoted' ELSE 'expired' END,");
    expect(SQL).toContain("CREATE TRIGGER trg_shop_orders_custom_request_reopen AFTER UPDATE OF status ON public.shop_orders");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.shop_orders_custom_request_reopen() FROM PUBLIC, anon, authenticated;");
  });
});

describe("S2-021 the shop's new-request notice names the day to answer by", () => {
  it("7 days out, or the wanted date when sooner", () => {
    expect(SQL).toContain("Send a price or decline it by %s.");
    expect(SQL).toContain("to_char(LEAST(p_wanted_date, v_today + 7), 'FMMonth FMDD')");
  });
});

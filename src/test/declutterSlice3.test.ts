/**
 * Declutter slice 3 (20261014210518_declutter_slice3_offers_checkout; owner rows
 * 13, 16-22, 36, 38, 53, 56-59 and build decisions B25-B38 in
 * docs/specs/declutter-auctions.md). The fast half of the proof, read from the
 * NEWEST definitions the migrations leave (effectiveDefs), so a later
 * restatement that drops a lock or a gate fails here.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/declutterSlice3.pglite.mjs.
 * Concurrency (two real sessions, 6 races x 20 rounds, red on a planted
 * unlocked copy): scripts/declutter/race-accept.mjs.
 *
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql |    WHERE id = p_item_id AND status = 'live'\n  RETURNING seller_id, title INTO v_seller, v_title; |    WHERE id = p_item_id\n  RETURNING seller_id, title INTO v_seller, v_title;
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql |    WHERE i.id = p_item_id\n   FOR UPDATE; |    WHERE i.id = p_item_id;
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql | CREATE UNIQUE INDEX IF NOT EXISTS declutter_offers_one_accepted | CREATE INDEX IF NOT EXISTS declutter_offers_one_accepted
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql | CREATE UNIQUE INDEX IF NOT EXISTS declutter_cart_one_active | CREATE INDEX IF NOT EXISTS declutter_cart_one_active
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql |   SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE; |   SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql |   IF p_amount_cents * 2 < v_item.o_price_cents THEN |   IF false THEN
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql | greatest(p.floor_price_cents, floor(i.current_price_cents * 0.95)::integer) | floor(i.current_price_cents * 0.95)::integer
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql |        AND (i.last_price_drop_on IS NULL OR i.last_price_drop_on < v_today) |        AND true
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql | REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql |         AND NOT public.declutter_seller_hidden(seller_id)) |         AND true)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261014210518_declutter_slice3_offers_checkout.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const CLIENT_WRITES = ["declutter_make_offer", "declutter_respond_offer", "declutter_buy_now", "declutter_start_checkout", "declutter_seller_cancel_sale"];
const CLIENT_READS = ["declutter_my_offers", "declutter_my_cart"];
const SERVICE_ONLY = [
  "declutter_take_item", "declutter_lock_buyable_item", "declutter_mark_order_paid", "declutter_attach_checkout_session",
  "declutter_deadline_sweep", "declutter_price_drop_sweep", "declutter_give_strike", "declutter_notify", "declutter_member_out", "declutter_seller_out",
  "declutter_trade_rows_seed",
];

describe("Declutter slice 3: offers, price drops, checkout records, strikes (20261014210518)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of [...CLIENT_WRITES, ...CLIENT_READS, ...SERVICE_ONLY, "declutter_seller_hidden"]) expect(body(fn), fn).not.toBe("");
    expect(MIG.length).toBeGreaterThan(20_000);
  });

  it("every client RPC needs the switch; every write names is_caller_banned(); buyer writes are age-gated (row 53)", () => {
    for (const fn of [...CLIENT_WRITES, ...CLIENT_READS]) expect(body(fn), fn).toMatch(/\bBEGIN\s+PERFORM\s+public\.require_feature\('declutter'\);/);
    for (const fn of CLIENT_WRITES) expect(body(fn), fn).toMatch(/public\.is_caller_banned\(\)/);
    for (const fn of ["declutter_make_offer", "declutter_respond_offer", "declutter_buy_now", "declutter_start_checkout"]) {
      expect(body(fn), fn).toContain("public.declutter_assert_member(true)");
    }
  });

  it("B29: the one take-off-sale path locks, predicates on 'live', and two unique indexes back it up", () => {
    expect(flat(body("declutter_lock_buyable_item"))).toContain("WHERE i.id = p_item_id FOR UPDATE;");
    expect(flat(body("declutter_take_item"))).toContain("SET status = 'reserved', updated_at = now() WHERE id = p_item_id AND status = 'live'");
    expect(flat(body("declutter_respond_offer"))).toContain("FROM public.declutter_items i WHERE i.id = v_item_id FOR UPDATE;");
    expect(flat(MIG)).toContain("CREATE UNIQUE INDEX IF NOT EXISTS declutter_offers_one_accepted ON public.declutter_offers (item_id) WHERE status = 'accepted';");
    expect(flat(MIG)).toContain("CREATE UNIQUE INDEX IF NOT EXISTS declutter_cart_one_active ON public.declutter_cart_items (item_id) WHERE status IN ('in_cart', 'paid');");
    expect(flat(MIG)).toContain("CREATE UNIQUE INDEX IF NOT EXISTS declutter_orders_one_awaiting ON public.declutter_orders (buyer_id, seller_id) WHERE status = 'awaiting_payment';");
    for (const fn of ["declutter_respond_offer", "declutter_buy_now"]) expect(body(fn), fn).toContain("public.declutter_take_item(");
  });

  it("row 58 + B26: offers >= half the CURRENT price; nothing a buyer is told depends on the hidden floor", () => {
    expect(flat(body("declutter_make_offer"))).toContain("IF p_amount_cents * 2 < v_item.o_price_cents THEN RAISE EXCEPTION 'offer_too_low'");
    for (const fn of ["declutter_make_offer", "declutter_respond_offer", "declutter_buy_now", "declutter_lock_buyable_item", "declutter_take_item"]) {
      expect(body(fn), fn).not.toMatch(/floor_price_cents/);
    }
    expect(flat(body("declutter_my_offers"))).toContain("CASE WHEN o.seller_id = v_uid THEN p.floor_price_cents END");
  });

  it("rows 20-22, 38: the premium rule lives in the table, and checkout freezes it", () => {
    expect(flat(MIG)).toContain("CONSTRAINT declutter_orders_premium_rule CHECK (premium_cents = greatest(round(items_cents * 0.15)::integer, 100))");
    expect(flat(MIG)).toContain("CONSTRAINT declutter_orders_total CHECK (total_cents = items_cents + premium_cents + tax_cents)");
    expect(flat(body("declutter_start_checkout"))).toContain("v_premium := greatest(round(v_items * 0.15)::integer, 100);");
    expect(flat(body("declutter_start_checkout"))).toContain("RAISE EXCEPTION 'seller_tax_not_ready'");
  });

  it("the webhook path is service-only, idempotent, and refunds in full what it cannot honour", () => {
    const paid = flat(body("declutter_mark_order_paid"));
    expect(paid).toContain("SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;");
    expect(paid).toContain("THEN 'already_paid' ELSE 'refund_in_full' END");
    expect(paid).toContain("IF o.status <> 'awaiting_payment' OR p_amount_cents IS DISTINCT FROM o.total_cents OR p_payment_intent_id IS NULL THEN RETURN 'refund_in_full';");
  });

  it("row 56: the evening drop is 5%, never below the floor, once per Louisiana day; both crons are watched", () => {
    const drop = flat(body("declutter_price_drop_sweep"));
    expect(drop).toContain("greatest(p.floor_price_cents, floor(i.current_price_cents * 0.95)::integer)");
    expect(drop).toContain("AND (i.last_price_drop_on IS NULL OR i.last_price_drop_on < v_today)");
    expect(drop).toContain("(now() AT TIME ZONE 'America/Chicago')::date");
    for (const job of ["declutter-deadlines", "declutter-price-drops"]) {
      expect(MIG, job).toContain(`('${job}', interval`);
      expect(MIG, job).toContain(`cron.schedule('${job}'`);
    }
  });

  it("rows 7, 13, 19, 59: missed checkout and seller cancel give strikes", () => {
    expect(flat(body("declutter_deadline_sweep"))).toContain("public.declutter_give_strike(v_line.buyer_id, 'buyer', 'missed_checkout'");
    // Review must-fix: a seller who blocked the buyer takes the strike; a seller who can't sell strikes nobody.
    expect(flat(body("declutter_deadline_sweep"))).toContain("public.declutter_give_strike(v_line.seller_id, 'seller', 'cancelled_after_offers'");
    expect(flat(body("declutter_deadline_sweep"))).toContain("ELSIF public.declutter_seller_out(v_line.seller_id) THEN");
    expect(flat(body("declutter_seller_cancel_sale"))).toContain("public.declutter_give_strike(v_uid, 'seller', 'cancelled_after_offers'");
    expect(flat(body("declutter_give_strike"))).toContain("You have %s of 3 strikes.");
  });

  it("B36: a banned or 3-strike seller's listings are hidden from buyers", () => {
    expect(flat(MIG)).toContain("AND NOT public.declutter_seller_hidden(seller_id))");
    expect(flat(body("declutter_lock_buyable_item"))).toContain("OR public.declutter_seller_out(o_seller_id) THEN RAISE EXCEPTION 'item_not_found'");
    // The policy helper answers only for a member with a live listing (no ban/strike oracle for any id).
    expect(flat(body("declutter_seller_hidden"))).toContain("WHERE i.seller_id = p_seller AND i.status IN ('live', 'reserved')) AND public.declutter_seller_out(p_seller);");
    // B32/B33: an under-18 or business-like seller cannot sell.
    expect(flat(body("declutter_seller_out"))).toContain("OR COALESCE(public.member_under_18(p_seller), false) OR EXISTS (SELECT 1 FROM public.declutter_seller_flags f");
  });

  it("service-only functions are revoked from every client role; client RPCs from anon", () => {
    for (const fn of SERVICE_ONLY) {
      expect(MIG, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
    }
    for (const fn of [...CLIENT_WRITES, ...CLIENT_READS, "declutter_seller_hidden"]) {
      expect(MIG, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
    }
    expect(flat(MIG)).toContain("GRANT SELECT (user_id, brand, last4, saved_at) ON TABLE public.declutter_buyer_cards TO authenticated;");
  });
});

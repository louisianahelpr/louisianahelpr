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
 * @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |    WHERE id = p_item_id AND status = 'live'\n  RETURNING seller_id, title INTO v_seller, v_title; |    WHERE id = p_item_id\n  RETURNING seller_id, title INTO v_seller, v_title;
 * @mutate supabase/migrations/20261020033623_declutter_items_seed_boundary.sql |    WHERE i.id = p_item_id\n   FOR UPDATE; |    WHERE i.id = p_item_id;
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql | CREATE UNIQUE INDEX IF NOT EXISTS declutter_offers_one_accepted | CREATE INDEX IF NOT EXISTS declutter_offers_one_accepted
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql | CREATE UNIQUE INDEX IF NOT EXISTS declutter_cart_one_active | CREATE INDEX IF NOT EXISTS declutter_cart_one_active
 * @mutate supabase/migrations/20261101030040_declutter_buy_now_30_minutes.sql |   SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;\n  v_found := FOUND; |   SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;\n  v_found := FOUND;
 * @mutate supabase/migrations/20261029162620_declutter_smart_offers.sql |   IF p_amount_cents * 2 < v_item.o_price_cents THEN |   IF false THEN
 * @mutate supabase/migrations/20261029162620_declutter_smart_offers.sql |   IF COALESCE(v_rules.auto_offers, false) AND v_rules.floor_price_cents < v_item.o_price_cents THEN |   IF v_rules.floor_price_cents < v_item.o_price_cents THEN
 * @mutate supabase/migrations/20261030154745_declutter_drop_stop_whole_dollar.sql |        SET current_price_cents = greatest(p.floor_price_cents, (ceil(COALESCE(p.drop_stop_cents, p.floor_price_cents) / 100.0) * 100)::integer, |        SET current_price_cents = greatest(
 * @mutate supabase/migrations/20261030154745_declutter_drop_stop_whole_dollar.sql |        AND (i.last_price_drop_on IS NULL OR i.last_price_drop_on < v_today) |        AND true
 * @mutate supabase/migrations/20261014210518_declutter_slice3_offers_checkout.sql | REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql |         AND NOT seller_hidden\n |         AND true\n
 * @mutate supabase/migrations/20261031164337_declutter_door_pickup_uses_places.sql |                     ELSE public.declutter_buyer_fee_cents(v_items) END; |                     ELSE greatest(round(v_items * 0.15)::integer, 100) END;
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261014210518_declutter_slice3_offers_checkout.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
/** The newest CREATE POLICY of the declutter_items read policy, comment-blanked (any migration). */
function newestItemsReadPolicy(): string {
  let found = "";
  for (const f of readdirSync(MIG_DIR).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(/CREATE\s+POLICY\s+"declutter items: seller or switched-on members read live"[\s\S]*?;/gi)) found = m[0];
  }
  return found;
}

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

  it("every client RPC that STARTS something needs the switch; every write names is_caller_banned(); buyer writes are age-gated (row 53)", () => {
    // Row 62 (slice 3b, 20261014224914, B44): finishing an agreed sale (checkout,
    // seller cancel, reading your cart and offers) works with the switch off.
    const FINISHING = ["declutter_start_checkout", "declutter_seller_cancel_sale", "declutter_my_offers", "declutter_my_cart"];
    for (const fn of [...CLIENT_WRITES, ...CLIENT_READS].filter((f) => !FINISHING.includes(f))) {
      expect(body(fn), fn).toMatch(/\bBEGIN\s+PERFORM\s+public\.require_feature\('declutter'\);/);
    }
    // Slice 5 (20261017055505): Helpr delivery is NEW work for a Helpr, so checkout needs the switch for
    // that one handover only; pickup and porch still finish with the switch off.
    const DELIVERY_ONLY = /IF p_handover = 'delivery' THEN\s+PERFORM public\.require_feature\('declutter'\);\s+END IF;/;
    expect(body("declutter_start_checkout")).toMatch(DELIVERY_ONLY);
    // Seller delivery (20261027153244) is new work for the seller: both switches, for that handover only.
    const SELLER_DELIVERY_ONLY = /IF p_handover = 'seller_delivery' THEN\s+PERFORM public\.require_feature\('declutter'\);\s+PERFORM public\.require_feature\('declutter_seller_delivery'\);/;
    expect(body("declutter_start_checkout")).toMatch(SELLER_DELIVERY_ONLY);
    // Q2425 (20261027204500): a safe-spot meetup is new work for the seller too: the switch, for that handover only.
    const MEETUP_ONLY = /IF p_handover = 'meetup' THEN\s+PERFORM public\.require_feature\('declutter'\);\s+END IF;/;
    expect(body("declutter_start_checkout")).toMatch(MEETUP_ONLY);
    for (const fn of FINISHING) {
      expect(body(fn).replace(DELIVERY_ONLY, "").replace(SELLER_DELIVERY_ONLY, "").replace(MEETUP_ONLY, ""), fn).not.toMatch(/require_feature/);
    }
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
    for (const fn of ["declutter_buy_now", "declutter_lock_buyable_item", "declutter_take_item"]) {
      expect(body(fn), fn).not.toMatch(/floor_price_cents/);
    }
    // Smart offers (20261029162620, owner 2026-10-29): the floor answers an offer ONLY when the seller turned on
    // "answer offers automatically" (auto_offers). Every floor read sits after that gate, read into v_rules.
    for (const fn of ["declutter_make_offer", "declutter_respond_offer"]) {
      const b = flat(body(fn));
      const gate = b.indexOf("IF COALESCE(v_rules.auto_offers, false) AND v_rules.floor_price_cents <");
      expect(gate, fn).toBeGreaterThan(0);
      const uses = [...b.matchAll(/floor_price_cents/g)].map((m) => m.index ?? 0);
      expect(uses.length, fn).toBeGreaterThan(1);
      const select = b.indexOf("SELECT p.auto_offers, p.floor_price_cents INTO v_rules");
      expect(uses.filter((i) => i !== select + "SELECT p.auto_offers, p.".length && i < gate), fn).toEqual([]);
      expect(b.slice(gate).replace(/v_rules\.floor_price_cents/g, ""), fn).not.toMatch(/floor_price_cents/);
    }
    expect(flat(body("declutter_my_offers"))).toContain("CASE WHEN o.seller_id = v_uid THEN p.floor_price_cents END");
  });

  it("F1 + rows 22, 38: the buyer-fee rule lives in the table, and checkout freezes it", () => {
    expect(flat(MIG)).toContain("CONSTRAINT declutter_orders_total CHECK (total_cents = items_cents + premium_cents + tax_cents)");
    // F1 (20261015023613_declutter_buyer_fee_f1) replaced rows 20-21: 5% of the items + 70c, card cost inside.
    const f1 = flat(blankSqlComments(readFileSync(join(MIG_DIR, "20261015023613_declutter_buyer_fee_f1.sql"), "utf8")));
    expect(f1).toContain("(fee_rule = 'f1' AND premium_cents = round(items_cents * 0.05)::integer + 70)");
    expect(f1).toContain("NEW.fee_rule := 'f1';");
    expect(flat(body("declutter_buyer_fee_cents"))).toContain("round(greatest(COALESCE(p_items_cents, 0), 0) * 0.05)::integer + 70");
    // Seller delivery's fee counts the rate (20261027153244); every other handover keeps F1 on the items.
    expect(flat(body("declutter_start_checkout"))).toContain("ELSE public.declutter_buyer_fee_cents(v_items) END;");
    expect(flat(body("declutter_start_checkout"))).toContain("RAISE EXCEPTION 'seller_tax_not_ready'");
  });

  it("the webhook path is service-only, idempotent, and refunds in full what it cannot honour", () => {
    const paid = flat(body("declutter_mark_order_paid"));
    expect(paid).toContain("SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;");
    // Slice 3b (B40): every refund now carries a reason that fixes who bears the card fee.
    expect(paid).toContain("RETURN jsonb_build_object('result', 'already_paid');");
    expect(paid).toContain("IF p_amount_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents AND NOT (o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents) THEN RETURN public.declutter_refund_answer( public.declutter_record_refund(o.id, p_payment_intent_id, 'amount_mismatch'");
  });

  it("row 56: the evening drop is the seller's step (5% by default), never below the floor, once per Louisiana day; both crons are watched", () => {
    const drop = flat(body("declutter_price_drop_sweep"));
    // Slice 3b (row 61, B42): never below the private stop point, which is above the floor.
    // Owner 2026-10-28 (20261028160637): the seller's drop_pct, down to a whole dollar; 0 is skipped.
    // DA-17 (20261030154745): the stop counts UP to a whole dollar, so a listing at its stop never shows odd cents.
    expect(drop).toContain("greatest(p.floor_price_cents, (ceil(COALESCE(p.drop_stop_cents, p.floor_price_cents) / 100.0) * 100)::integer, (floor(i.current_price_cents * (100 - i.drop_pct) / 10000.0) * 100)::integer)");
    expect(drop).toContain("AND i.current_price_cents > greatest(p.floor_price_cents, (ceil(COALESCE(p.drop_stop_cents, p.floor_price_cents) / 100.0) * 100)::integer)");
    expect(drop).toContain("AND i.drop_pct > 0");
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
    // Q1852 (20261021142959): the NEWEST items read policy tests the server-kept column, never a
    // client-executable helper (declutter_seller_hidden is revoked from members).
    const policy = newestItemsReadPolicy();
    expect(policy).toContain("AND NOT seller_hidden");
    expect(policy).not.toContain("declutter_seller_hidden(");
    expect(flat(body("declutter_lock_buyable_item"))).toContain("OR public.declutter_seller_out(o_seller_id) OR (v_seed AND public.seed_hidden_for(p_buyer)) THEN RAISE EXCEPTION 'item_not_found'");
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

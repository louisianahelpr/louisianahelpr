/**
 * Declutter seller delivery (owner request 2026-10-21; migration
 * 20261027153244_declutter_seller_delivery; switch declutter_seller_delivery).
 * Read from the NEWEST definitions the migrations leave (effectiveDefs), so a
 * later restatement that drops one of these rules fails here. The behaviour is
 * proven on prod's bodies in src/test/pglite/declutterSellerDelivery.pglite.mjs
 * (slot hold / release / race, range, caps, refunds, address hidden before
 * payment, auto-pay, reminders; 3x replay).
 *
 *  1. ONE source for every rule the owner set (2026-10-22): declutter_seller_delivery_rules(); the
 *     app's SELLER_DELIVERY_RULES equals it key by key, both ways; the Stripe
 *     page lives shorter than a hold.
 *  2. Money: the fee counts the rate (fee function, CHECK and the app agree);
 *     the handover pays items + rate; the rate is never refunded alone.
 *  3. The 7-day pickup no-show and the pickup auto-pay never touch a seller
 *     delivery; a pickup booking cannot be made on one.
 *  4. The slot: checked and held under the seller's setting-row lock; the paid
 *     trigger re-checks under the same lock.
 *  5. Privacy: the buyer's address reaches the seller only after payment; the
 *     seller's address is not given to a buyer the seller delivers to.
 *  6. Switch: every RPC that starts new work requires it, server side.
 *  7. FREE DELIVERY (owner 2026-10-27): a $0 rate, and "free on orders of $X
 *     or more" on the order's items total from that seller (before fees, the
 *     whole order). ONE SQL rule (declutter_seller_delivery_rate_cents) feeds the
 *     check that checkout and the offer both read; the app's mirror equals it;
 *     the edge function lets a seller delivery be $0 and adds no $0 line; the
 *     CHECKs allow a $0 seller delivery; 141d's payout keeps the rate.
 *
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql | 'slot_minutes', 60, | 'slot_minutes', 30,
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql | 'hold_minutes', 35, | 'hold_minutes', 20,
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |   SELECT round((greatest(COALESCE(p_items_cents, 0), 0) + greatest(COALESCE(p_delivery_cents, 0), 0)) * 0.05)::integer + 70; |   SELECT round(greatest(COALESCE(p_items_cents, 0), 0) * 0.05)::integer + 70;
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |   VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_debt, o.items_cents + v_rate - v_debt, |   VALUES (o.id, o.seller_id, o.items_cents, 0, v_debt, o.items_cents - v_debt,
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |   IF o.delivery_cents <= 0 OR o.stripe_payment_intent_id IS NULL OR o.handover = 'seller_delivery' THEN |   IF o.delivery_cents <= 0 OR o.stripe_payment_intent_id IS NULL THEN
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |      WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery') AND o2.paid_at + interval '7 days' <= now() |      WHERE o2.status = 'paid' AND o2.handover <> 'delivery' AND o2.paid_at + interval '7 days' <= now()
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |   IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'seller_delivery') THEN | IF false THEN
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |     PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = p_seller_id FOR UPDATE;\n | \n
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |     'dropoff_address', CASE WHEN v_side = 'buyer' OR o.status = 'paid' THEN d.dropoff_address END, |     'dropoff_address', d.dropoff_address,
 * @mutate supabase/migrations/20261027153245_export_my_data_seller_delivery.sql |              WHEN t.status IN ('held', 'released') THEN jsonb_build_object('order_id', t.order_id, 'status', t.status, 'created_at', t.created_at)\n | \n
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |                            AND o.handover <> 'seller_delivery') THEN 'paid_buyer' |                            ) THEN 'paid_buyer'
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |   PERFORM public.require_feature('declutter_seller_delivery');\n  v_uid := public.declutter_assert_member(false); |   v_uid := public.declutter_assert_member(false);
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |   RETURN public.declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL, NULL); |   RETURN public.declutter_close_paid_order(o.id, 'seller_backed_out', NULL, NULL, NULL);
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |     AND now() > d.slot_start - make_interval(hours => (public.declutter_seller_delivery_rules() ->> 'buyer_cancel_hours')::integer) THEN |     AND false THEN
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |   IF (p_photo_path IS NULL AND d.handoff = 'leave') OR | IF (false) OR
 * @mutate src/lib/declutter/sellerDelivery.ts |   slot_minutes: 60, |   slot_minutes: 30,
 * @mutate src/lib/declutter/sellerDelivery.ts |   const premiumCents = Math.round((Math.max(0, itemsCents) + Math.max(0, rateCents)) * 0.05) + 70; |   const premiumCents = Math.round(Math.max(0, itemsCents) * 0.05) + 70;
 * @mutate supabase/functions/declutter-checkout/index.ts |     : handover === "seller_delivery" ? Number.isInteger(deliveryCents) && deliveryCents >= 0 |     : handover === "seller_delivery" ? deliveryCents > 0
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |               WHEN p_free_over_cents IS NOT NULL AND COALESCE(p_items_cents, 0) >= p_free_over_cents THEN 0 |               WHEN p_free_over_cents IS NOT NULL AND COALESCE(p_items_cents, 0) > p_free_over_cents THEN 0
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |   v_rate := public.declutter_seller_delivery_rate_cents(s.rate_cents, s.free_over_cents, v_items); |   v_rate := s.rate_cents;
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |   SELECT COALESCE(sum(c.price_cents), 0)::integer INTO v_items FROM public.declutter_cart_items c WHERE c.id = ANY (p_lines); |   SELECT COALESCE(max(c.price_cents), 0)::integer INTO v_items FROM public.declutter_cart_items c WHERE c.id = ANY (p_lines);
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |     v_refunded := o.items_cents + CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END; |     v_refunded := o.items_cents;
 * @mutate src/lib/declutter/sellerDelivery.ts |   if (freeOverCents !== null && itemsCents >= freeOverCents) return 0; |   if (freeOverCents !== null && itemsCents > freeOverCents) return 0;
 * @mutate src/lib/declutter/sellerDelivery.ts |   if (rateCents <= 0) return "Free delivery"; |   if (rateCents <= 0) return "$0 delivery";
 * @mutate supabase/functions/declutter-checkout/index.ts |   if (expectedRate !== null && Number(order.delivery_cents ?? 0) !== expectedRate) { |   if (false) {
 * @mutate supabase/migrations/20261027153244_declutter_seller_delivery.sql |     PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = p_seller_id FOR UPDATE;\n    SELECT * INTO sd | SELECT * INTO sd
 * @mutate supabase/functions/declutter-checkout/index.ts |   const off = await requireFeature(admin, "declutter_seller_delivery", user, corsHeaders);\n  if (off) return off;\n  const declutterOff | const declutterOff
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx |     buyerCancel: open && b.side === "buyer" && !marked && (cancelBy === null \|\| now <= cancelBy), |     buyerCancel: open && b.side === "buyer",
 * @mutate src/components/declutter/SellerDeliveryChoice.tsx |     case "out_of_range": return typed ? "out_of_range" : "hidden"; |     case "out_of_range": return "out_of_range";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import {
  SELLER_DELIVERY_RULES, deliveryRateFor, deliveryTermsLabel, freeOverIsValid, groupSlotsByDay, rateIsValid, sellerDeliveryAmounts,
  type SellerDeliveryBooking, type SellerDeliveryOffer,
} from "@/lib/declutter/sellerDelivery";
import { sellerDeliveryActions } from "@/components/declutter/SellerDeliveryOrder";
import { sellerDeliveryPriceWords, sellerDeliveryState, sellerDeliveryTermsLine } from "@/components/declutter/SellerDeliveryChoice";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const EDGE = blankComments(readFileSync(join(ROOT, "supabase/functions/declutter-checkout/index.ts"), "utf8"));
/** Every migration's CHECK text, comment-blanked, in order (the newest premium_rule wins). */
const ALL_SQL = readFileSync(join(MIG_DIR, "20261027153244_declutter_seller_delivery.sql"), "utf8");

/** The rules jsonb_build_object as a JS object (numbers, number arrays, strings). */
function sqlRules(): Record<string, unknown> {
  const fn = flat(body("declutter_seller_delivery_rules"));
  const inner = fn.slice(fn.indexOf("jsonb_build_object(") + "jsonb_build_object(".length, fn.lastIndexOf(");"));
  const out: Record<string, unknown> = {};
  const re = /'(\w+)',\s*(jsonb_build_array\(([^)]*)\)|'([^']*)'|(-?\d+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    if (m[3] !== undefined) out[m[1]] = m[3].split(",").map((x) => Number(x.trim()));
    else if (m[4] !== undefined) out[m[1]] = m[4];
    else out[m[1]] = Number(m[5]);
  }
  return out;
}

describe("Declutter seller delivery (20261027153244)", () => {
  it("reads a real inventory (floors)", () => {
    const fns = ["declutter_seller_delivery_rules", "declutter_buyer_fee_cents_seller_delivery", "declutter_start_checkout",
      "declutter_complete_handover", "declutter_handover_sweep", "declutter_delivery_refund", "declutter_address_access",
      "declutter_bookings_not_delivery", "declutter_seller_delivery_on_order", "declutter_seller_delivery_offer",
      "declutter_seller_delivery_booking", "declutter_propose_delivery_time", "declutter_answer_delivery_time"];
    for (const fn of fns) expect(body(fn).length, fn).toBeGreaterThan(100);
    expect(Object.keys(sqlRules()).length).toBeGreaterThan(10);
  });

  it("every owner-set number is ONE value in declutter_seller_delivery_rules, and the app's mirror equals it both ways", () => {
    const sql = sqlRules();
    expect(Object.keys(sql).sort()).toEqual(Object.keys(SELLER_DELIVERY_RULES).sort());
    for (const [k, v] of Object.entries(SELLER_DELIVERY_RULES)) expect(sql[k], k).toEqual(Array.isArray(v) ? [...v] : v);
    // Each RPC reads the numbers from the rules, never a second literal copy.
    for (const fn of ["declutter_start_checkout", "declutter_delivery_open_slots", "declutter_delivery_slot_starts",
      "declutter_set_seller_delivery", "declutter_handover_sweep"]) {
      expect(flat(body(fn)), fn).toMatch(/declutter_seller_delivery_rules\(\)/);
    }
  });

  it("a hold outlives the Stripe page it holds the slot for", () => {
    const page = Number(/const PAGE_LIFETIME_S = (\d+) \* 60;/.exec(EDGE)?.[1]);
    expect(page).toBeGreaterThanOrEqual(30);
    expect(SELLER_DELIVERY_RULES.hold_minutes).toBeGreaterThan(page);
  });

  it("the buyer's fee counts the rate: fee function, CHECK and the app agree", () => {
    expect(flat(body("declutter_buyer_fee_cents_seller_delivery"))).toContain(
      "round((greatest(COALESCE(p_items_cents, 0), 0) + greatest(COALESCE(p_delivery_cents, 0), 0)) * 0.05)::integer + 70");
    expect(flat(blankSqlComments(ALL_SQL))).toContain(
      "fee_rule = 'f1_seller_delivery' AND shipping_cents = 0 AND handover = 'seller_delivery' AND premium_cents = round((items_cents + delivery_cents) * 0.05)::integer + 70");
    expect(flat(body("declutter_start_checkout"))).toContain("public.declutter_buyer_fee_cents_seller_delivery(v_items, v_delivery)");
    expect(flat(body("declutter_orders_fee_rule_f1"))).toContain("WHEN NEW.handover = 'seller_delivery' THEN 'f1_seller_delivery'");
    expect(sellerDeliveryAmounts(5000, 2000)).toEqual({ premiumCents: 420, totalCents: 7420 });
    expect(sellerDeliveryAmounts(1010, 500)).toEqual({ premiumCents: 146, totalCents: 1656 });
  });

  it("the handover pays the seller items + rate (exact cents) and the rate is never refunded alone", () => {
    const h = flat(body("declutter_complete_handover"));
    expect(h).toContain("v_rate := CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END");
    expect(h).toContain("VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_debt, o.items_cents + v_rate - v_debt,");
    expect(h).not.toMatch(/round_down|floor\(/i);
    expect(flat(body("declutter_delivery_refund"))).toContain("OR o.handover = 'seller_delivery' THEN RAISE EXCEPTION 'no_delivery_fee'");
    expect(flat(EDGE)).toContain(
      'const deliveryShapeOk = handover === "delivery" ? deliveryCents > 0 : handover === "seller_delivery" ? Number.isInteger(deliveryCents) && deliveryCents >= 0 : deliveryCents === 0;');
  });

  it("free delivery (owner 2026-10-27): ONE rule, on the whole order's items total, read by checkout and the offer", () => {
    const rule = flat(body("declutter_seller_delivery_rate_cents"));
    expect(rule).toContain("SELECT CASE WHEN COALESCE(p_rate_cents, 0) <= 0 THEN 0 WHEN p_free_over_cents IS NOT NULL AND COALESCE(p_items_cents, 0) >= p_free_over_cents THEN 0 ELSE p_rate_cents END;");
    const check = flat(body("declutter_seller_delivery_check"));
    // X is the items total of EVERY line of the one order (several items from one seller), before fees.
    expect(check).toContain("SELECT COALESCE(sum(c.price_cents), 0)::integer INTO v_items FROM public.declutter_cart_items c WHERE c.id = ANY (p_lines);");
    expect(check).toContain("v_rate := public.declutter_seller_delivery_rate_cents(s.rate_cents, s.free_over_cents, v_items);");
    expect(check.match(/RETURN QUERY SELECT [^;]*v_rate, s\.radius_miles/g)?.length).toBe(5);
    // Checkout charges what the check says; the offer shows the same answer.
    expect(flat(body("declutter_start_checkout"))).toContain("v_delivery := sd.rate_cents;");
    expect(flat(body("declutter_seller_delivery_offer"))).toContain("'rate_cents', c.rate_cents, 'base_rate_cents', c.base_rate_cents, 'free_over_cents', c.free_over_cents, 'items_cents', c.items_cents,");
    // The CHECKs: a seller delivery may be $0; a free-delivery amount needs a paid rate; the payout keeps 141d's refunds.
    const all = flat(blankSqlComments(ALL_SQL));
    expect(all).toContain("CHECK (free_over_cents IS NULL OR rate_cents > 0)");
    expect(all).toContain("CHECK (amount_cents = items_cents + delivery_cents - refunded_cents - debt_cents AND amount_cents >= 0)");
    expect(all).toContain("CHECK (refunded_cents BETWEEN 0 AND items_cents + delivery_cents)");
    // 141d's full refund after the handover undoes the rate for the seller too (the buyer got it back).
    expect(flat(body("declutter_refund_after_handover"))).toContain(
      "v_refunded := o.items_cents + CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END;");
    expect(flat(body("declutter_rebook_payout"))).toContain("amount_cents = items_cents + delivery_cents - p_refunded_cents - v_debt,");
    // Settings: $0 or a capped rate; the amount only with a paid rate.
    const set = flat(body("declutter_set_seller_delivery"));
    expect(set).toContain("p_rate_cents = (v_rules ->> 'free_rate_cents')::integer");
    expect(set).toContain("IF p_free_over_cents IS NOT NULL AND (p_rate_cents = 0 OR p_free_over_cents % 100 <> 0");
    // The edge function adds no $0 line: the delivery line only when it costs something.
    expect(flat(EDGE)).toContain("if (deliveryCents > 0) { lineItems.push(");
    // The price the screen showed is checked before any Stripe page (money review #2), and an open page
    // on a different price is closed first (note 3).
    expect(flat(EDGE)).toContain('if (expectedRate !== null && Number(order.delivery_cents ?? 0) !== expectedRate) { return json({ error: "delivery_rate_changed"');
    expect(flat(EDGE)).toContain("|| (expectedRate !== null && Number(open.delivery_cents ?? 0) !== expectedRate);");
    expect(EDGE.indexOf('error: "delivery_rate_changed"')).toBeLessThan(EDGE.indexOf("checkout.sessions.create("));
    // The CHECK holds a seller delivery to $0 or the $5-$150 caps.
    expect(all).toContain("OR (delivery_cents % 100 = 0 AND (delivery_cents = 0 OR delivery_cents BETWEEN 500 AND 15000))));");
  });

  it("the app's free-delivery mirror equals the SQL rule at the edges", () => {
    // $X - 1, one cent under, $X, above; a $0 rate; no amount set.
    expect(deliveryRateFor(1000, 5000, 4900)).toBe(1000);
    expect(deliveryRateFor(1000, 5000, 4999)).toBe(1000);
    expect(deliveryRateFor(1000, 5000, 5000)).toBe(0);
    expect(deliveryRateFor(1000, 5000, 5001)).toBe(0);
    expect(deliveryRateFor(0, null, 100)).toBe(0);
    expect(deliveryRateFor(1000, null, 1_000_000)).toBe(1000);
    // A free order's fee is on the items alone: 5% of $50 + 70c.
    expect(sellerDeliveryAmounts(5000, 0)).toEqual({ premiumCents: 320, totalCents: 5320 });
    expect(rateIsValid(0)).toBe(true);
    expect(rateIsValid(400)).toBe(false);
    expect(rateIsValid(500)).toBe(true);
    expect(freeOverIsValid(5000, 0)).toBe(false);
    expect(freeOverIsValid(5050, 1000)).toBe(false);
    expect(freeOverIsValid(5000, 1000)).toBe(true);
    expect(freeOverIsValid(null, 0)).toBe(true);
  });

  it("the settings card and the checkout say plainly which applies", () => {
    expect(deliveryTermsLabel(0, null)).toBe("Free delivery");
    expect(deliveryTermsLabel(1000, 5000)).toBe("Free delivery on $50+, otherwise $10");
    expect(deliveryTermsLabel(1000, null)).toBe("$10 delivery");
    const offer: SellerDeliveryOffer = { available: true, reason: null, rate_cents: 0, base_rate_cents: 1000, free_over_cents: 5000, items_cents: 5200,
      radius_miles: 10, dropoff_area: "Mid-City", slot_minutes: 60, slots: [], held_slot: null };
    expect(sellerDeliveryPriceWords(offer, "pick")).toBe("Free");
    expect(sellerDeliveryTermsLine(offer)).toBe("Free delivery on $50+, otherwise $10. Your order is $52, so delivery is free.");
    expect(sellerDeliveryTermsLine({ ...offer, rate_cents: 1000, items_cents: 4900 })).toBe("Free delivery on $50+, otherwise $10. Your order is $49, so delivery is $10.");
    expect(sellerDeliveryTermsLine({ ...offer, base_rate_cents: 0, free_over_cents: null })).toBe("Free delivery.");
    expect(sellerDeliveryPriceWords({ ...offer, rate_cents: 1000 }, "pick")).toBe("$10");
  });

  it("the pickup sweep never auto-pays or no-shows a seller delivery, and no pickup booking can sit on one", () => {
    const sweep = flat(body("declutter_handover_sweep"));
    expect(sweep.match(/handover NOT IN \('delivery', 'seller_delivery'\)/g)?.length).toBe(4);
    expect(sweep).not.toMatch(/handover <> 'delivery'/);
    expect(flat(body("declutter_bookings_not_delivery"))).toContain("o.handover = 'seller_delivery') THEN RAISE EXCEPTION 'delivery_order'");
  });

  it("the slot is checked and held under the seller's setting-row lock; the paid trigger re-checks under it", () => {
    const sc = flat(body("declutter_start_checkout"));
    const lock = sc.indexOf("PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = p_seller_id FOR UPDATE;");
    // The setting is read UNDER the lock (money review of the free-delivery change #1): no stale price is frozen.
    expect(sc.indexOf("FROM public.declutter_seller_delivery_check(v_uid, p_seller_id, v_lines)")).toBeGreaterThan(lock);
    const check = sc.indexOf("FROM public.declutter_delivery_open_slots(p_seller_id, v_existing.id)");
    const hold = sc.indexOf("INSERT INTO public.declutter_seller_deliveries");
    expect(lock).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(lock);
    expect(hold).toBeGreaterThan(check);
    const trg = flat(body("declutter_seller_delivery_on_order"));
    expect(trg.indexOf("FOR UPDATE", trg.indexOf("FROM public.declutter_seller_delivery s"))).toBeGreaterThan(0);
    expect(trg.indexOf("FROM public.declutter_seller_delivery s")).toBeLessThan(trg.indexOf("declutter_delivery_slot_used"));
    const acc = flat(body("declutter_answer_delivery_time"));
    expect(acc.indexOf("FROM public.declutter_seller_delivery s WHERE s.seller_id = o.seller_id FOR UPDATE")).toBeGreaterThan(0);
  });

  it("the buyer's address reaches the seller only while paid; the seller's address is not given to the buyer", () => {
    expect(flat(body("declutter_seller_delivery_booking"))).toContain(
      "'dropoff_address', CASE WHEN v_side = 'buyer' OR o.status = 'paid' THEN d.dropoff_address END,");
    // Download My Data: a seller's copy drops the buyer's address and point, and has no unpaid checkout.
    const exp = flat(body("export_my_data"));
    expect(exp).toContain("ELSE to_jsonb(t) - 'dropoff_address' - 'dropoff_lat' - 'dropoff_lng' END)");
    expect(exp).toContain("WHEN t.status IN ('held', 'released') THEN jsonb_build_object('order_id', t.order_id, 'status', t.status, 'created_at', t.created_at)");
    expect(flat(body("declutter_address_access"))).toContain("AND o.handover <> 'seller_delivery') THEN 'paid_buyer'");
  });

  it("owner 2026-10-22: the buyer cancels until 24 h before (all back but the card fee); a door drop-off needs a photo", () => {
    const bc = flat(body("declutter_buyer_cancel_delivery"));
    expect(bc).toContain("RETURN public.declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL, NULL);");
    expect(bc).toContain("now() > d.slot_start - make_interval(hours => (public.declutter_seller_delivery_rules() ->> 'buyer_cancel_hours')::integer) THEN RAISE EXCEPTION 'cancel_window_closed'");
    // 'buyer_cancelled' keeps the card fee and only the card fee (the refund policy CHECK, newest).
    expect(flat(body("declutter_record_refund"))).toMatch(/WHEN p_reason IN \('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault'(, 'refund_request_full')?\) THEN 'keep_card_fee'/);
    expect(flat(body("declutter_seller_delivered"))).toContain("IF (p_photo_path IS NULL AND d.handoff = 'leave') OR");
    expect(flat(body("declutter_handover_sweep"))).toContain("(d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)");
  });

  it("every RPC that starts new work requires the switch, on the server", () => {
    for (const fn of ["declutter_my_seller_delivery", "declutter_set_seller_delivery", "declutter_set_delivery_schedule",
      "declutter_set_item_seller_delivery", "declutter_seller_delivery_offer"]) {
      expect(flat(body(fn)), fn).toContain("PERFORM public.require_feature('declutter_seller_delivery');");
    }
    expect(flat(body("declutter_start_checkout"))).toMatch(
      /IF p_handover = 'seller_delivery' THEN PERFORM public\.require_feature\('declutter'\); PERFORM public\.require_feature\('declutter_seller_delivery'\);/);
    expect(EDGE).toMatch(/requireFeature\(admin, "declutter_seller_delivery", user, corsHeaders\);\s*if \(off\) return off;/);
  });
});

describe("Declutter seller delivery screens follow the server's rules", () => {
  const base: SellerDeliveryBooking = {
    order_id: "o", side: "buyer", order_status: "paid", status: "booked", slot_start: "2026-11-01T19:00:00.000Z",
    slot_end: "2026-11-01T20:00:00.000Z", delivery_cents: 2000, dropoff_area: "Mid-City", handoff: "leave",
    dropoff_address: null, proposed_start: null, proposed_by: null, proposals_left: 3, delivered_at: null,
    delivered_photo_path: null, confirmed_at: null, not_delivered_from: "2026-11-01T20:15:00.000Z",
  };
  const at = (iso: string) => Date.parse(iso);

  it("the buyer cancels until 24 h before the slot, never after the seller's mark", () => {
    expect(sellerDeliveryActions(base, at("2026-10-31T18:00:00Z")).buyerCancel).toBe(true);
    expect(sellerDeliveryActions(base, at("2026-10-31T20:00:00Z")).buyerCancel).toBe(false);
    expect(sellerDeliveryActions({ ...base, delivered_at: "2026-11-01T19:10:00Z" }, at("2026-10-30T00:00:00Z")).buyerCancel).toBe(false);
    expect(sellerDeliveryActions({ ...base, status: "needs_time", slot_start: null, slot_end: null }, at("2026-11-02T00:00:00Z")).buyerCancel).toBe(true);
  });

  it("'It wasn't delivered' from 15 minutes after the hour ends; the seller's mark from the slot start", () => {
    expect(sellerDeliveryActions(base, at("2026-11-01T20:10:00Z")).notDelivered).toBe(false);
    expect(sellerDeliveryActions(base, at("2026-11-01T20:16:00Z")).notDelivered).toBe(true);
    const seller = { ...base, side: "seller" as const };
    expect(sellerDeliveryActions(seller, at("2026-11-01T18:59:00Z")).markDelivered).toBe(false);
    expect(sellerDeliveryActions(seller, at("2026-11-01T19:01:00Z")).markDelivered).toBe(true);
    expect(sellerDeliveryActions({ ...seller, status: "needs_time" }).sellerCancel).toBe(false);
  });

  it("checkout shows the choice only when the server says so", () => {
    const offer = { available: false, reason: null, rate_cents: 2000, base_rate_cents: 2000, free_over_cents: null, items_cents: 5000,
      radius_miles: 10, dropoff_area: null, slot_minutes: 60, slots: [], held_slot: null };
    expect(sellerDeliveryState(undefined, false)).toBe("hidden");
    expect(sellerDeliveryState({ ...offer, reason: "seller_not_delivering" }, true)).toBe("hidden");
    expect(sellerDeliveryState({ ...offer, reason: "out_of_range" }, false)).toBe("hidden");
    expect(sellerDeliveryState({ ...offer, reason: "out_of_range" }, true)).toBe("out_of_range");
    expect(sellerDeliveryState({ ...offer, reason: "no_times" }, false)).toBe("no_times");
    expect(sellerDeliveryState({ ...offer, reason: "address_needed" }, false)).toBe("address");
    expect(sellerDeliveryState({ ...offer, available: true }, false)).toBe("pick");
  });

  it("times are grouped by the Louisiana day", () => {
    // 10:30 PM Oct 31 in Louisiana (CDT, UTC-5) is 03:30Z Nov 1: the same Louisiana day as 9 PM Oct 31.
    const g = groupSlotsByDay(["2026-11-01T03:30:00.000Z", "2026-11-01T02:00:00.000Z", "2026-11-01T15:00:00.000Z"]);
    expect(g.map((d) => d.slots.length)).toEqual([2, 1]);
    expect(g[0].day).toBe("2026-10-31");
  });
});

/**
 * Declutter seller delivery (owner request 2026-10-21; migration
 * 20261021181258_declutter_seller_delivery; switch declutter_seller_delivery).
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
 *
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql | 'slot_minutes', 60, | 'slot_minutes', 30,
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql | 'hold_minutes', 35, | 'hold_minutes', 20,
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |   SELECT round((greatest(COALESCE(p_items_cents, 0), 0) + greatest(COALESCE(p_delivery_cents, 0), 0)) * 0.05)::integer + 70; |   SELECT round(greatest(COALESCE(p_items_cents, 0), 0) * 0.05)::integer + 70;
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |   VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_debt, o.items_cents + v_rate - v_debt, |   VALUES (o.id, o.seller_id, o.items_cents, 0, v_debt, o.items_cents - v_debt,
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |   IF o.delivery_cents <= 0 OR o.stripe_payment_intent_id IS NULL OR o.handover = 'seller_delivery' THEN |   IF o.delivery_cents <= 0 OR o.stripe_payment_intent_id IS NULL THEN
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |      WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery') AND o2.paid_at + interval '7 days' <= now() |      WHERE o2.status = 'paid' AND o2.handover <> 'delivery' AND o2.paid_at + interval '7 days' <= now()
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |   IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'seller_delivery') THEN | IF false THEN
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |     PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = p_seller_id FOR UPDATE;\n | \n
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |     'dropoff_address', CASE WHEN v_side = 'buyer' OR o.status IN ('paid', 'handed_over') THEN d.dropoff_address END, |     'dropoff_address', d.dropoff_address,
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |                            AND o.handover <> 'seller_delivery') THEN 'paid_buyer' |                            ) THEN 'paid_buyer'
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |   PERFORM public.require_feature('declutter_seller_delivery');\n  v_uid := public.declutter_assert_member(false); |   v_uid := public.declutter_assert_member(false);
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |   RETURN public.declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL, NULL); |   RETURN public.declutter_close_paid_order(o.id, 'seller_backed_out', NULL, NULL, NULL);
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |     AND now() > d.slot_start - make_interval(hours => (public.declutter_seller_delivery_rules() ->> 'buyer_cancel_hours')::integer) THEN |     AND false THEN
 * @mutate supabase/migrations/20261021181258_declutter_seller_delivery.sql |   IF (p_photo_path IS NULL AND d.handoff = 'leave') OR | IF (false) OR
 * @mutate src/lib/declutter/sellerDelivery.ts |   slot_minutes: 60, |   slot_minutes: 30,
 * @mutate src/lib/declutter/sellerDelivery.ts |   const premiumCents = Math.round((Math.max(0, itemsCents) + Math.max(0, rateCents)) * 0.05) + 70; |   const premiumCents = Math.round(Math.max(0, itemsCents) * 0.05) + 70;
 * @mutate supabase/functions/declutter-checkout/index.ts |   const carriesDelivery = handover === "delivery" \|\| handover === "seller_delivery"; |   const carriesDelivery = handover === "delivery";
 * @mutate supabase/functions/declutter-checkout/index.ts |   const off = await requireFeature(admin, "declutter_seller_delivery", user, corsHeaders);\n  if (off) return off;\n  if (body.address | if (body.address
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { SELLER_DELIVERY_RULES, sellerDeliveryAmounts } from "@/lib/declutter/sellerDelivery";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const EDGE = blankComments(readFileSync(join(ROOT, "supabase/functions/declutter-checkout/index.ts"), "utf8"));
/** Every migration's CHECK text, comment-blanked, in order (the newest premium_rule wins). */
const ALL_SQL = readFileSync(join(MIG_DIR, "20261021181258_declutter_seller_delivery.sql"), "utf8");

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

describe("Declutter seller delivery (20261021181258)", () => {
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
    expect(EDGE).toMatch(/const carriesDelivery = handover === "delivery" \|\| handover === "seller_delivery";/);
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

  it("the buyer's address reaches the seller only after payment; the seller's address is not given to the buyer", () => {
    expect(flat(body("declutter_seller_delivery_booking"))).toContain(
      "'dropoff_address', CASE WHEN v_side = 'buyer' OR o.status IN ('paid', 'handed_over') THEN d.dropoff_address END,");
    expect(flat(body("declutter_address_access"))).toContain("AND o.handover <> 'seller_delivery') THEN 'paid_buyer'");
  });

  it("owner 2026-10-22: the buyer cancels until 24 h before (all back but the card fee); a door drop-off needs a photo", () => {
    const bc = flat(body("declutter_buyer_cancel_delivery"));
    expect(bc).toContain("RETURN public.declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL, NULL);");
    expect(bc).toContain("now() > d.slot_start - make_interval(hours => (public.declutter_seller_delivery_rules() ->> 'buyer_cancel_hours')::integer) THEN RAISE EXCEPTION 'cancel_window_closed'");
    // 'buyer_cancelled' keeps the card fee and only the card fee (the refund policy CHECK, newest).
    expect(flat(body("declutter_record_refund"))).toMatch(/WHEN p_reason IN \('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault'\) THEN 'keep_card_fee'/);
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

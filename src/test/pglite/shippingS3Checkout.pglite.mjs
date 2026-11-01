#!/usr/bin/env node
/**
 * PGlite proof for 20261101201500_shipping_s3_checkout_claim (Q2259 S3; owner "build shipping now" 11-01):
 *   1. declutter_start_checkout takes 'ship' only with the declutter_shipping switch, only for items with a parcel
 *      (ship_preset), only with the buyer's own fresh quote for exactly these lines; the order's shipping is the
 *      quote's rate, the fee 5% of items + shipping + 70c (f1_ship) and the total includes the shipping. The same
 *      quote hands back the same order; a new quote opens a new one. Other ways are unchanged (no shipping).
 *   2. Recording the payment (the card hold) writes the order's ONE shipments claim row from its quote, in the same
 *      transaction, and marks the hold 'held'; a replay writes no second row; the capture state only moves forward;
 *      a missing quote refuses the payment record (fail closed).
 *
 *   node src/test/pglite/shippingS3Checkout.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingS3Checkout.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261101201500_shipping_s3_checkout_claim.sql";
const BASES = [
  "20261012031120_hidden_feature_switches.sql",
  "20261028151647_feature_switch_members.sql",
  "20261030000030_shipping_s2_ship_handover.sql",
  "20261030012052_shipping_s2_postage_rates.sql",
  "20261027211754_declutter_bundle_discount.sql",
  "20261028171944_declutter_notice_copy.sql",
  "20261028195840_declutter_pickup_window_reads.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028210552_declutter_sale_notices_name_inline.sql",
  "20261028225038_declutter_porch_pick_a_day.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261030164712_declutter_porch_places.sql",
  "20261031145652_declutter_place_hours.sql",
  "20261031164337_declutter_door_pickup_uses_places.sql",
  "20261031163021_declutter_porch_next_step_is_a_time.sql",
  "20261031171727_declutter_porch_days_without_places.sql",
  "20261101030040_declutter_buy_now_30_minutes.sql",
  "20261101032626_declutter_checkout_page_inside_hold.sql",
  "20261101191500_declutter_checkout_pickup_time.sql",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER, BUYER2, BUYER3 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 260);

await run(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text`);
await svc(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false`);
for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}
const acl = one(await svc(`SELECT to_regprocedure('public.declutter_start_checkout(uuid, text, timestamptz, text)') IS NULL
  AND has_function_privilege('authenticated', 'public.declutter_start_checkout(uuid, text, timestamptz, text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_start_checkout(uuid, text, timestamptz, text, uuid)', 'EXECUTE')`));
ok(acl === true, `one checkout function (5 args) for signed-in members; the 4-arg one is gone (got ${short(acl)})`);

// BUYER and BUYER2 are testers (the world enrols every fixture user); BUYER3 is an ordinary account.
await run(`DELETE FROM public.test_accounts WHERE user_id = '${BUYER3}'`);

const I = (n) => `5e5e5e5e-0000-0000-0000-${String(n).padStart(12, "0")}`;
const hold = async (n, buyer, price, preset = "small_box") => {
  await run(liveItemSql({ id: I(n), seller: SELLER2, title: `Ship item ${n}`, price, floor: 100 }));
  await svc(`UPDATE public.declutter_items SET status = 'reserved', delivery_size = 'small', ship_preset = ${preset ? `'${preset}'` : "NULL"} WHERE id = '${I(n)}'`);
  return one(await svc(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, status, checkout_by)
    VALUES ('${I(n)}', '${buyer}', '${SELLER2}', ${price}, 'buy', 'in_cart', now() + interval '30 minutes') RETURNING id`));
};
const SHIP_TO = `'{"zip":"70506","street1":"1 Main St","city":"Lafayette","state":"LA"}'::jsonb`;
const PARCEL = `'{"weight_oz":16,"length_in":9,"width_in":6,"height_in":3}'::jsonb`;
let shp = 0;
const quote = async (buyer, lines, rate, over = "") => one(await svc(`INSERT INTO public.shipping_quotes (buyer_id, seller_id,
  cart_item_ids, label_mode, service, rate_cents, provider_rate_id, provider_shipment_id, ship_to, parcel${over ? ", expires_at, created_at" : ""})
  VALUES ('${buyer}', '${SELLER2}', ARRAY[${lines.map((l) => `'${l}'`).join(",")}]::uuid[], 'test', 'usps_ground_advantage', ${rate},
  'rate_r${++shp}', 'shp_s${shp}', ${SHIP_TO}, ${PARCEL}${over}) RETURNING id`));
const checkout = (buyer, way, quoteId) =>
  me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', '${way}'${quoteId !== undefined ? `, p_quote_id => ${quoteId ? `'${quoteId}'` : "NULL"}` : ""})`);
const openOrder = async (buyer) => (await svc(`SELECT id, handover, items_cents, premium_cents, shipping_cents, total_cents, fee_rule,
  setup_fee_cents, shipping_quote_id, ship_capture FROM public.declutter_orders
  WHERE buyer_id = '${buyer}' AND seller_id = '${SELLER2}' AND status = 'awaiting_payment'`))?.[0] ?? null;

// 1. Refusals.
const l1 = await hold(1, BUYER, 2000);
const l2 = await hold(2, BUYER, 1500);
const q12 = await quote(BUYER, [l1, l2], 745);
const noQuote = await checkout(BUYER, "ship", null);
ok(refused(noQuote, /shipping_quote_needed/), `ship with no quote: refused (${short(noQuote)})`);
const l3 = await hold(3, BUYER3, 2000);
const ordinary = await checkout(BUYER3, "ship", q12);
ok(refused(ordinary, /feature_disabled|not_enabled|feature/i), `an ordinary account (switch is testers): refused (${short(ordinary)})`);
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter_shipping'`);
const switchOff = await checkout(BUYER, "ship", q12);
ok(refused(switchOff, /feature_disabled/), `a tester while declutter_shipping is off: refused (${short(switchOff)})`);
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_shipping'`);
const l4 = await hold(4, BUYER2, 2000, null);
const q4 = await quote(BUYER2, [l4], 700);
const noParcel = await checkout(BUYER2, "ship", q4);
ok(refused(noParcel, /handover_not_offered/), `an item with no parcel ("Ship it" off): refused (${short(noParcel)})`);
ok(!(await openOrder(BUYER2)), "  and no order is left");
await svc(`DELETE FROM public.declutter_cart_items WHERE item_id = '${I(4)}'`);
const theirs = await quote(BUYER2, [l1, l2], 745);
const others = await checkout(BUYER, "ship", theirs);
ok(refused(others, /shipping_quote_stale/), `another buyer's quote: refused (${short(others)})`);
const partial = await quote(BUYER, [l1], 600);
const part = await checkout(BUYER, "ship", partial);
ok(refused(part, /shipping_quote_stale/), `a quote for only some of the lines: refused (${short(part)})`);
const old = await quote(BUYER, [l1, l2], 500, `, now() - interval '1 minute', now() - interval '20 minutes'`);
const expired = await checkout(BUYER, "ship", old);
ok(refused(expired, /shipping_quote_stale/), `an expired quote: refused (${short(expired)})`);
ok(!(await openOrder(BUYER)), "  and no order is left");
void l3;

// 2. The priced order.
const good = await checkout(BUYER, "ship", q12);
const o = await openOrder(BUYER);
const items = 3500;
const fee = Math.round((items + 745) * 0.05) + 70;
ok(Array.isArray(good) && o?.handover === "ship" && o.items_cents === items && o.shipping_cents === 745 && o.fee_rule === "f1_ship"
  && o.premium_cents === fee && o.total_cents === items + fee + 745 && o.shipping_quote_id === q12,
  `the order: shipping = the quote's rate, fee f1_ship = ${fee}, total includes shipping (${short(o)})`);
ok(good?.[0]?.shipping_cents === 745 && good?.[0]?.total_cents === items + fee + 745, `checkout returns the shipping and total (${short(good)})`);
const again = await checkout(BUYER, "ship", q12);
ok(Array.isArray(again) && again[0]?.order_id === good[0]?.order_id, "the same quote hands back the same order");
const q12same = await quote(BUYER, [l2, l1], 745);
const samePrice = await checkout(BUYER, "ship", q12same);
ok(Array.isArray(samePrice) && samePrice[0]?.order_id !== good[0]?.order_id && (await openOrder(BUYER))?.shipping_quote_id === q12same,
  "a new quote at the same price (a new address) opens a new order with that quote");
const q12b = await quote(BUYER, [l2, l1], 810);
const moved = await checkout(BUYER, "ship", q12b);
const o2 = await openOrder(BUYER);
ok(Array.isArray(moved) && moved[0]?.order_id !== samePrice?.[0]?.order_id && o2?.shipping_cents === 810,
  `a new quote opens a new order at its price (${short(o2)})`);
if (!o2) { console.log(`\n${pass} passed, ${fail + 1} failed (no ship order to pay)`); process.exit(1); }
const shipBack = await svc(`UPDATE public.declutter_orders SET shipping_quote_id = '${q12}' WHERE id = '${o2.id}'`);
ok(refused(shipBack, /order_amounts_frozen/), `the order's quote is frozen (${short(shipBack)})`);

// 3. The hold writes the claim.
const paidRaw = await svc(`SELECT public.declutter_mark_order_paid('${o2.id}', 'pi_s3ship', ${o2.total_cents + o2.setup_fee_cents}, now(), 40) AS r`);
const paid = Array.isArray(paidRaw) ? paidRaw[0]?.r : paidRaw;
ok(paid?.result === "paid", `the held order is recorded (${short(paidRaw)})`);
const sh = (await svc(`SELECT idempotency_key, label_state, label_mode, service, quoted_cents, provider_shipment_id, provider_rate_id,
  ship_to ->> 'zip' AS zip, buyer_id FROM public.shipments WHERE declutter_order_id = '${o2.id}'`)) ?? [];
ok(sh.length === 1 && sh[0].idempotency_key === `declutter:${o2.id}` && sh[0].label_state === "claimed" && sh[0].quoted_cents === 810
  && sh[0].provider_rate_id === `rate_r${shp}` && sh[0].label_mode === "test" && sh[0].zip === "70506" && sh[0].buyer_id === BUYER,
  `one claim row from the quote, in the same transaction (${short(sh)})`);
ok((await svc(`SELECT ship_capture FROM public.declutter_orders WHERE id = '${o2.id}'`))?.[0]?.ship_capture === "held", "the order's hold is 'held'");
await svc(`SELECT public.declutter_mark_order_paid('${o2.id}', 'pi_s3ship', ${o2.total_cents + o2.setup_fee_cents}, now(), 40)`);
ok(one(await svc(`SELECT count(*) FROM public.shipments WHERE declutter_order_id = '${o2.id}'`)) == 1, "a replayed payment writes no second claim");
const cap = await svc(`UPDATE public.declutter_orders SET ship_capture = 'captured' WHERE id = '${o2.id}' RETURNING ship_capture`);
ok(Array.isArray(cap) && cap[0]?.ship_capture === "captured", "held -> captured");
const back = await svc(`UPDATE public.declutter_orders SET ship_capture = 'held' WHERE id = '${o2.id}'`);
ok(refused(back, /ship_capture_backwards/), `captured -> held: refused (${short(back)})`);

// 4. A missing quote refuses the payment record (fail closed).
const l5 = await hold(5, BUYER2, 1200);
const q5 = await quote(BUYER2, [l5], 650);
await checkout(BUYER2, "ship", q5);
const o5 = (await openOrder(BUYER2)) ?? { id: null, total_cents: 0, setup_fee_cents: 0 };
await svc(`DELETE FROM public.shipping_quotes WHERE id = '${q5}'`);
const lost = await svc(`SELECT public.declutter_mark_order_paid('${o5.id}', 'pi_s3lost', ${o5.total_cents + o5.setup_fee_cents}, now(), 40)`);
ok(refused(lost, /shipping_quote_missing/), `the quote gone before the hold: the record is refused (${short(lost)})`);
ok((await openOrder(BUYER2))?.id === o5.id, "  and the order is still awaiting payment");

// 5. Other ways: no shipping, no quote, no capture state.
const l6 = await hold(6, BUYER, 900);
void l6;
const l7 = await hold(7, BUYER2, 1000);
void l7;
await svc(`UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now() WHERE id = '${o5.id}'`);
const home = await checkout(BUYER2, "pickup_home");
const oh = await openOrder(BUYER2);
ok(Array.isArray(home) && oh?.shipping_cents === 0 && oh.shipping_quote_id === null && oh.ship_capture === null && oh.fee_rule === "f1"
  && home[0]?.shipping_cents === 0, `pickup at home: no shipping, f1 as before (${short(oh)})`);
const stray = await checkout(BUYER2, "pickup_home", q12);
const oh2 = await openOrder(BUYER2);
ok(Array.isArray(stray) && oh2?.shipping_quote_id === null, "a quote sent with another way is ignored");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

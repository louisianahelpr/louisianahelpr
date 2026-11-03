#!/usr/bin/env node
/**
 * PGlite proof for 20261103203204_shipping_lost_sweep (Q2259; spec 5.3 "ship_lost"). The world loads the
 * shipping migrations up to the newest restated bases.
 * declutter_ship_sweep closes a captured ship order whose label was accepted 10+ days ago with no delivered scan:
 * one 'ship_lost' refund of EVERYTHING, full_seller_pays_fee, NO strike, item withdrawn, the spent label a ship_label
 * debt; it leaves alone: accepted 9 days ago, delivered, waiting for pickup, an open problem, a held hold.
 *
 *   node src/test/pglite/shippingLostSweep.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingLostSweep.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                               # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261103203204_shipping_lost_sweep.sql";
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
  "20261028221904_declutter_remove_cart_item.sql",
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
  "20261101201500_shipping_s3_checkout_claim.sql",
  "20261101220810_shipping_hold_released.sql",
  "20261101221604_shipping_hold_refund_row.sql",
  "20261102013630_shipping_s5_delivered_payout.sql",
  "20261102023246_shipping_seller_label.sql",
  "20261102040952_declutter_card_fee_prorated.sql",
  "20261102043018_shipping_debt_source_key.sql",
  "20261102045035_shipping_never_shipped_sweep.sql",
  "20261102045553_shipping_void_rejected_seller_debt.sql",
  "20261102051521_shipping_refund_after_void.sql",
  "20261102055653_shipping_admin_no_fault_label_debt.sql",
  "20261102061022_declutter_card_fee_setup_share.sql",
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
// The refund columns and statuses of 20261019070737 (prod shape), without the rest of that file (it needs tables this
// world does not build).
ok(!(await run(`ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_status_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'held_for_review', 'settled_by_hand'));
  ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS review_reason text, ADD COLUMN IF NOT EXISTS review_held_at timestamptz,
    ADD COLUMN IF NOT EXISTS settled_by_hand_ref text, ADD COLUMN IF NOT EXISTS settled_by_hand_cents integer,
    ADD COLUMN IF NOT EXISTS settled_by_hand_note text`))?.error, "the prod refund columns are added");
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}
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


const q = async (s) => (await svc(s))?.[0] ?? null;
const call = async (fn, id) => { const r = await svc(`SELECT public.${fn}('${id}') AS r`); return Array.isArray(r) ? r[0]?.r : r; };
await svc(`UPDATE public.platform_settings SET onboarding_fee_cents = 200`);
const feeRow = await q(`SELECT onboarding_fee_cents FROM public.platform_settings LIMIT 1`);
ok(feeRow?.onboarding_fee_cents === 200, `the world has a $2 setup fee (${short(feeRow)})`);

const acl = one(await svc(`SELECT to_regprocedure('public.declutter_ship_sweep()') IS NOT NULL
  AND NOT has_function_privilege('authenticated', 'public.declutter_ship_sweep()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_ship_sweep()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.declutter_ship_sweep()', 'EXECUTE')`));
ok(acl === true, `the sweep exists and is service-role only (got ${short(acl)})`);

/** A paid ship order whose label was bought and whose hold is in `capture`, with the scan state given. */
const shipped = async (n, buyer, price, { capture = "captured", scan = "delivered", hoursAgo = 25 } = {}) => {
  await svc(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${buyer}'`);
  const line = await hold(n, buyer, price);
  const qid = await quote(buyer, [line], 700);
  await checkout(buyer, "ship", qid);
  const o = await openOrder(buyer);
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_s6b_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
  await svc(`UPDATE public.shipments SET label_state = 'bought', label_cost_cents = 700, tracking_code = 'T${n}', label_path = 'labels/${n}.pdf'
    WHERE declutter_order_id = '${o?.id}'`);
  await svc(`UPDATE public.declutter_orders SET ship_capture = '${capture}' WHERE id = '${o?.id}'`);
  if (scan === "delivered") {
    await svc(`UPDATE public.shipments SET tracking_status = 'delivered', delivered_at = now() - interval '${hoursAgo} hours' WHERE declutter_order_id = '${o?.id}'`);
  } else if (scan) {
    await svc(`UPDATE public.shipments SET tracking_status = '${scan}' WHERE declutter_order_id = '${o?.id}'`);
  }
  return o;
};
const state = async (id) => q(`SELECT o.status, o.items_cents, o.shipping_cents,
  (SELECT count(*)::int FROM public.declutter_payouts p WHERE p.order_id = o.id) AS payouts,
  (SELECT p.amount_cents FROM public.declutter_payouts p WHERE p.order_id = o.id LIMIT 1) AS payout_cents,
  (SELECT p.items_cents FROM public.declutter_payouts p WHERE p.order_id = o.id LIMIT 1) AS payout_items,
  (SELECT p.delivery_cents FROM public.declutter_payouts p WHERE p.order_id = o.id LIMIT 1) AS payout_delivery
  FROM public.declutter_orders o WHERE o.id = '${id}'`);

const late = (id, days = 10) => svc(`UPDATE public.declutter_orders SET paid_at = now() - interval '${days} days' WHERE id = '${id}'`);
const st = async (id) => q(`SELECT o.status, o.total_cents,
  (SELECT s.label_state FROM public.shipments s WHERE s.declutter_order_id = o.id) AS label,
  (SELECT count(*)::int FROM public.declutter_refunds d WHERE d.order_id = o.id) AS refunds,
  (SELECT d.refund_cents FROM public.declutter_refunds d WHERE d.order_id = o.id LIMIT 1) AS refund_cents,
  (SELECT d.reason FROM public.declutter_refunds d WHERE d.order_id = o.id LIMIT 1) AS reason,
  (SELECT d.fee_policy FROM public.declutter_refunds d WHERE d.order_id = o.id LIMIT 1) AS fee_policy,
  (SELECT count(*)::int FROM public.declutter_strikes k JOIN public.declutter_cart_items c ON c.id = k.cart_line_id WHERE c.order_id = o.id AND k.user_id = o.seller_id) AS strikes,
  (SELECT string_agg(i.status, ',') FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id WHERE c.order_id = o.id) AS items
  FROM public.declutter_orders o WHERE o.id = '${id}'`);

const debts = async (id) => (await svc(`SELECT source_kind, amount_cents FROM public.declutter_seller_fee_debts d
  WHERE d.source_ref IN (SELECT s.id FROM public.shipments s WHERE s.declutter_order_id = '${id}')`)) ?? [];
const accept = (id, days) => svc(`UPDATE public.shipments SET tracking_status = 'in_transit', accepted_at = now() - interval '${days} days' WHERE declutter_order_id = '${id}'`);

const lost = await shipped(41, BUYER, 2000, { scan: null });
await accept(lost?.id, 11);
const young = await shipped(42, BUYER2, 1900, { scan: null });
await accept(young?.id, 9);
const pickup = await shipped(43, BUYER, 1800, { scan: null });
await accept(pickup?.id, 12);
await svc(`UPDATE public.shipments SET tracking_status = 'available_for_pickup' WHERE declutter_order_id = '${pickup?.id}'`);
const probO = await shipped(44, BUYER2, 1700, { scan: null });
await accept(probO?.id, 12);
const prob = await svc(`INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, status)
  VALUES ('${probO?.id}', '${BUYER2}', 'buyer', 'not_as_described', 'Never came.', 'open') RETURNING id`);
ok(!prob?.error, `set-up: an open problem on one lost order${prob?.error ? `: ${prob.error}` : ""}`);
const heldO = await shipped(45, BUYER, 1600, { capture: "held", scan: null });
await accept(heldO?.id, 12);
const rts = await shipped(46, BUYER2, 1500, { scan: null });
await accept(rts?.id, 12);
await svc(`UPDATE public.shipments SET tracking_status = 'return_to_sender' WHERE declutter_order_id = '${rts?.id}'`);
const b0 = await st(lost?.id);
ok(b0?.status === "paid" && b0.label === "bought" && b0.refunds === 0, `set-up: a captured ship order accepted 11 days ago, never delivered (${short(b0)})`);

const run1 = await svc(`SELECT public.declutter_ship_sweep() AS r`);
const r1 = Array.isArray(run1) ? run1[0]?.r : run1;
ok(r1?.lost_closed === 2, `the sweep closes exactly the two lost orders (in transit, returned to sender) (${short(run1)})`);
const a = await st(lost?.id);
ok(a?.status === "refunded", `  the lost order is refunded (${short(a)})`);
ok(a?.refunds === 1 && a.refund_cents === a.total_cents && a.reason === "ship_lost" && a.fee_policy === "full_seller_pays_fee",
  `  one 'ship_lost' refund of EVERYTHING, the seller pays the card fee (${short(a)})`);
ok(a?.strikes === 0, `  no strike: the carrier lost it (${short(a)})`);
ok(a?.items === "withdrawn", `  the item is withdrawn, not put back on sale (${short(a)})`);
const d = await debts(lost?.id);
ok(d.length === 1 && d[0].source_kind === "ship_label" && d[0].amount_cents === 700, `  the spent label is ONE seller debt of its cost (${short(d)})`);
ok((await st(rts?.id))?.status === "refunded", "  a return-to-sender after 10 days is closed the same way");
for (const [o, why] of [[young, "accepted 9 days ago"], [pickup, "waiting for pickup"], [probO, "an open problem"], [heldO, "a hold not captured"]]) {
  const x = await st(o?.id);
  ok(x?.status === "paid" && x.refunds === 0, `  left alone: ${why} (${short(x)})`);
}
const run2 = await svc(`SELECT public.declutter_ship_sweep() AS r`);
const r2 = Array.isArray(run2) ? run2[0]?.r : run2;
ok(r2?.lost_closed === 0 && (await debts(lost?.id)).length === 1, `a second run changes nothing (${short(run2)})`);
const bad = await svc(`INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, refund_cents, card_fee_cents, kept_cents)
  VALUES ('${young?.id}', 'pi_x', 'ship_lost', 'keep_card_fee', 100, 100, 0, 0)`);
ok(/declutter_refunds_policy/.test(bad?.error ?? ""), `the policy CHECK pins ship_lost to full_seller_pays_fee (${short(bad)})`);

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
if (fail) process.exit(1);

#!/usr/bin/env node
/**
 * PGlite proof for 20261102013630_shipping_s5_delivered_payout (Q2259 S5): declutter_ship_sweep finishes a shipped
 * order 24 hours after the USPS delivered scan, through declutter_complete_handover (handed_over + one payout row of
 * the items only, never the shipping), and leaves alone: a scan under 24 hours old, no delivered scan, an open
 * problem, a hold not captured (held or released), a non-ship order. A second run changes nothing. Service role only.
 *
 *   node src/test/pglite/shippingS5DeliveredPayout.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingS5DeliveredPayout.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                       # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102013630_shipping_s5_delivered_payout.sql";
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
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_s5_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
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

const due = await shipped(21, BUYER, 2000);
const fresh = await shipped(22, BUYER2, 1900, { hoursAgo: 3 });
const transit = await shipped(23, BUYER, 1800, { scan: "in_transit" });
const heldO = await shipped(24, BUYER2, 1700, { capture: "held" });
const releasedO = await shipped(25, BUYER, 1600, { capture: "released" });
const problemO = await shipped(26, BUYER2, 1500);
const firstReporter = one(await svc(`SELECT buyer_id FROM public.declutter_orders WHERE id = '${problemO?.id}'`));
const prob = await svc(`INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, status)
  VALUES ('${problemO?.id}', '${firstReporter}', 'buyer', 'not_as_described', 'It came broken.', 'open') RETURNING id`);
ok(!prob?.error, `set-up: an open problem on one delivered order${prob?.error ? `: ${prob.error}` : ""}`);
const before = await state(due?.id);
ok(before?.status === "paid" && before.payouts === 0 && before.shipping_cents === 700,
  `set-up: a captured ship order delivered 25 h ago, still paid, no payout (${short(before)})`);

const run1 = await svc(`SELECT public.declutter_ship_sweep() AS r`);
const r1 = Array.isArray(run1) ? run1[0]?.r : run1;
ok(r1?.delivered_handed_over === 1, `the sweep finishes exactly one order (${short(run1)})`);
const after = await state(due?.id);
ok(after?.status === "handed_over", `  the delivered + 24 h order is handed over (${short(after)})`);
ok(after?.payouts === 1 && after.payout_items === 2000 && after.payout_delivery === 0,
  `  one payout row of the items only: the shipping (bought the label) is never paid to the seller (${short(after)})`);
for (const [label, o] of [["a scan 3 h old", fresh], ["in transit, no delivered scan", transit], ["a hold still held", heldO],
  ["a released hold", releasedO], ["an open problem", problemO]]) {
  const s = await state(o?.id);
  ok(s?.status === "paid" && s.payouts === 0, `  left alone: ${label} (${short(s)})`);
}
// The open problem is skipped by the sweep itself (complete_handover would also refuse it, 'problem_open', which the
// sweep would log as a defect every run): nothing was attempted, so no defect is logged.
const defects = await svc(`SELECT count(*)::int AS n FROM public.cron_defects_seen`);
ok((defects?.[0]?.n ?? -1) === 0, `no order was attempted and refused: 0 defects logged (${short(defects)})`);
// A shipment with a delivery time but no delivered scan (a later failure scan) is never finished.
const odd = await shipped(27, BUYER, 1400, { scan: "failure" });
await svc(`UPDATE public.shipments SET delivered_at = now() - interval '30 hours' WHERE declutter_order_id = '${odd?.id}'`);
const run2 = await svc(`SELECT public.declutter_ship_sweep() AS r`);
const r2 = Array.isArray(run2) ? run2[0]?.r : run2;
const again = await state(due?.id);
ok(r2?.delivered_handed_over === 0 && again?.payouts === 1, `a second run changes nothing (${short(run2)} ${short(again)})`);
const oddS = await state(odd?.id);
ok(oddS?.status === "paid" && oddS.payouts === 0, `  left alone: a failure scan, even with a delivery time on the row (${short(oddS)})`);
// The 3 h one, once its scan is 24 h old, goes on the next run.
await svc(`UPDATE public.shipments SET delivered_at = now() - interval '24 hours 1 minute' WHERE declutter_order_id = '${fresh?.id}'`);
const run3 = await svc(`SELECT public.declutter_ship_sweep() AS r`);
const fr = await state(fresh?.id);
ok((Array.isArray(run3) ? run3[0]?.r : run3)?.delivered_handed_over === 1 && fr?.status === "handed_over",
  `the same order once its scan passes 24 h (${short(run3)} ${short(fr)})`);
// A signed-in member cannot run it.
const asMember = await me(BUYER, `SELECT public.declutter_ship_sweep()`);
ok(refused(asMember, /permission denied|not exist/i), `a member cannot call it (${short(asMember)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

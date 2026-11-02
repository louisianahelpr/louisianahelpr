#!/usr/bin/env node
/**
 * PGlite proof for 20261102045553_shipping_void_rejected_seller_debt (Q2259 S6 part 2c): when the void of a label on an
 * order refunded on the SELLER (the never-shipped sweep: seller_backed_out) is rejected, the spent postage becomes ONE
 * seller fee debt (source_kind ship_void_rejected, source_ref = shipment, amount = label cost) and the seller is told.
 * Nothing is booked for a voided label, or for a label whose order closed because the card hold was lost (not the
 * seller's fault). The trigger function is not callable by members (Supabase's default execute grant emulated).
 *
 *   node src/test/pglite/shippingVoidRejectedSellerDebt.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingVoidRejectedSellerDebt.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                            # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102045553_shipping_void_rejected_seller_debt.sql";
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
  "20261102043018_shipping_debt_source_key.sql",
  "20261102045035_shipping_never_shipped_sweep.sql",
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
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_s6c_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
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
const shipOf = async (oid) => q(`SELECT id, label_state, label_cost_cents FROM public.shipments WHERE declutter_order_id = '${oid}'`);
const debtsFor = async (shipId) => svc(`SELECT seller_id, source_kind, amount_cents, remaining_cents FROM public.declutter_seller_fee_debts
  WHERE source_kind = 'ship_void_rejected' AND source_ref = '${shipId}'`);

const rej = await shipped(41, BUYER, 2000, { scan: null });
await late(rej?.id);
const vok = await shipped(42, BUYER2, 1900, { scan: null });
await late(vok?.id);
const sw = await svc(`SELECT public.declutter_ship_sweep() AS r`);
ok((Array.isArray(sw) ? sw[0]?.r : sw)?.never_shipped_closed === 2, `set-up: the sweep closes two never-shipped orders on the seller (${short(sw)})`);
const sRej = await shipOf(rej?.id);
const sVok = await shipOf(vok?.id);
ok(sRej?.label_state === "void_requested" && sVok?.label_state === "void_requested", `set-up: both labels are waiting to be voided (${short([sRej, sVok])})`);
// A ship order whose card hold was lost: it never captured; its label void is rejected later. Not the seller's fault.
const lost = await shipped(43, BUYER, 1800, { capture: "held", scan: null });
await svc(`UPDATE public.shipments SET label_state = 'void_requested' WHERE declutter_order_id = '${lost?.id}'`);
const hr = await svc(`SELECT public.declutter_ship_hold_released('${lost?.id}') AS r`);
ok(!hr?.error, `set-up: the lost-hold order is closed by declutter_ship_hold_released (${short(hr)})`);
const sLost = await shipOf(lost?.id);

const before = await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${SELLER2}'`);
for (const [sid, st] of [[sRej?.id, "void_rejected"], [sVok?.id, "voided"], [sLost?.id, "void_rejected"]]) {
  const r = await svc(`UPDATE public.shipments SET label_state = '${st}' WHERE id = '${sid}' RETURNING label_state`);
  ok(Array.isArray(r) && r[0]?.label_state === st, `the label worker records ${st} (${short(r)})`);
}
const d1 = await debtsFor(sRej?.id);
ok(Array.isArray(d1) && d1.length === 1 && d1[0].seller_id === SELLER2 && d1[0].amount_cents === 700 && d1[0].remaining_cents === 700,
  `a rejected void on a seller-fault refund is ONE seller debt of the label cost (${short(d1)})`);
const d2 = await debtsFor(sVok?.id);
ok(Array.isArray(d2) && d2.length === 0, `a voided label books nothing (${short(d2)})`);
const d3 = await debtsFor(sLost?.id);
ok(Array.isArray(d3) && d3.length === 0, `a lost card hold is not the seller's fault: nothing booked (${short(d3)})`);
const told = await svc(`SELECT title, message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'Shipping label added to what you owe'`);
ok(Array.isArray(told) && told.length === 1 && /\$7\.00 comes out of your next Declutter payout/.test(told[0].message) && told[0].message.includes("Ship item 41"),
  `the seller is told once, with the item and the amount (${short(told)})`);
const after = await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${SELLER2}'`);
ok((after?.[0]?.n ?? 0) - (before?.[0]?.n ?? 0) === 1, `exactly one new notice for the seller (${short([before, after])})`);
// A replayed write of the same state (no transition) books nothing more.
const again = await svc(`UPDATE public.shipments SET label_state = 'void_rejected', last_error = 'again' WHERE id = '${sRej?.id}' RETURNING id`);
ok(Array.isArray(again) && again.length === 1, `the worker's repeated write still succeeds (${short(again)})`);
const d4 = await debtsFor(sRej?.id);
ok(Array.isArray(d4) && d4.length === 1, `a repeated write books no second debt (${short(d4)})`);
const total = await svc(`SELECT count(*)::int AS n FROM public.declutter_seller_fee_debts WHERE source_kind = 'ship_void_rejected'`);
ok(total?.[0]?.n === 1, `one shipping debt in all (${short(total)})`);
await run(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated`);
if (!skip) {
  const r = await run(readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8"));
  ok(!r?.error, `the migration applies again after Supabase's default execute grant${r?.error ? `: ${r.error}` : ""}`);
}
const fx = one(await svc(`SELECT NOT has_function_privilege('authenticated', 'public.declutter_ship_void_rejected_debt()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_ship_void_rejected_debt()', 'EXECUTE')`));
ok(fx === true, `the trigger function is not callable by members (${short(fx)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

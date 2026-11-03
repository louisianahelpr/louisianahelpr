#!/usr/bin/env node
/**
 * PGlite proof for 20261103213005_shipping_claim_on_damaged_after_handover (Q2259; spec 5.3; lead 11-03): a carrier
 * claim may be recorded on a ship order refunded as not_as_described AFTER the handover (the order stays
 * 'handed_over'), and the claim pays that order's return label debt with its other debts, oldest first, never another
 * order's. A handed_over order with no such refund (or a buyer-fault one) is still refused.
 *
 *   node src/test/pglite/shippingClaimDamagedAfterHandover.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingClaimDamagedAfterHandover.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                                # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261103213005_shipping_claim_on_damaged_after_handover.sql";
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
  "20261102054848_shipping_seller_can_ship_read.sql",
  "20261102055653_shipping_admin_no_fault_label_debt.sql",
  "20261102060324_shipping_buyer_fault_after_delivery.sql",
  "20261102061022_declutter_card_fee_setup_share.sql",
  "20261102063343_declutter_seller_out_after_payment.sql",
  "20261102080936_declutter_seller_out_told_once.sql",
  "20261102084222_a3_stack_reconcile.sql",
  "20261102095838_shipping_seller_can_ship_null.sql",
  "20261103203204_shipping_lost_sweep.sql",
  "20261103210119_shipping_claim_payout_pays_the_order_debt_first.sql",
  "20261103211330_shipping_seller_fault_label_debt.sql",
  "20261103212046_shipping_return_label.sql",
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

const I = (n) => `5b5b5b5b-0000-0000-0000-${String(n).padStart(12, "0")}`;
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

/** A paid ship order whose label was bought and whose hold is in `capture`, with the scan state given. */
const shipped = async (n, buyer, price, { capture = "captured", scan = "delivered", hoursAgo = 25 } = {}) => {
  await svc(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${buyer}'`);
  const line = await hold(n, buyer, price);
  const qid = await quote(buyer, [line], 700);
  await checkout(buyer, "ship", qid);
  const o = await openOrder(buyer);
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_scd_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
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


const { ADMIN } = USERS;
const res = (r) => (Array.isArray(r) ? r[0]?.r : r);
const ask = (uid, order, note = "Buyer sent photos of a cracked lamp; the seller wants it back") =>
  me(uid, `SELECT public.declutter_admin_request_return_label('${order}', '${note}') AS r`);
const bought = (id, cost = 650, shp = "shp_ret_1") => svc(`SELECT public.declutter_ship_return_label_bought('${id}', '${shp}', 'RT${cost}',
  'https://easypost-files.s3.amazonaws.com/files/postage_label/ret.png', ${cost}) AS r`);
const myLabel = (uid, order) => me(uid, `SELECT public.declutter_my_return_label('${order}') AS r`);
const returnDebts = async () => (await svc(`SELECT d.source_kind, d.amount_cents, d.remaining_cents, d.seller_id FROM public.declutter_seller_fee_debts d
  WHERE d.source_ref IN (SELECT r.id FROM public.shipping_return_labels r)`)) ?? [];
const handOver = async (o) => { await svc(`SELECT public.declutter_ship_sweep()`); };
const after = (id, reason) => svc(`SELECT public.declutter_refund_after_handover('${id}', '${reason}', NULL) AS r`);
const settle = () => svc(`UPDATE public.declutter_seller_fee_debts SET remaining_cents = 0 WHERE source_kind LIKE 'ship_%'`);

const claim = (order, ref, cents) => me(ADMIN, `SELECT public.declutter_admin_record_ship_claim('${order}', '${ref}', ${cents}, 'USPS paid the damage claim') AS r`);
const orderDebts = async (id) => (await svc(`SELECT x.id, x.source_kind, x.amount_cents, x.remaining_cents FROM public.declutter_seller_fee_debts x
  WHERE x.refund_id IN (SELECT r.id FROM public.declutter_refunds r WHERE r.order_id = '${id}')
     OR x.source_ref IN (SELECT s.id FROM public.shipments s WHERE s.declutter_order_id = '${id}')
     OR x.source_ref IN (SELECT rl.id FROM public.shipping_return_labels rl WHERE rl.order_id = '${id}')
  ORDER BY x.created_at, x.id`)) ?? [];
const owed = (rows) => rows.reduce((n, r) => n + r.remaining_cents, 0);
const status = async (id) => (await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`))?.[0]?.status;

// Every order is paid and handed over FIRST: a later sale or payout run would take the seller's open debts.
const A = await shipped(91, BUYER, 2000);
const B = await shipped(92, BUYER2, 1800);
const C = await shipped(93, BUYER, 1500);
const D = await shipped(94, BUYER2, 1400);
await handOver(A);
ok((await Promise.all([A, B, C, D].map((o) => status(o?.id)))).every((st) => st === "handed_over"), "set-up: all four orders are handed over");
// A: refunded as not as described, the item asked back (return label bought: $6.50).
ok(!(await after(A?.id, "not_as_described"))?.error, "set-up: order 91 is refunded as not as described after the handover");
ok((await status(A?.id)) === "handed_over", "set-up: the order stays handed_over");
const RID = res(await ask(ADMIN, A?.id))?.return_id;
ok(res(await bought(RID)) === "bought", "set-up: its return label is bought");
const d0 = await orderDebts(A?.id);
ok(d0.length === 3 && d0.some((d) => d.source_kind === "refund_card_fee") && d0.filter((d) => d.source_kind === "ship_label").length === 2
  && owed(d0) > 1300, `set-up: A owes its card cost, its spent label and its return label (${short(d0)})`);
// B: another of the seller's orders, also owing: never paid by A's claim.
ok(!(await after(B?.id, "not_as_described"))?.error, "set-up: order 92 is refunded as not as described");
const dB0 = owed(await orderDebts(B?.id));
ok(dB0 > 0, `set-up: B owes ${dB0}`);
// C: refunded on the buyer's side: still refused. D: never refunded: still refused.
ok(!(await after(C?.id, "admin_buyer_fault"))?.error, "set-up: order 93 is refunded as buyer fault");

// 1. A claim on A covering everything A owes: recorded, A owes nothing (the return label included), B untouched.
const all = owed(d0);
const r1 = res(await claim(A?.id, "dmg-1", all + 200));
ok(r1?.result === "recorded" && r1.debt_paid_cents === all && r1.seller_due_cents === 200,
  `a claim on a damaged parcel refunded after the handover is recorded and pays all ${all} A owed (${short(r1)})`);
const d1 = await orderDebts(A?.id);
ok(owed(d1) === 0, `A owes nothing, its return label included (${short(d1)})`);
ok(owed(await orderDebts(B?.id)) === dB0, "B's debts are untouched");

// 2. Still refused: a buyer-fault refund after the handover; a handed-over order never refunded.
ok(refused(await claim(C?.id, "dmg-c", 100), /order_not_refunded/), "a buyer-fault refund after the handover is refused");
ok(refused(await claim(D?.id, "dmg-d", 100), /order_not_refunded/), "a handed-over order with no refund is refused");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
if (fail) process.exit(1);

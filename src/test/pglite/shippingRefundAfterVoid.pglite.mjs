#!/usr/bin/env node
/**
 * PGlite proof for 20261102051521_shipping_refund_after_void (Q2259 S6 part 2d): a buyer-fault close of a shipped order
 * whose label was bought refunds everything except the shipping now (admin_buyer_fault used to raise
 * refund_amount_unknown; buyer_cancelled used to refund the shipping at once); the test label is sent to be voided;
 * once it is voided ONE shipping refund row is written (declutter_delivery_refunds, 'ship_void_refunded') and counted
 * in declutter_order_refunds_recorded_cents; a rejected void writes nothing; a seller-fault close still refunds
 * everything now; a ship order with no label bought refunds its shipping at once. The new functions are service-role
 * only (Supabase's default execute grant emulated).
 *
 *   node src/test/pglite/shippingRefundAfterVoid.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingRefundAfterVoid.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                     # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102051521_shipping_refund_after_void.sql";
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
  "20261102045553_shipping_void_rejected_seller_debt.sql",
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
await svc(`UPDATE public.platform_settings SET onboarding_fee_cents = 200`);

/** A paid, captured ship order; `label` is the shipment's label state ('bought' or 'claimed'). */
const paidShip = async (n, buyer, price, { label = "bought", scanned = false } = {}) => {
  await svc(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${buyer}'`);
  const line = await hold(n, buyer, price);
  const qid = await quote(buyer, [line], 700);
  await checkout(buyer, "ship", qid);
  const o = await openOrder(buyer);
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_s6d_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
  if (label === "bought") {
    await svc(`UPDATE public.shipments SET label_state = 'bought', label_cost_cents = 700, tracking_code = 'T${n}', label_path = 'labels/${n}.pdf'
      ${scanned ? ", accepted_at = now()" : ""} WHERE declutter_order_id = '${o?.id}'`);
  }
  await svc(`UPDATE public.declutter_orders SET ship_capture = 'captured' WHERE id = '${o?.id}'`);
  return q(`SELECT id, items_cents, premium_cents, tax_cents, shipping_cents, total_cents, buyer_id FROM public.declutter_orders WHERE id = '${o?.id}'`);
};
const close = (id, reason, side = null) => svc(`SELECT public.declutter_close_paid_order('${id}', '${reason}', ${side ? `'${side}'` : "NULL"},
  ${side ? "'not_picked_up'" : "NULL"}, 'proof') AS r`);
const refundOf = (id) => q(`SELECT reason, fee_policy, paid_cents, kept_cents, refund_cents FROM public.declutter_refunds WHERE order_id = '${id}'`);
const shipRefund = (id) => svc(`SELECT reason, refund_cents, status FROM public.declutter_delivery_refunds WHERE order_id = '${id}'`);
const shipOf = (id) => q(`SELECT id, label_state FROM public.shipments WHERE declutter_order_id = '${id}'`);
const setLabel = (id, st) => svc(`UPDATE public.shipments SET label_state = '${st}' WHERE declutter_order_id = '${id}' RETURNING label_state`);

// 1. admin_buyer_fault (keep_buyer_fee) on a bought label: items + tax back now, shipping held, label void requested.
const a = await paidShip(51, BUYER, 2000);
ok(a?.shipping_cents === 700 && a.total_cents === a.items_cents + a.premium_cents + a.tax_cents + 700, `set-up: a captured ship order with $7 shipping (${short(a)})`);
const ca = await close(a?.id, "admin_buyer_fault", "buyer");
ok(!ca?.error, `an admin buyer-fault close of a shipped order succeeds (${short(ca)})`);
const ra = await refundOf(a?.id);
ok(ra?.paid_cents === a.total_cents - 700 && ra.refund_cents === a.items_cents + a.tax_cents && ra.kept_cents === a.premium_cents,
  `the refund is items + tax now; the fee is kept and the shipping held back (${short(ra)})`);
ok((await shipOf(a?.id))?.label_state === "void_requested", `the test label is sent to be voided`);
ok((await shipRefund(a?.id))?.length === 0, `no shipping refund before the void`);
const na = await q(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Refund on its way' ORDER BY created_at DESC LIMIT 1`);
ok(/\$7\.00 for shipping comes back once the shipping label is cancelled/.test(na?.message ?? ""), `the buyer is told the shipping comes later (${short(na)})`);
const sa = await q(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'Sale cancelled' ORDER BY created_at DESC LIMIT 1`);
ok(/Don't ship it/.test(sa?.message ?? ""), `the seller is told not to ship it (${short(sa)})`);
// The void succeeds: ONE shipping refund of $7, counted in the recorded total once it is sent.
const va = await setLabel(a?.id, "voided");
ok(Array.isArray(va) && va[0]?.label_state === "voided", `the label worker records voided (${short(va)})`);
const sr = await shipRefund(a?.id);
ok(Array.isArray(sr) && sr.length === 1 && sr[0].reason === "ship_void_refunded" && sr[0].refund_cents === 700 && sr[0].status === "pending",
  `the void writes ONE shipping refund of $7 (${short(sr)})`);
await svc(`UPDATE public.declutter_refunds SET status = 'succeeded' WHERE order_id = '${a?.id}'`);
await svc(`UPDATE public.declutter_delivery_refunds SET status = 'succeeded' WHERE order_id = '${a?.id}'`);
const rec = one(await svc(`SELECT public.declutter_order_refunds_recorded_cents('${a?.id}')`));
ok(rec === a.items_cents + a.tax_cents + 700, `the recorded refunds are items + tax + shipping (${short(rec)})`);
const nsa = await q(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Shipping refund on its way'`);
ok(/\$7\.00 you paid for shipping/.test(nsa?.message ?? ""), `the buyer is told the shipping refund is coming (${short(nsa)})`);
const again = one(await svc(`SELECT public.declutter_ship_refund_after_void('${a?.id}')`));
ok(again === null && (await shipRefund(a?.id)).length === 1, `a second call writes nothing more (${short(again)})`);

// 2. buyer_cancelled (keep_card_fee): the shipping is held back too; a rejected void gives none back.
const b = await paidShip(52, BUYER2, 1500);
const cb = await close(b?.id, "buyer_cancelled");
ok(!cb?.error, `a buyer-cancelled close succeeds (${short(cb)})`);
const rb = await refundOf(b?.id);
ok(rb?.paid_cents === b.total_cents - 700, `buyer_cancelled leaves the shipping out of the refund (${short(rb)})`);
await setLabel(b?.id, "void_rejected");
ok((await shipRefund(b?.id)).length === 0, `a rejected void gives no shipping back`);
const db = await svc(`SELECT count(*)::int AS n FROM public.declutter_seller_fee_debts WHERE source_kind = 'ship_void_rejected'`);
ok(db?.[0]?.n === 0, `a buyer-fault rejected void books no seller debt (${short(db)})`);

// 3. Seller fault: everything back now, nothing held; a later void writes no shipping refund.
const c = await paidShip(53, BUYER, 1800);
await svc(`UPDATE public.shipments SET label_state = 'void_requested' WHERE declutter_order_id = '${c?.id}'`);
await close(c?.id, "seller_backed_out", "seller");
const rc = await refundOf(c?.id);
ok(rc?.paid_cents === c.total_cents && rc.refund_cents === c.total_cents, `a seller-fault close refunds everything now, shipping included (${short(rc)})`);
await setLabel(c?.id, "voided");
ok((await shipRefund(c?.id)).length === 0, `its void writes no second shipping refund`);

// 4. No label bought (claimed): nothing is held back; the shipping goes back with the rest.
const d = await paidShip(54, BUYER2, 1600, { label: "claimed" });
await close(d?.id, "buyer_cancelled");
const rd = await refundOf(d?.id);
ok(rd?.paid_cents === d.total_cents, `no label bought: the shipping is in the refund (${short(rd)})`);

// 4b. admin_buyer_fault (keep_buyer_fee) with no label bought: the whole order minus the fee, shipping included, at once
// (its amount check now counts the shipping that is not held back).
const d2 = await paidShip(57, BUYER, 1300, { label: "claimed" });
const cd2 = await close(d2?.id, "admin_buyer_fault", "buyer");
const rd2 = await refundOf(d2?.id);
ok(!cd2?.error && rd2?.paid_cents === d2.total_cents && rd2.refund_cents === d2.total_cents - d2.premium_cents,
  `no label bought, buyer's fault: everything but the fee back now, shipping included (${short([cd2?.error, rd2])})`);

// 5. A scanned parcel: the shipping is held, no void is asked for (the label is in use).
const e = await paidShip(55, BUYER, 1700, { scanned: true });
await close(e?.id, "admin_buyer_fault", "buyer");
const re = await refundOf(e?.id);
ok(re?.paid_cents === e.total_cents - 700 && (await shipOf(e?.id))?.label_state === "bought", `a scanned parcel: shipping held, label left alone (${short(re)})`);

// 6. A live label is never voided by itself: paged.
const f = await paidShip(56, BUYER2, 1400);
await run(`SET session_replication_role = replica; UPDATE public.shipments SET label_mode = 'live' WHERE declutter_order_id = '${f?.id}'; SET session_replication_role = origin;`);
await close(f?.id, "buyer_cancelled");
const pg = await svc(`SELECT msg FROM public.cron_defects_seen WHERE fn = 'declutter_close_paid_order-live-void' AND ref = '${f?.id}'`);
ok((await shipOf(f?.id))?.label_state === "bought" && Array.isArray(pg) && pg.length === 1, `a live label stays bought and is paged (${short(pg)})`);

// 7. A non-ship order: unchanged (the whole total back on a buyer cancel).
const reserved0 = one(await svc(`SELECT public.declutter_shipping_reserved_cents(gen_random_uuid())`));
ok(reserved0 === null || reserved0 === 0, `an unknown order reserves nothing (${short(reserved0)})`);

await run(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated`);
if (!skip) {
  const r = await run(readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8"));
  ok(!r?.error, `the migration applies again after Supabase's default execute grant${r?.error ? `: ${r.error}` : ""}`);
}
for (const sig of ["declutter_shipping_reserved_cents(uuid)", "declutter_ship_refund_after_void(uuid)", "declutter_ship_voided_refund()",
  "declutter_close_paid_order(uuid,text,text,text,text)", "declutter_record_refund(uuid,text,text,integer,integer)"]) {
  const g = one(await svc(`SELECT to_regprocedure('public.${sig}') IS NOT NULL
    AND NOT has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.${sig}', 'EXECUTE')`));
  ok(g === true, `${sig} exists and is not callable by members (${short(g)})`);
}
const bad = await me(BUYER, `SELECT public.declutter_ship_refund_after_void('${a?.id}')`);
ok(!!bad?.error, `a member calling the refund helper is refused (${short(bad)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

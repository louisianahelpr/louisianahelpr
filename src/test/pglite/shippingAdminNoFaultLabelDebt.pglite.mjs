#!/usr/bin/env node
/**
 * PGlite proof for 20261102055653_shipping_admin_no_fault_label_debt (Q2259 S6 part 2f): an admin's no-fault refund of a
 * shipped order still gives the buyer everything back, and the label (decision 6: spent = seller debt):
 *   scanned or delivered -> ONE 'ship_label' seller debt at the label cost (before and after the handover);
 *   bought, not scanned  -> a test label is sent to be voided and the seller told not to ship; a live one is paged;
 *   a later rejected void -> ONE 'ship_void_rejected' debt (the 2c trigger now knows admin_no_fault);
 *   voided / no label / other reasons -> nothing. Trigger functions not callable by members (default grant emulated).
 *
 * (Harness shared with the 2d proof, whose header follows.)
 * PGlite proof for 20261102051521_shipping_refund_after_void (Q2259 S6 part 2d): a buyer-fault close of a shipped order
 * whose label was bought refunds everything except the shipping now (admin_buyer_fault used to raise
 * refund_amount_unknown; buyer_cancelled used to refund the shipping at once); the test label is sent to be voided;
 * once it is voided ONE shipping refund row is written (declutter_delivery_refunds, 'ship_void_refunded') and counted
 * in declutter_order_refunds_recorded_cents; a rejected void writes nothing; a seller-fault close still refunds
 * everything now; a ship order with no label bought refunds its shipping at once. The new functions are service-role
 * only (Supabase's default execute grant emulated).
 *
 *   node src/test/pglite/shippingAdminNoFaultLabelDebt.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingAdminNoFaultLabelDebt.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                     # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102055653_shipping_admin_no_fault_label_debt.sql";
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
  "20261102051521_shipping_refund_after_void.sql",
  "20261102054411_shipping_debt_blocks_new_ship_sales.sql",
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

const I = (n) => `5f5f5f5f-0000-0000-0000-${String(n).padStart(12, "0")}`;
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
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_s6f_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
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

const debts = (id) => svc(`SELECT d.source_kind, d.amount_cents, d.remaining_cents, d.seller_id FROM public.declutter_seller_fee_debts d
  JOIN public.shipments s ON s.id = d.source_ref WHERE s.declutter_order_id = '${id}' ORDER BY d.source_kind`);
// An open shipping debt stops the seller selling with shipping (2e), so each case below settles it once checked.
const settle = () => svc(`UPDATE public.declutter_seller_fee_debts SET remaining_cents = 0 WHERE source_kind LIKE 'ship_%'`);

// 1. Before the handover, label scanned: everything back, ONE ship_label debt of the label cost, the seller told.
const a = await paidShip(61, BUYER, 2000, { scanned: true });
const ca = await close(a?.id, "admin_no_fault");
ok(!ca?.error, `an admin no-fault close of a scanned shipped order succeeds (${short(ca)})`);
const ra = await refundOf(a?.id);
ok(ra?.paid_cents === a.total_cents && ra.fee_policy === "keep_card_fee", `the buyer's refund is the whole order, shipping included (${short(ra)})`);
const da = await debts(a?.id);
ok(Array.isArray(da) && da.length === 1 && da[0].source_kind === "ship_label" && da[0].amount_cents === 700 && da[0].remaining_cents === 700
  && da[0].seller_id === SELLER2, `ONE ship_label debt of $7 on the seller (${short(da)})`);
const na = await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'Shipping label added to what you owe'
  AND message LIKE '%Ship item 61%'`);
ok(Array.isArray(na) && na.length === 1 && /already used.*\$7\.00 comes out of your next Declutter payout/.test(na[0].message),
  `the seller is told once, with the amount (${short(na)})`);
ok((await shipOf(a?.id))?.label_state === "bought", `a scanned label is left alone (no void)`);
await settle();

// 2. Before the handover, test label not scanned: void requested, no debt now, seller told not to ship.
const b = await paidShip(62, BUYER2, 1500);
const cb = await close(b?.id, "admin_no_fault");
ok(!cb?.error && (await refundOf(b?.id))?.paid_cents === b.total_cents, `a no-fault close refunds everything (${short(cb)})`);
ok((await shipOf(b?.id))?.label_state === "void_requested", `the unscanned test label is sent to be voided`);
ok((await debts(b?.id)).length === 0, `no debt while the void is pending`);
const nb = await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'Don''t ship it' AND message LIKE '%Ship item 62%'`);
ok(Array.isArray(nb) && nb.length === 1, `the seller is told not to ship it (${short(nb)})`);
// 2a. The void is rejected: ONE ship_void_rejected debt (2c's trigger, reason list widened).
await setLabel(b?.id, "void_rejected");
const db = await debts(b?.id);
ok(Array.isArray(db) && db.length === 1 && db[0].source_kind === "ship_void_rejected" && db[0].amount_cents === 700,
  `a rejected void after a no-fault refund is ONE seller debt (${short(db)})`);
await settle();

// 3. The void succeeds: nothing owed, and no shipping refund row (the buyer already got the shipping back).
const c = await paidShip(63, BUYER, 1800);
await close(c?.id, "admin_no_fault");
await setLabel(c?.id, "voided");
ok((await debts(c?.id)).length === 0 && (await shipRefund(c?.id)).length === 0, `a voided label: no debt, no second shipping refund`);

// 4. A live label not scanned: paged, never voided by itself, no debt now.
const d = await paidShip(64, BUYER2, 1400);
await run(`SET session_replication_role = replica; UPDATE public.shipments SET label_mode = 'live' WHERE declutter_order_id = '${d?.id}'; SET session_replication_role = origin;`);
await close(d?.id, "admin_no_fault");
const pg = await svc(`SELECT msg FROM public.cron_defects_seen WHERE fn = 'declutter_ship_no_fault_label-live-void' AND ref = '${d?.id}'`);
ok((await shipOf(d?.id))?.label_state === "bought" && Array.isArray(pg) && pg.length === 1 && (await debts(d?.id)).length === 0,
  `a live label stays bought, is paged, and books nothing yet (${short(pg)})`);

// 5. No label bought: nothing.
const e = await paidShip(65, BUYER, 1600, { label: "claimed" });
await close(e?.id, "admin_no_fault");
ok((await debts(e?.id)).length === 0 && (await shipOf(e?.id))?.label_state === "claimed", `no label bought: no debt, nothing voided`);

// 6. Another reason on a scanned label (buyer cancelled): no seller debt from this trigger.
const f = await paidShip(66, BUYER2, 1700, { scanned: true });
await close(f?.id, "buyer_cancelled");
ok((await debts(f?.id)).length === 0, `a buyer-side close books no seller label debt`);

// 7. After the handover (delivered, handed over by the S5 sweep): an admin no-fault refund books the spent label.
const g = await paidShip(67, BUYER, 2100, { scanned: true });
await svc(`UPDATE public.shipments SET tracking_status = 'delivered', delivered_at = now() - interval '25 hours' WHERE declutter_order_id = '${g?.id}'`);
await svc(`SELECT public.declutter_ship_sweep()`);
const gs = await q(`SELECT status FROM public.declutter_orders WHERE id = '${g?.id}'`);
ok(gs?.status === "handed_over", `set-up: the delivered order is handed over (${short(gs)})`);
const rg = await svc(`SELECT public.declutter_refund_after_handover('${g?.id}', 'admin_no_fault', NULL) AS r`);
ok(!rg?.error, `an admin no-fault refund after the handover succeeds (${short(rg)})`);
const dg = await debts(g?.id);
ok(Array.isArray(dg) && dg.length === 1 && dg[0].source_kind === "ship_label" && dg[0].amount_cents === 700,
  `after the handover the spent label is ONE seller debt (${short(dg)})`);

// 8. A replayed refund row write never bills twice.
const before = (await svc(`SELECT count(*)::int AS n FROM public.declutter_seller_fee_debts`))?.[0]?.n;
const rep = await svc(`SELECT public.declutter_record_refund('${a?.id}', 'pi_s6f_61', 'admin_no_fault', ${a?.total_cents}, 40)`);
const after = (await svc(`SELECT count(*)::int AS n FROM public.declutter_seller_fee_debts`))?.[0]?.n;
ok(!rep?.error && before === after, `a replayed refund books nothing more (${short([before, after])})`);

await run(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated`);
if (!skip) {
  const r = await run(readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8"));
  ok(!r?.error, `the migration applies again after Supabase's default execute grant${r?.error ? `: ${r.error}` : ""}`);
}
for (const sig of ["declutter_ship_no_fault_label()", "declutter_ship_void_rejected_debt()"]) {
  const gr = one(await svc(`SELECT to_regprocedure('public.${sig}') IS NOT NULL
    AND NOT has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.${sig}', 'EXECUTE')`));
  ok(gr === true, `${sig} exists and is not callable by members (${short(gr)})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

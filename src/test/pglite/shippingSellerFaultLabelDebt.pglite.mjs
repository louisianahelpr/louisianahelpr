#!/usr/bin/env node
/**
 * PGlite proof for 20261103211330_shipping_seller_fault_label_debt (Q2259; spec 5.3): a refund on the SELLER of a
 * shipped order books its spent label as the seller's debt, like the admin no-fault and lost-parcel refunds already do.
 * Before: declutter_ship_no_fault_label acted only on admin_no_fault and ship_lost, so a refund after the 24 h auto
 * handover (declutter_refund_after_handover) as not_as_described (the 5.3 "ship_damaged / not as described" row),
 * seller_no_show (the seller agreed the buyer never got it) or admin_no_fault while the seller is out (recorded as
 * seller_out) left the used label on the platform. Also: a rejected void after a seller_out refund is the seller's
 * (declutter_ship_void_rejected_debt), and the buyer-side reasons still book nothing.
 *
 *   node src/test/pglite/shippingSellerFaultLabelDebt.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingSellerFaultLabelDebt.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                           # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261103211330_shipping_seller_fault_label_debt.sql";
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
  "20261102060324_shipping_buyer_fault_after_delivery.sql",
  "20261102061022_declutter_card_fee_setup_share.sql",
  "20261102063343_declutter_seller_out_after_payment.sql",
  "20261102080936_declutter_seller_out_told_once.sql",
  "20261102084222_a3_stack_reconcile.sql",
  "20261103203204_shipping_lost_sweep.sql",
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

const I = (n) => `5d5d5d5d-0000-0000-0000-${String(n).padStart(12, "0")}`;
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
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_sfl_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
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


const debts = (id) => svc(`SELECT d.source_kind, d.amount_cents, d.remaining_cents, d.seller_id FROM public.declutter_seller_fee_debts d
  JOIN public.shipments s ON s.id = d.source_ref WHERE s.declutter_order_id = '${id}' ORDER BY d.source_kind`);
const oneLabelDebt = (rows, kind = "ship_label") => Array.isArray(rows) && rows.length === 1 && rows[0].source_kind === kind
  && rows[0].amount_cents === 700 && rows[0].remaining_cents === 700 && rows[0].seller_id === SELLER2;
// An open shipping debt stops the seller selling with shipping (2e), so each case settles it once checked.
const settle = () => svc(`UPDATE public.declutter_seller_fee_debts SET remaining_cents = 0 WHERE source_kind LIKE 'ship_%'`);
const told = async (n) => (await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}'
  AND title = 'Shipping label added to what you owe' AND message LIKE '%Ship item ${n}%'`)) ?? [];
const handOver = async (o) => {
  await svc(`SELECT public.declutter_ship_sweep()`);
  return (await q(`SELECT status FROM public.declutter_orders WHERE id = '${o?.id}'`))?.status;
};
const after = (id, reason) => svc(`SELECT public.declutter_refund_after_handover('${id}', '${reason}', NULL) AS r`);
const close = (id, reason) => svc(`SELECT public.declutter_close_paid_order('${id}', '${reason}', NULL, NULL, 'proof') AS r`);
const refundReason = async (id) => (await q(`SELECT reason FROM public.declutter_refunds WHERE order_id = '${id}'`))?.reason;

// 1. Delivered, handed over by the 24 h sweep, then the admin finds it not as described (spec 5.3 ship_damaged row):
//    the spent label is ONE seller debt and the seller is told once.
const a = await shipped(71, BUYER, 2000);
ok((await handOver(a)) === "handed_over", "set-up: the delivered order is handed over");
const ra = await after(a?.id, "not_as_described");
ok(!ra?.error && (await refundReason(a?.id)) === "not_as_described", `a not-as-described refund after the handover succeeds (${short(ra)})`);
const da = await debts(a?.id);
ok(oneLabelDebt(da), `not as described after the handover: ONE ship_label debt of $7 on the seller (${short(da)})`);
const na = await told(71);
ok(na.length === 1 && /\$7\.00 comes out of your next Declutter payout/.test(na[0].message), `the seller is told once, with the amount (${short(na)})`);
await settle();

// 2. The seller agreed the buyer never got it (seller_no_show after the handover): the label is the seller's.
const b = await shipped(72, BUYER2, 1500);
ok((await handOver(b)) === "handed_over", "set-up: order 72 is handed over");
const rb = await after(b?.id, "seller_no_show");
ok(!rb?.error && (await refundReason(b?.id)) === "seller_no_show", `a never-got-it refund after the handover succeeds (${short(rb)})`);
const dbb = await debts(b?.id);
ok(oneLabelDebt(dbb), `never got it after the handover: ONE ship_label debt (${short(dbb)})`);
await settle();

// 3. Buyer-side after the handover: admin buyer-fault (the buyer keeps no shipping) and a return the seller agreed to
//    (refund_request_full) book no seller label debt.
const c = await shipped(73, BUYER, 1800);
ok((await handOver(c)) === "handed_over", "set-up: order 73 is handed over");
const rc = await after(c?.id, "admin_buyer_fault");
ok(!rc?.error && (await debts(c?.id)).length === 0, `an admin buyer-fault refund after the handover books no seller debt (${short(rc)})`);
const c2 = await shipped(74, BUYER2, 1700);
ok((await handOver(c2)) === "handed_over", "set-up: order 74 is handed over");
const rc2 = await after(c2?.id, "refund_request_full");
ok(!rc2?.error && (await debts(c2?.id)).length === 0, `an agreed full refund after the handover books no seller debt (${short(rc2)})`);

// 4. Before the handover (delivered under 24 h ago, reported in the window): a not-as-described close is the seller's.
const d = await shipped(75, BUYER, 1600, { hoursAgo: 2 });
const rd = await close(d?.id, "not_as_described");
ok(!rd?.error && (await refundReason(d?.id)) === "not_as_described", `a not-as-described close inside the window succeeds (${short(rd)})`);
const dd = await debts(d?.id);
ok(oneLabelDebt(dd), `not as described before the handover: ONE ship_label debt (${short(dd)})`);
await settle();

// 5. The seller backs out with a TEST label not yet scanned: it is sent to be voided (no debt yet); a rejected void is
//    ONE ship_void_rejected debt, never also a ship_label one.
const e = await shipped(76, BUYER2, 1400, { scan: null });
const re = await close(e?.id, "seller_backed_out");
ok(!re?.error, `a seller-backed-out close succeeds (${short(re)})`);
ok((await q(`SELECT label_state FROM public.shipments WHERE declutter_order_id = '${e?.id}'`))?.label_state === "void_requested",
  "the unscanned test label is sent to be voided");
ok((await debts(e?.id)).length === 0, "no debt while the void is pending");
await svc(`UPDATE public.shipments SET label_state = 'void_rejected' WHERE declutter_order_id = '${e?.id}'`);
const de = await debts(e?.id);
ok(oneLabelDebt(de, "ship_void_rejected"), `a rejected void is ONE ship_void_rejected debt (${short(de)})`);
await settle();

// 6. A replayed refund row write never bills twice.
const n0 = (await q(`SELECT count(*)::int AS n FROM public.declutter_seller_fee_debts`))?.n;
const rep = await svc(`SELECT public.declutter_record_refund('${a?.id}', 'pi_sfl_71', 'not_as_described', ${a?.total_cents}, 40)`);
const n1 = (await q(`SELECT count(*)::int AS n FROM public.declutter_seller_fee_debts`))?.n;
ok(n0 === n1, `a replayed refund books nothing more (${short([n0, n1, rep])})`);

// 7. LAST (the seller stays out): an admin no-fault refund after the handover while the seller can no longer sell is
//    recorded as seller_out (Q1928 gap 3); the spent label is still the seller's (decision 6).
const f = await shipped(77, BUYER, 2100);
ok((await handOver(f)) === "handed_over", "set-up: order 77 is handed over");
await svc(`INSERT INTO public.declutter_seller_flags (user_id, business_like) VALUES ('${SELLER2}', true)
  ON CONFLICT (user_id) DO UPDATE SET business_like = true`);
const rf = await after(f?.id, "admin_no_fault");
ok(!rf?.error && (await refundReason(f?.id)) === "seller_out", `set-up: the refund is recorded as seller_out (${short(rf)})`);
const df = await debts(f?.id);
ok(oneLabelDebt(df), `admin no-fault while the seller is out, after the handover: ONE ship_label debt (${short(df)})`);
await settle();
// 7a. Before the handover, same seller: a rejected void after a seller_out close is the seller's too.
await svc(`DELETE FROM public.declutter_seller_flags WHERE user_id = '${SELLER2}'`);
const g = await shipped(78, BUYER2, 1300, { scan: null });
await svc(`INSERT INTO public.declutter_seller_flags (user_id, business_like) VALUES ('${SELLER2}', true)
  ON CONFLICT (user_id) DO UPDATE SET business_like = true`);
const rg = await close(g?.id, "admin_no_fault");
ok(!rg?.error && (await refundReason(g?.id)) === "seller_out", `set-up: the close is recorded as seller_out (${short(rg)})`);
ok((await q(`SELECT label_state FROM public.shipments WHERE declutter_order_id = '${g?.id}'`))?.label_state === "void_requested",
  "the unscanned test label is sent to be voided");
await svc(`UPDATE public.shipments SET label_state = 'void_rejected' WHERE declutter_order_id = '${g?.id}'`);
const dg = await debts(g?.id);
ok(oneLabelDebt(dg, "ship_void_rejected"), `a rejected void after a seller_out close is ONE seller debt (${short(dg)})`);

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

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
if (fail) process.exit(1);

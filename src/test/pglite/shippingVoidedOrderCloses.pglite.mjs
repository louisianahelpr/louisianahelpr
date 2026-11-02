#!/usr/bin/env node
/**
 * PGlite proof for 20261102030530_shipping_voided_order_closes (Q2259 S6; B131 handoff step 2; B134): a shipped order
 * whose card hold was lost after its label was bought, and whose label was then voided, closes like a label never
 * bought (expired / not_payable, hold 'released', lines removed, items back live, a claimed setup fee given back, both
 * sides told in words that fit: the payment did not go through, the label was cancelled, don't ship it). A label still
 * 'bought' or 'void_requested' refuses ('label_bought'); a 'captured' order is refused ('not_held') even with a voided
 * label; void_rejected closes too; the old failed-label close keeps its words; replay 'already'; service role only
 * (with Supabase's default anon/authenticated execute grant emulated). Applied 3x.
 *
 *   node src/test/pglite/shippingVoidedOrderCloses.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingVoidedOrderCloses.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                       # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102030530_shipping_voided_order_closes.sql";
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

// Emulate Supabase's default: every public function is executable by anon and authenticated unless revoked.
await run(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated`);
if (!skip) {
  const r = await run(readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8"));
  ok(!r?.error, `the migration applies again after the default grant${r?.error ? `: ${r.error}` : ""}`);
}
const acl = await q(`SELECT has_function_privilege('authenticated', 'public.declutter_ship_hold_released(uuid)', 'EXECUTE') AS auth,
  has_function_privilege('anon', 'public.declutter_ship_hold_released(uuid)', 'EXECUTE') AS anon,
  has_function_privilege('service_role', 'public.declutter_ship_hold_released(uuid)', 'EXECUTE') AS svc`);
ok(acl?.auth === false && acl?.anon === false && acl?.svc === true, `service role only (${short(acl)})`);

const heldOrder = async (n, buyer, price) => {
  await svc(`UPDATE public.profiles SET onboarding_fee_paid = false, onboarding_fee_charged_at = NULL WHERE user_id = '${buyer}'`);
  const line = await hold(n, buyer, price);
  const qid = await quote(buyer, [line], 700);
  await checkout(buyer, "ship", qid);
  const o = await openOrder(buyer);
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_v${n}', ${(o?.total_cents ?? 0) + (o?.setup_fee_cents ?? 0)}, now(), 40)`);
  // The label was bought (the worker records it before the capture).
  await svc(`UPDATE public.shipments SET label_state = 'bought', label_cost_cents = 700, tracking_code = 'T${n}', label_path = 'x',
    tracking_status = 'pre_transit' WHERE declutter_order_id = '${o?.id}'`);
  return { o, line };
};
const setLabel = (id, st) => svc(`UPDATE public.shipments SET label_state = '${st}' WHERE declutter_order_id = '${id}'`);
const order = (id) => q(`SELECT o.status, o.close_reason, o.ship_capture, o.setup_fee_state, s.label_state FROM public.declutter_orders o
  JOIN public.shipments s ON s.declutter_order_id = o.id WHERE o.id = '${id}'`);
const notes = async () => Number(one(await svc(`SELECT count(*) FROM public.notifications`)));
const lastTwo = async () => (await svc(`SELECT user_id, title, message FROM public.notifications ORDER BY created_at DESC, id DESC LIMIT 2`)) ?? [];

// A. The hold was lost after the label was bought: the label is still 'bought', then 'void_requested'. Refused both
//    times, nothing changes: the void pass calls again once EasyPost answers.
const a = await heldOrder(21, BUYER, 2000);
const a0 = await order(a.o?.id);
ok(a0?.status === "paid" && a0.ship_capture === "held" && a0.label_state === "bought" && a0.setup_fee_state === "claimed",
  `set-up: a paid, held ship order with a bought label and a claimed $2 setup fee (${short(a0)})`);
ok(await call("declutter_ship_hold_released", a.o?.id) === "label_bought", "a bought label: refused");
await setLabel(a.o?.id, "void_requested");
const n0 = await notes();
const ra = await call("declutter_ship_hold_released", a.o?.id);
const a1 = await order(a.o?.id);
ok(ra === "label_bought" && a1?.status === "paid" && a1.ship_capture === "held" && (await notes()) === n0,
  `a void still waiting on EasyPost: refused, order untouched, nobody told (${short(ra)} ${short(a1)})`);

// B. The void came back 'voided': the order closes cleanly and the hold is released.
await setLabel(a.o?.id, "voided");
const rb = await call("declutter_ship_hold_released", a.o?.id);
const b1 = await order(a.o?.id);
ok(rb === "closed", `a voided label: the order closes (${short(rb)})`);
ok(b1?.status === "expired" && b1.close_reason === "not_payable" && b1.ship_capture === "released" && b1.label_state === "voided",
  `  expired / not_payable, hold released, the label stays voided (${short(b1)})`);
ok(b1?.setup_fee_state === "not_charged", `  the setup fee is 'not_charged' (${short(b1)})`);
const prof = await q(`SELECT onboarding_fee_paid FROM public.profiles WHERE user_id = '${BUYER}'`);
ok(prof?.onboarding_fee_paid === false, `  the account owes the fee again: it was never charged (${short(prof)})`);
const line = await q(`SELECT c.status AS line, i.status AS item FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id WHERE c.id = '${a.line}'`);
ok(line?.line === "removed" && line.item === "live", `  the line is removed and the item back on sale (${short(line)})`);
const refunds = await q(`SELECT count(*)::int AS n FROM public.declutter_refunds WHERE order_id = '${a.o?.id}'`);
ok(refunds?.n === 0, `  no refund row (nothing was taken) (${short(refunds)})`);
const n1 = await notes();
const w = await lastTwo();
ok(n1 - n0 === 2, `  both sides are told (${n0} -> ${n1})`);
ok(w.some((x) => x.user_id === BUYER && /couldn't be completed/.test(x.message) && /You pay nothing/.test(x.message) && !/shipping label/.test(x.message))
  && w.some((x) => x.user_id === SELLER2 && /didn't go through/.test(x.message) && /label was cancelled/.test(x.message) && /Don't ship it/.test(x.message)),
  `  the words fit a voided label: the payment didn't go through, don't ship it (${short(w)})`);
const rb2 = await call("declutter_ship_hold_released", a.o?.id);
ok(rb2 === "already" && (await notes()) === n1, `a replay answers 'already' and tells nobody twice (${short(rb2)})`);

// C. void_rejected (spent postage; ops was paged by the void pass) closes the same way.
const c = await heldOrder(22, BUYER2, 1500);
await setLabel(c.o?.id, "void_requested");
await setLabel(c.o?.id, "void_rejected");
const rc = await call("declutter_ship_hold_released", c.o?.id);
const c1 = await order(c.o?.id);
ok(rc === "closed" && c1?.status === "expired" && c1.ship_capture === "released" && c1.label_state === "void_rejected",
  `a void_rejected label: the order closes too (${short(rc)} ${short(c1)})`);

// D. A captured order is never closed as "no charge", whatever its label.
const d = await heldOrder(23, BUYER, 1700);
await svc(`UPDATE public.declutter_orders SET ship_capture = 'captured' WHERE id = '${d.o?.id}'`);
await setLabel(d.o?.id, "void_requested");
await setLabel(d.o?.id, "voided");
const rd = await call("declutter_ship_hold_released", d.o?.id);
const d1 = await order(d.o?.id);
ok(rd === "not_held" && d1?.status === "paid" && d1.ship_capture === "captured", `a captured order with a voided label: refused, untouched (${short(rd)} ${short(d1)})`);

// E. The old path (no label bought: the claim is still claimed) still closes with its own words.
const f = await (async () => {
  await svc(`UPDATE public.profiles SET onboarding_fee_paid = false WHERE user_id = '${BUYER3}'`);
  await run(`INSERT INTO public.test_accounts (user_id) VALUES ('${BUYER3}') ON CONFLICT DO NOTHING`);
  const ln = await hold(25, BUYER3, 1100);
  const qid = await quote(BUYER3, [ln], 700);
  await checkout(BUYER3, "ship", qid);
  const o = await openOrder(BUYER3);
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_v25', ${(o?.total_cents ?? 0) + (o?.setup_fee_cents ?? 0)}, now(), 40)`);
  return o;
})();
const nf = await notes();
const rf = await call("declutter_ship_hold_released", f?.id);
const wf = await lastTwo();
ok(rf === "closed" && (await notes()) - nf === 2 && wf.some((x) => x.user_id === BUYER3 && /couldn't make the shipping label/.test(x.message)),
  `a label never bought still closes with "we couldn't make the shipping label" (${short(rf)} ${short(wf)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

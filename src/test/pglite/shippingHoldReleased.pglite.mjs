#!/usr/bin/env node
/**
 * PGlite proof for 20261101220810_shipping_hold_released (Q2259 S3 follow-up; B113 gaps 1 and 2):
 *   1. A released hold closes the order: expired / not_payable, hold 'released', claim 'failed', lines 'removed', items
 *      back 'live', a claimed setup fee given back to the account (never charged) and 'not_charged'; both sides told;
 *      a replay answers 'already' and changes nothing; a bought label refuses; signed-in members cannot call it.
 *   2. The capture amount: a 'refund_due' setup fee is not captured (total only, state 'not_charged', same answer on a
 *      retry); a 'claimed' fee is captured with the total.
 *
 *   node src/test/pglite/shippingHoldReleased.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingHoldReleased.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                  # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261101220810_shipping_hold_released.sql";
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

const acl = one(await svc(`SELECT NOT has_function_privilege('authenticated', 'public.declutter_ship_hold_released(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_ship_hold_released(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.declutter_ship_hold_released(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.declutter_ship_setup_fee_at_capture(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_ship_setup_fee_at_capture(uuid)', 'EXECUTE')`));
ok(acl === true, `both functions are service-role only (got ${short(acl)})`);

const heldOrder = async (n, buyer, price, feePaidFirst) => {
  await svc(`UPDATE public.profiles SET onboarding_fee_paid = false, onboarding_fee_charged_at = NULL WHERE user_id = '${buyer}'`);
  const line = await hold(n, buyer, price);
  const qid = await quote(buyer, [line], 700);
  await checkout(buyer, "ship", qid);
  const o = await openOrder(buyer);
  if (feePaidFirst) await svc(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${buyer}'`);
  const paid = await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_h${n}', ${(o?.total_cents ?? 0) + (o?.setup_fee_cents ?? 0)}, now(), 40)`);
  return { o, paid, line };
};

// 1. A released hold closes the order.
const a = await heldOrder(11, BUYER, 2000, false);
const a0 = await q(`SELECT status, ship_capture, setup_fee_cents, setup_fee_state FROM public.declutter_orders WHERE id = '${a.o?.id}'`);
ok(a0?.status === "paid" && a0.ship_capture === "held" && a0.setup_fee_cents === 200 && a0.setup_fee_state === "claimed",
  `set-up: a held ship order that claimed the $2 setup fee (${short(a0)})`);
const notesBefore = one(await svc(`SELECT count(*) FROM public.notifications`));
await svc(`UPDATE public.shipments SET label_state = 'failed', last_error = 'rate_gone' WHERE declutter_order_id = '${a.o?.id}'`);
await svc(`UPDATE public.declutter_orders SET ship_capture = 'released' WHERE id = '${a.o?.id}'`);
const r1 = await call("declutter_ship_hold_released", a.o?.id);
ok(r1 === "closed", `the worker's release closes it (${short(r1)})`);
const a1 = await q(`SELECT status, close_reason, closed_at IS NOT NULL AS closed, ship_capture, setup_fee_state FROM public.declutter_orders WHERE id = '${a.o?.id}'`);
ok(a1?.status === "expired" && a1.close_reason === "not_payable" && a1.closed && a1.ship_capture === "released",
  `  the order is closed, not left 'paid' (${short(a1)})`);
ok(a1?.setup_fee_state === "not_charged", `  its setup fee is 'not_charged' (${short(a1)})`);
const prof = await q(`SELECT onboarding_fee_paid FROM public.profiles WHERE user_id = '${BUYER}'`);
ok(prof?.onboarding_fee_paid === false, `  the account owes the fee again: it was never charged (${short(prof)})`);
const line1 = await q(`SELECT c.status AS line, i.status AS item FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id WHERE c.id = '${a.line}'`);
ok(line1?.line === "removed" && line1.item === "live", `  the line is removed and the item back on sale (${short(line1)})`);
const notesAfter = one(await svc(`SELECT count(*) FROM public.notifications`));
ok(Number(notesAfter) - Number(notesBefore) === 2, `  buyer and seller are both told (${notesBefore} -> ${notesAfter})`);
const words = await svc(`SELECT user_id, message FROM public.notifications ORDER BY created_at DESC, id DESC LIMIT 2`);
ok((words ?? []).some((w) => w.user_id === BUYER && /You pay nothing/.test(w.message)) && (words ?? []).some((w) => w.user_id === SELLER2 && /Don't ship it/.test(w.message)),
  `  the buyer reads "You pay nothing", the seller "Don't ship it" (${short(words)})`);
const r1b = await call("declutter_ship_hold_released", a.o?.id);
ok(r1b === "already" && one(await svc(`SELECT count(*) FROM public.notifications`)) == notesAfter, `a replay answers 'already' and tells nobody twice (${short(r1b)})`);

// Still 'held' (the webhook path): the function releases it itself and fails the claim.
const b = await heldOrder(12, BUYER2, 1800, false);
const r2 = await call("declutter_ship_hold_released", b.o?.id);
const b1 = await q(`SELECT o.status, o.ship_capture, s.label_state FROM public.declutter_orders o JOIN public.shipments s ON s.declutter_order_id = o.id WHERE o.id = '${b.o?.id}'`);
ok(r2 === "closed" && b1?.status === "expired" && b1.ship_capture === "released" && b1.label_state === "failed",
  `a still-held order: hold released, claim failed, order closed (${short(r2)} ${short(b1)})`);

// A bought label refuses.
const c = await heldOrder(13, BUYER, 1600, false);
await svc(`UPDATE public.shipments SET label_state = 'bought', label_cost_cents = 700, tracking_code = 'T1', label_path = 'x' WHERE declutter_order_id = '${c.o?.id}'`);
const r3 = await call("declutter_ship_hold_released", c.o?.id);
const c1 = await q(`SELECT status, ship_capture FROM public.declutter_orders WHERE id = '${c.o?.id}'`);
ok(r3 === "label_bought" && c1?.status === "paid" && c1.ship_capture === "held", `a bought label: refused, order untouched (${short(r3)} ${short(c1)})`);

// 2. The capture amount.
const cl = await call("declutter_ship_setup_fee_at_capture", c.o?.id);
ok(cl === (c.o?.total_cents ?? -1) + 200, `a claimed fee is captured with the total (${cl} vs ${c.o?.total_cents} + 200)`);
const d = await heldOrder(14, BUYER2, 1400, true);
const d0 = await q(`SELECT setup_fee_state, total_cents, setup_fee_cents FROM public.declutter_orders WHERE id = '${d.o?.id}'`);
ok(d0?.setup_fee_state === "refund_due" && d0.setup_fee_cents === 200, `set-up: a held order whose fee was paid elsewhere first (${short(d0)})`);
const dc = await call("declutter_ship_setup_fee_at_capture", d.o?.id);
const d1 = await q(`SELECT setup_fee_state FROM public.declutter_orders WHERE id = '${d.o?.id}'`);
ok(dc === d0?.total_cents && d1?.setup_fee_state === "not_charged", `a refund_due fee is not captured: total only, 'not_charged' (${dc}, ${short(d1)})`);
const dc2 = await call("declutter_ship_setup_fee_at_capture", d.o?.id);
ok(dc2 === dc, `a retry asks the same amount (${dc2})`);
const notHeld = await svc(`SELECT public.declutter_ship_setup_fee_at_capture('${a.o?.id}')`);
ok(refused(notHeld, /ship_not_held/), `a closed order: refused (${short(notHeld)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

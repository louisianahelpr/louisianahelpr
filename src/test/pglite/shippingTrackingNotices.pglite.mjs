#!/usr/bin/env node
/**
 * PGlite proof for 20261103201840_shipping_tracking_notices (Q2259; spec 4.2): a tracking change on a shipped order's
 * shipment sends the buyer and the seller one notice each: shipped (first acceptance scan), delivered, a problem
 * scan; "waiting for pickup" to the buyer only. Each notice once (a repeat write of the same status sends nothing),
 * the item is named, the kind is declutter_pickups, a UPS label says UPS, and a write that changes neither column
 * sends nothing. The trigger function is not callable by members.
 *
 *   node src/test/pglite/shippingTrackingNotices.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingTrackingNotices.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                       # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261103201840_shipping_tracking_notices.sql";
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
  "20261028191646_declutter_notices_name_the_item.sql",
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
// The prod declutter_notify: a wrapper over declutter_notify_strict (which names the item), not the harness stub. Its
// newest definition is read from 20261102113853 (that file needs tables this world does not build, so only it runs).
{
  const src = readFileSync(`${MIG_DIR}20261102113853_declutter_notices_retire_when_their_subject_moves_on.sql`, "utf8");
  const at = src.indexOf("CREATE OR REPLACE FUNCTION public.declutter_notify(");
  const end = src.indexOf("$fn$;", src.indexOf("AS $fn$", at)) + 5;
  const r = at >= 0 ? await run(src.slice(at, end)) : { error: "declutter_notify not found" };
  ok(!r?.error, `the prod declutter_notify wrapper applies${r?.error ? `: ${r.error}` : ""}`);
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

const acl = one(await svc(`SELECT to_regprocedure('public.declutter_ship_tracking_notices()') IS NOT NULL
  AND NOT has_function_privilege('authenticated', 'public.declutter_ship_tracking_notices()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_ship_tracking_notices()', 'EXECUTE')`));
ok(acl === true, `the trigger function exists and members cannot call it (got ${short(acl)})`);

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

const notes = async (orderId) => (await svc(`SELECT n.user_id, n.type, n.title, n.message FROM public.notifications n
  JOIN public.declutter_orders o ON o.id = '${orderId}' AND n.user_id IN (o.buyer_id, o.seller_id)
  WHERE n.title IN ('Your item shipped', 'USPS has your package', 'UPS has your package', 'Your item was delivered',
    'Your package was delivered', 'Delivery problem', 'Your item is waiting for pickup')
  ORDER BY n.created_at, n.title`)) ?? [];
const ship = async (oid, set) => {
  const r = await svc(`UPDATE public.shipments SET ${set} WHERE declutter_order_id = '${oid}'`);
  if (r?.error) ok(false, `shipment write ${set}: ${r.error}`);
};
const has = (rows, user, title) => rows.filter((r) => r.user_id === user && r.title === title);

// 1. Shipped, then delivered, on one order.
const a = await shipped(31, BUYER, 2000, { scan: null });
await svc(`DELETE FROM public.notifications`);
await ship(a.id, `tracking_status = 'pre_transit'`);
ok((await notes(a.id)).length === 0, "a pre-transit scan (label printed, not handed over) sends nothing");
await ship(a.id, `tracking_status = 'in_transit', accepted_at = now()`);
let n = await notes(a.id);
ok(has(n, BUYER, "Your item shipped").length === 1, `the buyer hears it shipped (${short(n)})`);
ok(has(n, SELLER2, "USPS has your package").length === 1, "the seller hears USPS has it");
ok(n.every((r) => r.type === "declutter_pickups"), "both are declutter_pickups notices");
ok(n.length === 2 && n.every((r) => r.message.includes("Ship item 31")), `both notices name the item (${short(n.map((r) => r.message))})`);
await ship(a.id, `tracking_status = 'out_for_delivery'`);
ok((await notes(a.id)).length === 2, "out for delivery sends nothing more (the acceptance notice is sent once)");
await ship(a.id, `tracking_status = 'delivered', delivered_at = now()`);
n = await notes(a.id);
ok(has(n, BUYER, "Your item was delivered").length === 1, "the buyer hears it was delivered");
ok(has(n, BUYER, "Your item was delivered")[0]?.message.includes("within 2 days"), "the delivered notice says the 2-day window");
ok(has(n, SELLER2, "Your package was delivered").length === 1, "the seller hears it was delivered");
await ship(a.id, `label_path = 'labels/31b.pdf'`);
await ship(a.id, `tracking_status = 'delivered'`);
ok((await notes(a.id)).length === 4, `a write that changes neither status nor acceptance sends nothing (${(await notes(a.id)).length})`);

await svc(`DELETE FROM public.notifications`);
// 2. First scan is already delivered: the delivered notice only, not also "shipped".
const b = await shipped(32, BUYER2, 1500, { scan: null });
await ship(b.id, `tracking_status = 'delivered', accepted_at = now(), delivered_at = now()`);
n = await notes(b.id);
ok(n.length === 2 && has(n, BUYER2, "Your item was delivered").length === 1 && has(n, BUYER2, "Your item shipped").length === 0,
  `a first scan that is delivered sends the delivered pair only (${short(n.map((r) => r.title))})`);

await svc(`DELETE FROM public.notifications`);
// 3. Problems.
const c = await shipped(33, BUYER, 1400, { scan: null });
await ship(c.id, `tracking_status = 'return_to_sender', accepted_at = now()`);
n = await notes(c.id);
ok(has(n, BUYER, "Delivery problem").length === 1 && has(n, SELLER2, "Delivery problem").length === 1,
  `return to sender tells both (${short(n.map((r) => r.title))})`);
ok(has(n, BUYER, "Your item shipped").length === 0, "the problem replaces the shipped notice");
ok(has(n, SELLER2, "Delivery problem")[0]?.message.includes("back to you"), "the seller's says it is coming back to them");
await ship(c.id, `tracking_status = 'failure'`);
ok(has(await notes(c.id), BUYER, "Delivery problem").length === 2, "a new problem scan is a new notice");
await svc(`DELETE FROM public.notifications`);
const d = await shipped(34, BUYER2, 1300, { scan: null });
await ship(d.id, `tracking_status = 'available_for_pickup', accepted_at = now()`);
n = await notes(d.id);
ok(n.length === 1 && has(n, BUYER2, "Your item is waiting for pickup").length === 1, `waiting for pickup tells the buyer only (${short(n)})`);

await svc(`DELETE FROM public.notifications`);
// 4. UPS label.
const e = await shipped(35, BUYER, 1200, { scan: null });
// The guard trigger freezes a bought label's service; this world sets it as if the UPS rate had been bought.
const ups = await svc(`ALTER TABLE public.shipments DISABLE TRIGGER trg_shipments_guard_update`);
await ship(e.id, `service = 'ups_ground'`);
await svc(`ALTER TABLE public.shipments ENABLE TRIGGER trg_shipments_guard_update`);
ok(!ups?.error, `the world gives the label UPS Ground (${short(ups)})`);
await ship(e.id, `tracking_status = 'in_transit', accepted_at = now()`);
n = await notes(e.id);
ok(has(n, SELLER2, "UPS has your package").length === 1 && n.every((r) => !r.message.includes("USPS")), `a UPS label says UPS (${short(n)})`);

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
if (fail) process.exit(1);

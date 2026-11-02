#!/usr/bin/env node
/**
 * PGlite proof for 20261102025148_shipping_buyer_tracking (Q2259, B134): the BUYER of a shipped order reads its
 * tracking number, carrier status, Ship-by deadline and packed time through declutter_my_ship_tracking; the seller,
 * another member, no order and anon get the same refusal; nothing before the hold is captured or after a void; never
 * the label file, cost or address; an ordinary account (switch testers) is refused; anon cannot call (with Supabase's
 * default execute grant emulated). Applied 3x. World: the seller-label proof's (shippingSellerLabel.pglite.mjs).
 *
 *   node src/test/pglite/shippingBuyerTracking.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingBuyerTracking.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                   # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102025148_shipping_buyer_tracking.sql";
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
// Emulate Supabase's default: every new public function is executable by anon and authenticated unless revoked.
await run(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated`);
if (!skip) {
  const r = await run(readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8"));
  ok(!r?.error, `the migration applies again after the default grant${r?.error ? `: ${r.error}` : ""}`);
}
const grants = await q(`SELECT
  has_function_privilege('anon', 'public.declutter_my_ship_tracking(uuid)', 'EXECUTE') AS anon_t,
  has_function_privilege('authenticated', 'public.declutter_my_ship_tracking(uuid)', 'EXECUTE') AS auth_t,
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.declutter_my_ship_tracking(uuid)'::regprocedure) AS definer`);
ok(grants?.anon_t === false && grants?.auth_t === true && grants?.definer === true,
  `anon cannot call it; members can; security definer (${short(grants)})`);

const shipped = async (n, buyer, price, capture) => {
  await svc(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${buyer}'`);
  const line = await hold(n, buyer, price);
  const qid = await quote(buyer, [line], 700);
  await checkout(buyer, "ship", qid);
  const o = await openOrder(buyer);
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_lab_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
  await svc(`UPDATE public.shipments SET label_state = 'bought', label_cost_cents = 700, tracking_code = 'T${n}',
    label_path = 'https://easypost-files.test/${n}.pdf', tracking_status = 'pre_transit' WHERE declutter_order_id = '${o?.id}'`);
  await svc(`UPDATE public.declutter_orders SET ship_capture = '${capture}' WHERE id = '${o?.id}'`);
  return o;
};
const track = async (uid, id) => { const r = await me(uid, `SELECT public.declutter_my_ship_tracking('${id}') AS r`); return Array.isArray(r) ? r[0]?.r : r; };

const cap = await shipped(41, BUYER, 2000, "captured");
const held = await shipped(42, BUYER2, 1500, "held");
ok(!!cap?.id && !!held?.id, `two paid ship orders (${short(cap)} ${short(held)})`);
await svc(`UPDATE public.shipments SET packed_at = now() - interval '2 hours', accepted_at = now() - interval '1 hour',
  tracking_status = 'in_transit' WHERE declutter_order_id = '${cap?.id}'`);

const mine = await track(BUYER, cap?.id);
ok(mine?.tracking_code === "T41" && mine?.tracking_status === "in_transit" && typeof mine?.ship_by === "string"
  && mine?.ready === true && !!mine?.packed_at && !!mine?.accepted_at && mine?.service === "usps_ground_advantage",
  `the buyer reads the tracking number, status, Ship by, packed and accepted (${short(mine)})`);
ok(!!mine && !("label_url" in mine) && !("label_path" in mine) && !("label_cost_cents" in mine) && !("ship_to" in mine)
  && !JSON.stringify(mine).includes("easypost-files") && !JSON.stringify(mine).includes("Main St"),
  `never the label file, its cost or the address (${short(mine)})`);
const notYet = await track(BUYER2, held?.id);
ok(notYet?.ready === false && notYet?.tracking_code === null && notYet?.ship_by === null && notYet?.tracking_status === null,
  `hold not captured: nothing to track yet (${short(notYet)})`);
const sellerRead = await track(SELLER2, cap?.id);
ok(refused(sellerRead, /order_not_found/), `the seller gets the same not-found (${short(sellerRead)})`);
const strangerRead = await track(BUYER2, cap?.id);
ok(refused(strangerRead, /order_not_found/), `another member: the same not-found (${short(strangerRead)})`);
const noOrder = await track(BUYER, "00000000-0000-4000-8000-000000000000");
ok(refused(noOrder, /order_not_found/), `no such order: the same not-found (${short(noOrder)})`);
const anonRead = await me(null, `SELECT public.declutter_my_ship_tracking('${cap?.id}')`);
ok(refused(anonRead, /permission denied|not_authenticated/), `anon refused (${short(anonRead)})`);

// A voided label: nothing to track.
await svc(`UPDATE public.shipments SET label_state = 'void_requested' WHERE declutter_order_id = '${cap?.id}'`);
const vr = await svc(`UPDATE public.shipments SET label_state = 'voided' WHERE declutter_order_id = '${cap?.id}' RETURNING label_state`);
ok(Array.isArray(vr) && vr[0]?.label_state === 'voided', `the label is voided (${short(vr)})`);
const voided = await track(BUYER, cap?.id);
ok(voided?.ready === false && voided?.tracking_code === null && voided?.packed_at === null, `after a void: nothing to track (${short(voided)})`);

// Switch: an ordinary buyer (not a tester) is refused.
await run(`DELETE FROM public.test_accounts WHERE user_id = '${BUYER}'`);
const ordinary = await track(BUYER, cap?.id);
ok(refused(ordinary, /feature_disabled/), `an ordinary account (switch testers): refused (${short(ordinary)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

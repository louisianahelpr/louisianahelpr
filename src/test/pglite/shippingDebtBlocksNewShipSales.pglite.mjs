#!/usr/bin/env node
/**
 * PGlite proof for 20261102054411_shipping_debt_blocks_new_ship_sales (Q2259 S6 part 2e): while a seller owes a
 * shipping fee debt (remaining_cents > 0), no new order with handover 'ship' can be created for them (handover_not_offered
 * with the "can't ship right now" hint); other ways still check out; once the debt is paid off shipping works again.
 * The trigger function is not callable by members (Supabase's default execute grant emulated).
 *
 *   node src/test/pglite/shippingDebtBlocksNewShipSales.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingDebtBlocksNewShipSales.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                            # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102054411_shipping_debt_blocks_new_ship_sales.sql";
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
const shipCheckout = async (n, buyer, price) => {
  await svc(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${buyer}'`);
  const line = await hold(n, buyer, price);
  const qid = await quote(buyer, [line], 700);
  return checkout(buyer, "ship", qid);
};
const shipOrders = async (buyer) => (await svc(`SELECT count(*)::int AS n FROM public.declutter_orders
  WHERE buyer_id = '${buyer}' AND seller_id = '${SELLER2}' AND handover = 'ship'`))?.[0]?.n ?? -1;

// 1. No debt: a shipped checkout opens an order.
const a = await shipCheckout(61, BUYER, 2000);
ok(!a?.error && (await shipOrders(BUYER)) === 1, `no shipping debt: the shipped checkout opens an order (${short(a)})`);

// 2. The seller owes a spent label: a new shipped checkout is refused, and no order is written.
const debt = one(await svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, source_kind, source_ref, amount_cents, remaining_cents)
  VALUES ('${SELLER2}', 'ship_void_rejected', gen_random_uuid(), 700, 700) RETURNING id`));
ok(typeof debt === "string", `set-up: the seller owes a $7 shipping debt (${short(debt)})`);
const b = await shipCheckout(62, BUYER2, 1500);
ok(b?.error && /handover_not_offered/.test(b.error) && (await shipOrders(BUYER2)) === 0,
  `with a shipping debt open, a new shipped checkout is refused and no order is written (${short(b)})`);
const hint = await svc(`DO $$ BEGIN INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
  delivery_cents, total_cents, shipping_cents) VALUES ('${BUYER3}', '${SELLER2}', 'ship', 1000, 120, 0, 0, 1820, 700); END $$`);
ok(/can't ship right now/.test(JSON.stringify(hint)) || /handover_not_offered/.test(JSON.stringify(hint)),
  `a direct insert of a shipped order is refused too (${short(hint)})`);

// 3. Another way from the same seller still checks out.
const c = await (async () => {
  const line = await hold(63, BUYER2, 1200, null);
  return me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`).then((r) => ({ r, line }));
})();
const pick = await svc(`SELECT count(*)::int AS n FROM public.declutter_orders WHERE buyer_id = '${BUYER2}' AND seller_id = '${SELLER2}' AND handover = 'pickup_home'`);
ok(!c.r?.error && pick?.[0]?.n === 1, `a door pickup from the same seller still opens an order (${short(c.r)})`);

// 4. The debt is paid off: shipping works again.
await svc(`UPDATE public.declutter_seller_fee_debts SET remaining_cents = 0 WHERE id = '${debt}'`);
await run(`INSERT INTO public.test_accounts (user_id) VALUES ('${BUYER3}') ON CONFLICT DO NOTHING`);
const d = await shipCheckout(64, BUYER3, 1100);
ok(!d?.error, `a paid-off shipping debt no longer blocks a shipped checkout (${short(d)})`);

await run(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated`);
if (!skip) {
  const r = await run(readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8"));
  ok(!r?.error, `the migration applies again after Supabase's default execute grant${r?.error ? `: ${r.error}` : ""}`);
}
const g = one(await svc(`SELECT to_regprocedure('public.declutter_ship_debt_blocks_sale()') IS NOT NULL
  AND NOT has_function_privilege('authenticated', 'public.declutter_ship_debt_blocks_sale()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_ship_debt_blocks_sale()', 'EXECUTE')`));
ok(g === true, `the trigger function exists and is not callable by members (${short(g)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

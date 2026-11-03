#!/usr/bin/env node
/**
 * PGlite proof for 20261103214253_shipping_claim_sent_by_hand (owner 11-03: the rest of a claim is sent to the seller by
 * an admin BY HAND, never automatically): the admin lists the claims still due and marks one sent once (audit row, one
 * seller notice); the same ref again answers already_sent; another ref, a settled claim and non-admins are refused.
 *
 *   node src/test/pglite/shippingClaimSentByHand.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingClaimSentByHand.pglite.mjs # RED: without it
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261103214253_shipping_claim_sent_by_hand.sql";
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
  "20261102061022_declutter_card_fee_setup_share.sql",
  "20261103203204_shipping_lost_sweep.sql",
  "20261103210119_shipping_claim_payout_pays_the_order_debt_first.sql",
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

const I = (n) => `5a5a5a5a-0000-0000-0000-${String(n).padStart(12, "0")}`;
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
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_ssh_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
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
const FN = "public.declutter_admin_record_ship_claim(uuid, text, integer, text)";
const acl = one(await svc(`SELECT to_regprocedure('${FN}') IS NOT NULL
  AND NOT has_function_privilege('anon', '${FN}', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.shipping_claim_payouts', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.shipping_claim_payouts', 'SELECT')`));
ok(acl === true, `the function exists, anon cannot call it, members cannot read the claims table (${short(acl)})`);

const res = (r) => (Array.isArray(r) ? r[0]?.r : r);
const claim = (order, ref, cents) => me(ADMIN, `SELECT public.declutter_admin_record_ship_claim('${order}', '${ref}', ${cents}, 'USPS paid the loss claim') AS r`);
const due = (uid) => me(uid, `SELECT * FROM public.declutter_admin_ship_claims_due()`);
const sent = (uid, id, ref) => me(uid, `SELECT public.declutter_admin_mark_ship_claim_sent('${id}', '${ref}') AS r`);

// Two lost orders refunded by the lost sweep; one claim leaves money for the seller, one only pays debts.
const A = await shipped(61, BUYER, 2000, { scan: null });
await svc(`UPDATE public.shipments SET tracking_status = 'in_transit', accepted_at = now() - interval '11 days' WHERE declutter_order_id = '${A?.id}'`);
const B = await shipped(62, BUYER2, 1800, { scan: null });
await svc(`UPDATE public.shipments SET tracking_status = 'in_transit', accepted_at = now() - interval '11 days' WHERE declutter_order_id = '${B?.id}'`);
await svc(`SELECT public.declutter_ship_sweep()`);
const ra = res(await claim(A?.id, "c-a", 1900));
ok(ra?.result === "recorded" && ra.seller_due_cents > 0, `set-up: A's claim leaves money for the seller (${short(ra)})`);
const rb = res(await claim(B?.id, "c-b", 100));
ok(rb?.result === "recorded" && rb.seller_due_cents === 0, `set-up: B's small claim only pays debt (${short(rb)})`);
const idA = (await svc(`SELECT id FROM public.shipping_claim_payouts WHERE claim_ref = 'c-a'`))?.[0]?.id;
const idB = (await svc(`SELECT id FROM public.shipping_claim_payouts WHERE claim_ref = 'c-b'`))?.[0]?.id;

// Who may list or mark.
ok(refused(await due(BUYER3), /admin_only|feature_disabled/), "an ordinary member cannot list claims due");
ok(refused(await due(SELLER2), /admin_only/), "the seller cannot list claims due");
ok(refused(await sent(SELLER2, idA, "tr_1"), /admin_only/), "the seller cannot mark a claim sent");
ok(refused(await sent(null, idA, "tr_1"), /permission denied|admin_only/), "anon cannot mark a claim sent");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter_shipping'`);
ok(refused(await sent(ADMIN, idA, "tr_1"), /feature_disabled/), "with the switch off even an admin is refused");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_shipping'`);

// 1. The admin's list: only A, with the seller and the amount to send.
const list = (await due(ADMIN)) ?? [];
ok(Array.isArray(list) && list.length === 1 && list[0].claim_id === idA && list[0].seller_id === SELLER2 && list[0].seller_due_cents === ra.seller_due_cents,
  `the list holds A only: seller and amount to send by hand (${short(list)})`);

// 2. Mark A sent: once, audited, the seller told; again with the same ref: already_sent; another ref: refused.
await svc(`DELETE FROM public.notifications`);
ok(refused(await sent(ADMIN, idA, ""), /invalid_sent_ref/), "a send with no reference is refused");
const s1 = res(await sent(ADMIN, idA, "tr_hand_1"));
ok(s1?.result === "sent", `A is marked sent (${short(s1)})`);
const rowA = (await svc(`SELECT status, sent_ref, sent_at IS NOT NULL AS has_at FROM public.shipping_claim_payouts WHERE id = '${idA}'`))?.[0];
ok(rowA?.status === "seller_paid" && rowA.sent_ref === "tr_hand_1" && rowA.has_at === true, `the row says seller_paid with the ref (${short(rowA)})`);
const au = (await svc(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action = 'declutter_admin_mark_ship_claim_sent'`))?.[0]?.n;
ok(au === 1, `one audit row (${au})`);
const sn = (await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'Carrier claim money sent'`)) ?? [];
ok(sn.length === 1 && sn[0].message.includes(`$${(ra.seller_due_cents / 100).toFixed(2)}`) && !/fee/i.test(sn[0].message), `the seller is told once, with the amount (${short(sn)})`);
const s2 = res(await sent(ADMIN, idA, "tr_hand_1"));
ok(s2?.result === "already_sent", `the same send again answers already_sent (${short(s2)})`);
ok(refused(await sent(ADMIN, idA, "tr_other"), /claim_already_sent/), "another reference for a sent claim is refused");
ok(((await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE title = 'Carrier claim money sent'`))?.[0]?.n) === 1, "and no second notice");
ok(((await due(ADMIN)) ?? []).length === 0, "the list is empty once sent");

// 3. A claim that only paid debt has nothing to send.
ok(refused(await sent(ADMIN, idB, "tr_b"), /nothing_due/), "a settled claim (nothing due) is refused");

// 4. The table refuses seller_paid without a send time (a claim with money still due, written by hand).
const rb2 = res(await claim(B?.id, "c-b2", 1500));
ok(rb2?.seller_due_cents > 0, `set-up: a second claim on B leaves money due (${short(rb2)})`);
ok(refused(await svc(`UPDATE public.shipping_claim_payouts SET status = 'seller_paid' WHERE claim_ref = 'c-b2'`), /check|violates/),
  "the table cannot hold a sent claim with no send time");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
if (fail) process.exit(1);

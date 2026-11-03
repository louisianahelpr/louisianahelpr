#!/usr/bin/env node
/**
 * PGlite proof for 20261103210119_shipping_claim_payout_pays_the_order_debt_first (Q2259; spec 5.3 review fix 16): a
 * carrier claim payout an admin records on a lost (ship_lost) order pays THAT order's open seller debts first (the
 * card-cost debt of its refund and the spent-label debt of its shipment, oldest first, never another order's), with
 * one deduction row each; the rest is recorded as owed to the seller. Admin only, behind declutter_shipping; the same
 * claim twice writes nothing; a ref reused is refused; claims never exceed the order total; only a refunded ship order.
 *
 *   node src/test/pglite/shippingClaimPayout.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingClaimPayout.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                   # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261103210119_shipping_claim_payout_pays_the_order_debt_first.sql";
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

/** A paid ship order whose label was bought and whose hold is in `capture`, with the scan state given. */
const shipped = async (n, buyer, price, { capture = "captured", scan = "delivered", hoursAgo = 25 } = {}) => {
  await svc(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${buyer}'`);
  const line = await hold(n, buyer, price);
  const qid = await quote(buyer, [line], 700);
  await checkout(buyer, "ship", qid);
  const o = await openOrder(buyer);
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_s6b_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
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

const claim = (uid, order, ref, cents, note = "USPS paid the loss claim") =>
  me(uid, `SELECT public.declutter_admin_record_ship_claim('${order}', '${ref}', ${cents}, '${note}') AS r`);
const res = (r) => (Array.isArray(r) ? r[0]?.r : r);
const orderDebts = async (id) => (await svc(`SELECT x.id, x.source_kind, x.amount_cents, x.remaining_cents FROM public.declutter_seller_fee_debts x
  WHERE x.refund_id IN (SELECT r.id FROM public.declutter_refunds r WHERE r.order_id = '${id}')
     OR x.source_ref IN (SELECT s.id FROM public.shipments s WHERE s.declutter_order_id = '${id}')
  ORDER BY x.created_at, x.id`)) ?? [];
const owed = (rows) => rows.reduce((n, r) => n + r.remaining_cents, 0);
const deductions = async (ref) => (await svc(`SELECT debt_id, deducted_cents FROM public.declutter_fee_debt_deductions
  WHERE payout_ref = 'ship_claim:${ref}'`)) ?? [];
const accept = (id, days) => svc(`UPDATE public.shipments SET tracking_status = 'in_transit', accepted_at = now() - interval '${days} days' WHERE declutter_order_id = '${id}'`);

// Two lost orders for one seller, refunded by the lost sweep; a third still paid.
const A = await shipped(51, BUYER, 2000, { scan: null });
await accept(A?.id, 11);
const B = await shipped(52, BUYER2, 1800, { scan: null });
await accept(B?.id, 11);
const P = await shipped(53, BUYER, 1500, { scan: null });
const sw = res(await svc(`SELECT public.declutter_ship_sweep() AS r`));
ok(sw?.lost_closed === 2, `set-up: the lost sweep refunds the two lost orders (${short(sw)})`);
const dA0 = await orderDebts(A?.id);
const dB0 = await orderDebts(B?.id);
ok(dA0.length === 2 && dA0.some((d) => d.source_kind === "ship_label" && d.amount_cents === 700) && dA0.some((d) => d.source_kind === "refund_card_fee"),
  `set-up: order A owes its card cost and its 700 label (${short(dA0)})`);
// Oldest first, made real: the label debt is a day older than the card-cost debt (in the world both are written in
// one transaction, so their created_at would tie).
ok(!(await svc(`UPDATE public.declutter_seller_fee_debts SET created_at = now() - interval '1 day'
  WHERE source_kind = 'ship_label' AND source_ref IN (SELECT s.id FROM public.shipments s WHERE s.declutter_order_id = '${A?.id}')`))?.error,
  "set-up: A's label debt is the older one");
const owedA = owed(dA0);
ok(owedA > 700 && owed(dB0) > 700, `set-up: both orders have open debt (A ${owedA}, B ${owed(dB0)})`);

// Who may call.
ok(refused(await claim(BUYER3, A?.id, "c-x", 100), /admin_only|feature_disabled/), "an ordinary member is refused");
ok(refused(await claim(SELLER2, A?.id, "c-x", 100), /admin_only/), "the seller (a tester, not an admin) is refused");
ok(refused(await claim(null, A?.id, "c-x", 100), /permission denied|admin_only/), "anon is refused");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter_shipping'`);
ok(refused(await claim(ADMIN, A?.id, "c-x", 100), /feature_disabled/), "with the switch off even an admin is refused");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_shipping'`);
ok(refused(await claim(ADMIN, P?.id, "c-p", 100), /order_not_refunded/), "a ship order still paid (not refunded) is refused");
ok(refused(await claim(ADMIN, A?.id, "c-0", 0), /invalid_amount/), "a $0 claim is refused");
ok(refused(await claim(ADMIN, A?.id, "", 100), /invalid_claim_ref/), "a claim with no ref is refused");
ok(((await svc(`SELECT count(*)::int AS n FROM public.shipping_claim_payouts`))?.[0]?.n ?? -1) === 0, "nothing was recorded by the refused calls");

// 1. A claim smaller than the debt: all of it pays A's debts, oldest first; B untouched.
await svc(`DELETE FROM public.notifications`);
let r = res(await claim(ADMIN, A?.id, "c-1", 500));
ok(r?.result === "recorded" && r.debt_paid_cents === 500 && r.seller_due_cents === 0, `a 500 claim pays 500 of A's debt, nothing left over (${short(r)})`);
let dA = await orderDebts(A?.id);
ok(owed(dA) === owedA - 500, `A owes 500 less (${owed(dA)} of ${owedA})`);
const lab = dA.find((d) => d.source_kind === "ship_label");
const card = dA.find((d) => d.source_kind === "refund_card_fee");
const card0 = dA0.find((d) => d.source_kind === "refund_card_fee");
ok(lab?.remaining_cents === 200 && card?.remaining_cents === card0?.remaining_cents,
  `the OLDER debt (the label) is paid first: 500 of its 700; the newer card-cost debt is untouched (${short(dA)})`);
ok(owed(await orderDebts(B?.id)) === owed(dB0), "B's debts are untouched: a claim pays only its own order");
let ded = await deductions("c-1");
ok(ded.reduce((n, x) => n + x.deducted_cents, 0) === 500 && ded.every((x) => dA0.some((d) => d.id === x.debt_id)),
  `deduction rows add up to 500, all on A's debts (${short(ded)})`);
let row = (await svc(`SELECT status, amount_cents, debt_paid_cents, seller_due_cents, seller_id, recorded_by, is_seed FROM public.shipping_claim_payouts WHERE claim_ref = 'c-1'`))?.[0];
ok(row?.status === "settled" && row.seller_id === SELLER2 && row.recorded_by === ADMIN, `the claim row is settled, names the seller and the admin (${short(row)})`);
const audit = (await svc(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action = 'declutter_admin_record_ship_claim'`))?.[0]?.n;
ok(audit === 1, `one admin_audit_log row (${audit})`);
const sn = (await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'Carrier claim paid'`)) ?? [];
ok(sn.length === 1 && sn[0].message.includes("$5.00") && !/fee/i.test(sn[0].message), `the seller is told in words, the amount named (${short(sn)})`);

// 2. The same claim again: same answer, nothing new. A ref reused for another amount or order: refused.
r = res(await claim(ADMIN, A?.id, "c-1", 500));
ok(r?.result === "already_recorded" && r.debt_paid_cents === 500, `the same claim again answers the same (${short(r)})`);
ok((await deductions("c-1")).length === ded.length && owed(await orderDebts(A?.id)) === owedA - 500, "and writes nothing");
ok(refused(await claim(ADMIN, A?.id, "c-1", 600), /claim_ref_used/), "the same ref with another amount is refused");
ok(refused(await claim(ADMIN, B?.id, "c-1", 500), /claim_ref_used/), "the same ref on another order is refused");

// 3. A claim bigger than what is left: the rest of A's debt first, then the remainder is owed to the seller.
const left = owed(await orderDebts(A?.id));
r = res(await claim(ADMIN, A?.id, "c-2", left + 300));
ok(r?.debt_paid_cents === left && r.seller_due_cents === 300, `a bigger claim pays A's last ${left} and leaves 300 for the seller (${short(r)})`);
ok(owed(await orderDebts(A?.id)) === 0, "A owes nothing now");
ok(owed(await orderDebts(B?.id)) === owed(dB0), "B still owes all of its debt");
row = (await svc(`SELECT status, seller_due_cents FROM public.shipping_claim_payouts WHERE claim_ref = 'c-2'`))?.[0];
ok(row?.status === "seller_due" && row.seller_due_cents === 300, `the claim row says 300 is due to the seller (${short(row)})`);

// 4. Claims never add up to more than the order total.
const tot = (await svc(`SELECT total_cents FROM public.declutter_orders WHERE id = '${A?.id}'`))?.[0]?.total_cents;
const used = 500 + left + 300;
ok(refused(await claim(ADMIN, A?.id, "c-3", tot - used + 1), /claim_too_large/), `a claim past the order total (${tot}) is refused`);
r = res(await claim(ADMIN, A?.id, "c-4", tot - used));
ok(r?.debt_paid_cents === 0 && r.seller_due_cents === tot - used, `up to the total is fine, all to the seller now (${short(r)})`);

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
if (fail) process.exit(1);

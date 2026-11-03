#!/usr/bin/env node
/**
 * PGlite proof for 20261103212046_shipping_return_label (Q2259; spec 5.3 "a return label if the admin wants the item
 * back = seller debt"): an admin asks for the item back on a shipped order refunded as not_as_described whose TEST
 * label was delivered; one request per order (a replay answers already_requested); the worker records the bought
 * return label once, which books ONE seller debt at its cost and tells both sides; a failure pages ops and books
 * nothing; only the order's buyer reads the label. Admin only, behind declutter_shipping; members and anon refused.
 *
 *   node src/test/pglite/shippingReturnLabel.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingReturnLabel.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                  # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261103212046_shipping_return_label.sql";
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
  "20261102054848_shipping_seller_can_ship_read.sql",
  "20261102055653_shipping_admin_no_fault_label_debt.sql",
  "20261102060324_shipping_buyer_fault_after_delivery.sql",
  "20261102061022_declutter_card_fee_setup_share.sql",
  "20261102063343_declutter_seller_out_after_payment.sql",
  "20261102080936_declutter_seller_out_told_once.sql",
  "20261102084222_a3_stack_reconcile.sql",
  "20261102095838_shipping_seller_can_ship_null.sql",
  "20261103203204_shipping_lost_sweep.sql",
  "20261103211330_shipping_seller_fault_label_debt.sql",
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

const I = (n) => `5c5c5c5c-0000-0000-0000-${String(n).padStart(12, "0")}`;
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
  await svc(`SELECT public.declutter_mark_order_paid('${o?.id}', 'pi_srl_${n}', ${o?.total_cents ?? 0}, now(), 40)`);
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
const res = (r) => (Array.isArray(r) ? r[0]?.r : r);
const ask = (uid, order, note = "Buyer sent photos of a cracked lamp; the seller wants it back") =>
  me(uid, `SELECT public.declutter_admin_request_return_label('${order}', '${note}') AS r`);
const bought = (id, cost = 650, shp = "shp_ret_1") => svc(`SELECT public.declutter_ship_return_label_bought('${id}', '${shp}', 'RT${cost}',
  'https://easypost-files.s3.amazonaws.com/files/postage_label/ret.png', ${cost}) AS r`);
const myLabel = (uid, order) => me(uid, `SELECT public.declutter_my_return_label('${order}') AS r`);
const returnDebts = async () => (await svc(`SELECT d.source_kind, d.amount_cents, d.remaining_cents, d.seller_id FROM public.declutter_seller_fee_debts d
  WHERE d.source_ref IN (SELECT r.id FROM public.shipping_return_labels r)`)) ?? [];
const handOver = async (o) => { await svc(`SELECT public.declutter_ship_sweep()`); };
const after = (id, reason) => svc(`SELECT public.declutter_refund_after_handover('${id}', '${reason}', NULL) AS r`);
const settle = () => svc(`UPDATE public.declutter_seller_fee_debts SET remaining_cents = 0 WHERE source_kind LIKE 'ship_%'`);

// The set-up: a delivered, handed-over ship order refunded as not as described (its spent label already booked).
const A = await shipped(81, BUYER, 2000);
await handOver(A);
ok(!(await after(A?.id, "not_as_described"))?.error, "set-up: order 81 is refunded as not as described after the handover");
await settle();
// A delivered order refunded on the buyer's side (admin buyer-fault): no return label.
const B = await shipped(82, BUYER2, 1500);
await handOver(B);
ok(!(await after(B?.id, "admin_buyer_fault"))?.error, "set-up: order 82 is refunded as buyer fault");
// A delivered order still paid (not refunded): no return label.
const P = await shipped(83, BUYER, 1400, { hoursAgo: 2 });

// Who may ask.
ok(refused(await ask(BUYER3, A?.id), /admin_only|feature_disabled/), "an ordinary member is refused");
ok(refused(await ask(SELLER2, A?.id), /admin_only/), "the seller (a tester, not an admin) is refused");
ok(refused(await ask(null, A?.id), /permission denied|admin_only/), "anon is refused");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter_shipping'`);
ok(refused(await ask(ADMIN, A?.id), /feature_disabled/), "with the switch off even an admin is refused");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_shipping'`);
ok(refused(await ask(ADMIN, B?.id), /return_not_allowed/), "a buyer-fault refund gets no return label");
ok(refused(await ask(ADMIN, P?.id), /return_not_allowed/), "an order not refunded gets no return label");
ok(refused(await ask(ADMIN, A?.id, ""), /invalid_note/), "a request with no note is refused");
ok(((await svc(`SELECT count(*)::int AS n FROM public.shipping_return_labels`))?.[0]?.n ?? -1) === 0, "the refused calls wrote nothing");

// 1. The admin asks: one row, test mode, an audit row; asking again writes nothing.
let r = res(await ask(ADMIN, A?.id));
ok(r?.result === "requested" && typeof r.return_id === "string", `the admin's request is recorded (${short(r)})`);
const RID = r?.return_id;
const row = (await svc(`SELECT state, label_mode, order_id FROM public.shipping_return_labels WHERE id = '${RID}'`))?.[0];
ok(row?.state === "requested" && row.label_mode === "test" && row.order_id === A?.id, `one test-mode request on order 81 (${short(row)})`);
const audit = (await svc(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action = 'declutter_admin_request_return_label'`))?.[0]?.n;
ok(audit === 1, `one admin_audit_log row (${audit})`);
r = res(await ask(ADMIN, A?.id));
ok(r?.result === "already_requested" && r.return_id === RID, `asking again answers already_requested (${short(r)})`);
ok(((await svc(`SELECT count(*)::int AS n FROM public.shipping_return_labels`))?.[0]?.n) === 1, "and writes no second row");

// 2. Before the label is bought the buyer sees no label; the seller and an outsider see order_not_found.
let mine = res(await myLabel(BUYER, A?.id));
ok(mine?.state === "requested" && mine.label_url === null, `the buyer sees it is coming, no label yet (${short(mine)})`);
ok(refused(await myLabel(SELLER2, A?.id), /order_not_found/), "the seller cannot read the buyer's return label");
ok(refused(await myLabel(BUYER2, A?.id), /order_not_found/), "another member cannot read it");
ok(refused(await myLabel(null, A?.id), /permission denied|order_not_found/), "anon cannot read it");

// 3. Members cannot record a label or a failure (service role only).
ok(refused(await me(ADMIN, `SELECT public.declutter_ship_return_label_bought('${RID}', 'x', 'x', 'https://x', 1)`), /permission denied/),
  "even an admin cannot record a bought label (worker only)");
ok(refused(await me(BUYER, `SELECT public.declutter_ship_return_label_failed('${RID}', 'x')`), /permission denied/),
  "a member cannot record a failure");

// 4. The worker records the bought label: ONE seller debt at its cost; buyer and seller told; a replay books nothing.
await svc(`DELETE FROM public.notifications`);
const b1 = res(await bought(RID));
ok(b1 === "bought", `the bought label is recorded (${short(b1)})`);
let dr = await returnDebts();
ok(dr.length === 1 && dr[0].source_kind === "ship_label" && dr[0].amount_cents === 650 && dr[0].remaining_cents === 650 && dr[0].seller_id === SELLER2,
  `ONE seller debt of $6.50 for the return label (${short(dr)})`);
const sn = (await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'Return label added to what you owe'`)) ?? [];
ok(sn.length === 1 && sn[0].message.includes("$6.50") && sn[0].message.includes("Ship item 81") && !/fee/i.test(sn[0].message),
  `the seller is told once, the amount named, no fee words (${short(sn)})`);
const bn = (await svc(`SELECT message, link FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Send the item back'`)) ?? [];
ok(bn.length === 1 && /don't pay for it/i.test(bn[0].message), `the buyer is told to send it back, free to them (${short(bn)})`);
const b2 = res(await bought(RID, 900, "shp_ret_2"));
ok(b2 === "already" && (await returnDebts()).length === 1 && (await returnDebts())[0].amount_cents === 650, `a replay answers already and books nothing more (${short(b2)})`);
mine = res(await myLabel(BUYER, A?.id));
ok(mine?.state === "bought" && /^https:\/\//.test(mine.label_url ?? "") && mine.tracking_code === "RT650", `the buyer reads the label and tracking (${short(mine)})`);
const fx = res(await svc(`SELECT public.declutter_ship_return_label_failed('${RID}', 'late') AS r`));
ok(fx === "unchanged", `a bought label cannot be marked failed (${short(fx)})`);
// An open shipping debt (the return label) stops the seller selling with shipping (2e counts ship_label).
const can = res(await me(SELLER2, `SELECT public.declutter_seller_can_ship('${SELLER2}') AS r`));
ok(can === false, `while the return label is owed the seller cannot sell with shipping (${short(can)})`);
await settle();

// 5. A failed buy: ops paged, no debt, the state says failed.
const C = await shipped(84, BUYER2, 1700);
await handOver(C);
ok(!(await after(C?.id, "not_as_described"))?.error, "set-up: order 84 is refunded as not as described");
await settle();
const RC = res(await ask(ADMIN, C?.id))?.return_id;
const f1 = res(await svc(`SELECT public.declutter_ship_return_label_failed('${RC}', 'no rate under the cap') AS r`));
ok(f1 === "failed", `the failure is recorded (${short(f1)})`);
const pg = (await svc(`SELECT msg FROM public.cron_defects_seen WHERE fn = 'declutter_ship_return_label-failed' AND ref = '${C?.id}'`)) ?? [];
ok(pg.length === 1 && /arrange the return by hand/.test(pg[0].msg), `ops is paged (${short(pg)})`);
ok((await returnDebts()).length === 1, "a failed return books no debt");

// 6. A LIVE outbound label is refused (test only until the owner's switch).
const D = await shipped(85, BUYER, 1300);
await handOver(D);
ok(!(await after(D?.id, "not_as_described"))?.error, "set-up: order 85 is refunded as not as described");
await settle();
await run(`SET session_replication_role = replica; UPDATE public.shipments SET label_mode = 'live' WHERE declutter_order_id = '${D?.id}'; SET session_replication_role = origin;`);
ok(refused(await ask(ADMIN, D?.id), /return_label_test_only/), "a live outbound label gets no return label (arranged by hand)");
const live = await svc(`INSERT INTO public.shipping_return_labels (order_id, shipment_id, label_mode, note)
  SELECT '${D?.id}', s.id, 'live', 'x' FROM public.shipments s WHERE s.declutter_order_id = '${D?.id}'`);
ok(refused(live, /check|violates/), "the table cannot hold a live return label at all");

// 7. A parcel never delivered (in transit when refunded on the seller): nothing to send back.
const E = await shipped(86, BUYER2, 1200, { scan: "in_transit" });
await svc(`UPDATE public.shipments SET accepted_at = now() - interval '1 day' WHERE declutter_order_id = '${E?.id}'`);
const ce = await svc(`SELECT public.declutter_close_paid_order('${E?.id}', 'not_as_described', NULL, NULL, 'proof') AS r`);
ok(!ce?.error, `set-up: order 86 is closed as not as described before delivery (${short(ce)})`);
await settle();
ok(refused(await ask(ADMIN, E?.id), /not_delivered/), "a parcel never delivered gets no return label");

// Grants after Supabase's default execute grant.
await run(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated`);
if (!skip) {
  const ra = await run(readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8"));
  ok(!ra?.error, `the migration applies again after Supabase's default execute grant${ra?.error ? `: ${ra.error}` : ""}`);
}
for (const [sig, member] of [["declutter_admin_request_return_label(uuid, text)", true], ["declutter_my_return_label(uuid)", true],
  ["declutter_ship_return_label_bought(uuid, text, text, text, integer)", false], ["declutter_ship_return_label_failed(uuid, text)", false]]) {
  const gr = one(await svc(`SELECT to_regprocedure('public.${sig}') IS NOT NULL
    AND has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE') = ${member}
    AND NOT has_function_privilege('anon', 'public.${sig}', 'EXECUTE')`));
  ok(gr === true, `${sig}: anon never, members ${member ? "may call (it checks who)" : "never"} (${short(gr)})`);
}
const tbl = one(await svc(`SELECT NOT has_table_privilege('authenticated', 'public.shipping_return_labels', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.shipping_return_labels', 'SELECT')`));
ok(tbl === true, `members and anon cannot read the return labels table (${short(tbl)})`);

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
if (fail) process.exit(1);

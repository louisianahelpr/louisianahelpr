#!/usr/bin/env node
/**
 * PGlite proof for 20261103204805_shipping_problem_scans_open_a_problem (Q2259; spec 7): a 'return_to_sender' or
 * 'failure' scan on a paid ship order opens ONE system problem (reporter_side 'system', reason 'not_received', no
 * reporter, is_seed follows the order) and tells every admin unless it is test data. Not on 'available_for_pickup',
 * not twice (a second problem scan, a buyer's own open report), not on an order that is no longer paid. With the
 * problem open every shipping sweep skips the order (their NOT EXISTS open-problem clause is proven in
 * shippingLostSweep.pglite.mjs). The trigger function is not callable by members.
 *
 *   node src/test/pglite/shippingProblemScans.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingProblemScans.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                    # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261103204805_shipping_problem_scans_open_a_problem.sql";
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
  "20261103201840_shipping_tracking_notices.sql",
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
// Prod shape the world lacks: the 'system' reporter side (20261031004529) and is_test_subject (20261030143141; here
// a tester is any test_accounts row, which is what the prod function reads first through is_test_member).
ok(!(await run(`ALTER TABLE public.declutter_problems DROP CONSTRAINT IF EXISTS declutter_problems_reporter_side_check;
  ALTER TABLE public.declutter_problems ADD CONSTRAINT declutter_problems_reporter_side_check
    CHECK (reporter_side = ANY (ARRAY['buyer'::text, 'seller'::text, 'helpr'::text, 'system'::text]));
  CREATE OR REPLACE FUNCTION public.is_test_subject(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id) $f$;`))?.error,
  "the prod reporter sides and is_test_subject are added");
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

const acl = one(await svc(`SELECT to_regprocedure('public.declutter_ship_problem_scan()') IS NOT NULL
  AND NOT has_function_privilege('authenticated', 'public.declutter_ship_problem_scan()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_ship_problem_scan()', 'EXECUTE')`));
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

const ADMIN = USERS.ADMIN;
const problems = async (oid) => (await svc(`SELECT reporter_id, reporter_side, reason, status, note, is_seed
  FROM public.declutter_problems WHERE order_id = '${oid}' ORDER BY created_at`)) ?? [];
const adminNotes = async () => (await svc(`SELECT user_id, message FROM public.notifications
  WHERE user_id = '${ADMIN}' AND title = 'Declutter delivery problem'`)) ?? [];
const ship = async (oid, set) => {
  const r = await svc(`UPDATE public.shipments SET ${set} WHERE declutter_order_id = '${oid}'`);
  ok(!r?.error, `shipment write ${set}${r?.error ? `: ${r.error}` : ""}`);
};

// 1. Return to sender on an ordinary members' order. Checkout is testers-only while the switch is, so the order is
// made by testers and then both sides are taken off the test list for the scan (put back after case 2).
const a = await shipped(41, BUYER2, 2000, { scan: null });
const ta = await run(`CREATE TABLE public.tmp_ta AS SELECT * FROM public.test_accounts WHERE user_id IN ('${BUYER2}', '${SELLER2}');
  DELETE FROM public.test_accounts WHERE user_id IN ('${BUYER2}', '${SELLER2}')`);
ok(!ta?.error, `both sides are ordinary for case 1${ta?.error ? `: ${ta.error}` : ""}`);
await ship(a.id, `tracking_status = 'in_transit', accepted_at = now()`);
ok((await problems(a.id)).length === 0, "an in-transit scan opens no problem");
await svc(`DELETE FROM public.notifications`);
await ship(a.id, `tracking_status = 'return_to_sender'`);
let p = await problems(a.id);
ok(p.length === 1, `return to sender opens one problem (${short(p)})`);
ok(p[0]?.reporter_side === "system" && p[0]?.reporter_id === null && p[0]?.reason === "not_received" && p[0]?.status === "open",
  `it is an open system 'not_received' problem with no reporter (${short(p[0])})`);
ok(p[0]?.note?.includes("back to the seller") && p[0]?.note?.includes("T41"), `its note says what happened and the tracking code (${short(p[0]?.note)})`);
ok(p[0]?.is_seed === false, "a real order's problem is not seed");
let an = await adminNotes();
ok(an.length === 1 && an[0].message.includes("money is held"), `the admin is told (${short(an)})`);
// 2. A second problem scan on the same order: still one open problem, no second admin notice.
await ship(a.id, `tracking_status = 'failure'`);
ok((await problems(a.id)).length === 1, "a second problem scan opens no second problem");
ok((await adminNotes()).length === 1, "and tells the admin nothing more");
{ const r = await run(`INSERT INTO public.test_accounts SELECT * FROM public.tmp_ta; DROP TABLE public.tmp_ta`); ok(!r?.error, `the testers are put back${r?.error ? `: ${r.error}` : ""}`); }

// 3. Failure on an order whose buyer already reported a problem: the buyer's report stands.
const b = await shipped(42, BUYER2, 1500, { scan: null });
await svc(`INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note)
  VALUES ('${b.id}', '${BUYER2}', 'buyer', 'not_received', 'It never came')`);
await ship(b.id, `tracking_status = 'failure', accepted_at = now()`);
p = await problems(b.id);
ok(p.length === 1 && p[0].reporter_side === "buyer", `a buyer's open report stands; no system problem is added (${short(p)})`);

// 4. Failure first, on a fresh order: the failure note.
const c = await shipped(43, BUYER2, 1400, { scan: null });
await ship(c.id, `tracking_status = 'failure', accepted_at = now()`);
p = await problems(c.id);
ok(p.length === 1 && p[0].note.includes("could not deliver"), `a failure scan opens a problem with the failure note (${short(p)})`);

// 5. Waiting for pickup is not a problem.
const d = await shipped(44, BUYER2, 1300, { scan: null });
await ship(d.id, `tracking_status = 'available_for_pickup', accepted_at = now()`);
ok((await problems(d.id)).length === 0, "waiting for pickup opens no problem");

// 6. An order that is no longer paid (refunded) opens none.
const e = await shipped(45, BUYER2, 1200, { scan: null });
await svc(`UPDATE public.declutter_orders SET status = 'refunded' WHERE id = '${e.id}'`);
await ship(e.id, `tracking_status = 'return_to_sender', accepted_at = now()`);
ok((await problems(e.id)).length === 0, "a refunded order opens no problem");

// 7. Test data: the problem opens (marked seed when the order is) but no admin hears of it.
await svc(`DELETE FROM public.notifications`);
const f = await shipped(46, BUYER, 1100, { scan: null }); // BUYER is a tester
await svc(`UPDATE public.declutter_orders SET is_seed = true WHERE id = '${f.id}'`);
await ship(f.id, `tracking_status = 'return_to_sender', accepted_at = now()`);
p = await problems(f.id);
ok(p.length === 1 && p[0].is_seed === true, `a seed order's problem opens and is seed (${short(p)})`);
ok((await adminNotes()).length === 0, "test data never reaches an admin");
// 8. The same status written again (a repeat webhook write) does nothing.
await svc(`DELETE FROM public.declutter_problems WHERE order_id = '${f.id}'`);
await ship(f.id, `tracking_status = 'return_to_sender'`);
ok((await problems(f.id)).length === 0, "a write that does not change the status opens nothing");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
if (fail) process.exit(1);

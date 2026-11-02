#!/usr/bin/env node
/**
 * PGlite proof for 20261102023246_shipping_seller_label (Q2259, B131): the seller reads their own shipped order's
 * label, tracking and Ship-by deadline, and marks it packed; nobody else can; nothing before the hold is captured;
 * an ordinary account (switch testers) is refused; anon cannot call. Applied 3x.
 * Based on the S5 proof's world: 20261102013630_shipping_s5_delivered_payout (Q2259 S5): declutter_ship_sweep finishes a shipped
 * order 24 hours after the USPS delivered scan, through declutter_complete_handover (handed_over + one payout row of
 * the items only, never the shipping), and leaves alone: a scan under 24 hours old, no delivered scan, an open
 * problem, a hold not captured (held or released), a non-ship order. A second run changes nothing. Service role only.
 *
 *   node src/test/pglite/shippingS5DeliveredPayout.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingS5DeliveredPayout.pglite.mjs # RED: without it
 *   MIGRATION_PATH=<planted copy> node ...                                       # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102023246_shipping_seller_label.sql";
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
  has_function_privilege('anon', 'public.declutter_my_ship_label(uuid)', 'EXECUTE') AS anon_label,
  has_function_privilege('anon', 'public.declutter_mark_packed(uuid)', 'EXECUTE') AS anon_packed,
  has_function_privilege('authenticated', 'public.declutter_my_ship_label(uuid)', 'EXECUTE') AS auth_label,
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.declutter_my_ship_label(uuid)'::regprocedure) AS definer`);
ok(grants?.anon_label === false && grants?.anon_packed === false && grants?.auth_label === true && grants?.definer === true,
  `anon cannot call either RPC; members can; security definer (${short(grants)})`);

// Paid on Fri 2026-11-06 3 PM Louisiana time: business days Mon 9, Tue 10, Wed 11 -> Wed 11/11 11:59:59 PM CST.
const sb = await q(`SELECT public.declutter_ship_by('2026-11-06 15:00 America/Chicago'::timestamptz) = '2026-11-11 23:59:59 America/Chicago'::timestamptz AS fri,
  public.declutter_ship_by('2026-11-02 09:00 America/Chicago'::timestamptz) = '2026-11-05 23:59:59 America/Chicago'::timestamptz AS mon,
  public.declutter_ship_by(NULL) IS NULL AS nul`);
ok(sb?.fri === true && sb?.mon === true && sb?.nul === true, `Ship by = end of the 3rd business day (${short(sb)})`);

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
const label = async (uid, id) => { const r = await me(uid, `SELECT public.declutter_my_ship_label('${id}') AS r`); return Array.isArray(r) ? r[0]?.r : r; };
const packed = (uid, id) => me(uid, `SELECT public.declutter_mark_packed('${id}') AS r`);

const cap = await shipped(31, BUYER, 2000, "captured");
const held = await shipped(32, BUYER2, 1500, "held");
ok(!!cap?.id && !!held?.id, `two paid ship orders (${short(cap)} ${short(held)})`);

const mine = await label(SELLER2, cap?.id);
ok(mine?.label_url === "https://easypost-files.test/31.pdf" && mine?.tracking_code === "T31" && typeof mine?.ship_by === "string"
  && mine?.label_state === "bought" && mine?.packed_at === null && !("ship_to" in (mine ?? {})),
  `the seller reads the label, tracking and Ship by, never the address (${short(mine)})`);
const notYet = await label(SELLER2, held?.id);
ok(notYet?.label_url === null && notYet?.tracking_code === null && notYet?.ship_by === null, `hold not captured: no label yet (${short(notYet)})`);
const buyerRead = await label(BUYER, cap?.id);
ok(refused(buyerRead, /order_not_found/), `the buyer cannot read the seller's label view (${short(buyerRead)})`);
const strangerRead = await label(BUYER2, cap?.id);
ok(refused(strangerRead, /order_not_found/), `another member: the same not-found (${short(strangerRead)})`);
const noOrder = await label(SELLER2, "00000000-0000-4000-8000-000000000000");
ok(refused(noOrder, /order_not_found/), `no such order: the same not-found (${short(noOrder)})`);
const anonRead = await me(null, `SELECT public.declutter_my_ship_label('${cap?.id}')`);
ok(refused(anonRead, /permission denied|not_authenticated/), `anon refused (${short(anonRead)})`);

const p1 = await packed(SELLER2, cap?.id);
// Move the first mark an hour back, so a second tap that overwrote it could not look the same.
const firstAt = await q(`UPDATE public.shipments SET packed_at = packed_at - interval '1 hour' WHERE declutter_order_id = '${cap?.id}' RETURNING packed_at`);
const p2 = await packed(SELLER2, cap?.id);
ok(Array.isArray(p1) && Array.isArray(p2) && !!firstAt && String(p2[0]?.r) === String(firstAt.packed_at),
  `Packed is kept the first time (${short(p1)} ${short(firstAt)} ${short(p2)})`);
const after = await label(SELLER2, cap?.id);
ok(after?.packed_at !== null && after?.packed_at !== undefined, `the label view shows it packed (${short(after)})`);
const pHeld = await packed(SELLER2, held?.id);
ok(refused(pHeld, /label_not_ready/), `cannot mark packed before the hold is captured (${short(pHeld)})`);
const pBuyer = await packed(BUYER, cap?.id);
ok(refused(pBuyer, /order_not_found/), `the buyer cannot mark it packed (${short(pBuyer)})`);

// Q281 (train 1 fix, 11-02): Packed is a write, so a banned seller is refused; the label read stays open to them.
await run(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${SELLER2}'`);
const bannedPack = await packed(SELLER2, cap?.id);
ok(refused(bannedPack, /account_restricted/), `a banned seller cannot mark packed (${short(bannedPack)})`);
const bannedRead = await label(SELLER2, cap?.id);
ok(bannedRead?.tracking_code === "T31", `a banned seller still reads the label view (${short(bannedRead)})`);
await run(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${SELLER2}'`);
const unbannedPack = await packed(SELLER2, cap?.id);
ok(Array.isArray(unbannedPack), `once the ban is lifted, Packed works again (${short(unbannedPack)})`);
// The label read is STABLE: it writes nothing, so it leaves the ban gate's write universe (banGateCoverage).
const vol = await q(`SELECT provolatile FROM pg_proc WHERE proname = 'declutter_my_ship_label'`);
ok(vol?.provolatile === "s", `declutter_my_ship_label is STABLE (${short(vol)})`);

// Switch: an ordinary seller (not a tester) is refused.
await run(`DELETE FROM public.test_accounts WHERE user_id = '${SELLER2}'`);
const ordinary = await label(SELLER2, cap?.id);
ok(refused(ordinary, /feature_disabled/), `an ordinary account (switch testers): refused (${short(ordinary)})`);
const ordinaryPack = await packed(SELLER2, cap?.id);
ok(refused(ordinaryPack, /feature_disabled/), `an ordinary account cannot mark packed (${short(ordinaryPack)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

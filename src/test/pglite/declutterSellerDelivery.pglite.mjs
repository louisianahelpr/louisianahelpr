#!/usr/bin/env node
/**
 * PGlite proof for 20261023130254_declutter_seller_delivery (the seller
 * delivers, the buyer picks a date and time; switch declutter_seller_delivery).
 *
 * The world is every migration that defines a function this one restates or
 * relies on, in order (slices 1-5, F1, the refund / bucket / porch / no-code
 * migrations, seller-out-pays-fee, payout-waits-for-payee, shipping S1, manage
 * listing), and BEFORE the new migration the proof checks that each restated
 * or relied-on function's body is byte-identical to PROD's (md5 of prosrc,
 * read from prod 2026-10-21 with pg_proc): the proof runs on prod's bodies.
 * The new migration is then applied 3 times (replay-safe).
 *
 *   node src/test/pglite/declutterSellerDelivery.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerDelivery.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterSellerDelivery.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite. PGlite is
 * one connection, so the slot race is proven as its serial interleavings (the
 * second buyer arriving while the first hold is live, after it lapsed, and a
 * payment landing after its hold went to someone else); the lock that orders
 * real concurrent checkouts (the seller's setting row, FOR UPDATE) is named
 * in the migration and checked by src/test/declutterSellerDelivery.test.ts.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261023130254_declutter_seller_delivery.sql";
const BEFORE = [
  "20261017055500_declutter_refund_hand_settle.sql",
  "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql",
  "20261017055505_declutter_helpr_delivery.sql",
  NO_QR_FILE,
  "20261018184535_declutter_delivery_no_dropoff_code.sql",
  "20261017060455_declutter_seller_out_pays_fee.sql",
  "20261020024605_shipping_s1_data_model.sql",
  "20261020064354_declutter_manage_listing.sql",
];
// Prod's bodies (md5 of pg_proc.prosrc, read-only SQL on fncmgoasalhdgfwzhsqa, 2026-10-21).
const PROD_MD5 = {
  declutter_start_checkout: "8526c31a122737bc03c68aba7ca507c7",
  declutter_complete_handover: "e6290ef72eb49c588602f7fd416cfc6c",
  declutter_handover_sweep: "573991509b75ad4ba10f84fe932a8205",
  declutter_close_paid_order: "646bb92429dd11770fac328eceed1113",
  declutter_record_refund: "d56f27555ac042d768a910d089522309",
  declutter_delivery_reserved_cents: "6383025e1a576c023e51c9334ecacc3c",
  declutter_address_access: "e5d21f8bc3d92f627e5a2fede70d23e3",
  declutter_bookings_not_delivery: "36a800a3e768d57afda4b2fdcec0ceec",
  declutter_orders_fee_rule_f1: "ab8c8664fdd4bf0e01d1551eb565e3e8",
  declutter_orders_fee_rule_frozen: "dff208a3e7f07b12fddbf2d2e5018830",
  declutter_delivery_refund: "977715c2c7da8f5bdbb82b183e00a22c",
  declutter_confirm_handover: "0c4a4abef15ee02d4b367e4cce3ff0f3",
  declutter_consume_fee_debt: "10fff385458cac05b8a02f27871c37f5",
  declutter_lock_order: "da782605b8f7f519f4b99dfe13a11774",
  declutter_retire_order: "fae91bdbf9521d8f91ae06197d87963f",
  declutter_mark_order_paid: "c2cd9103b47a6e89059e52c18d9cb9d3",
};
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3, OUTSIDER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }, ...BEFORE.map((file) => ({ file, times: 1 }))];
const stmts = setupStatements({ times: 1, times3b: 1, extra });
// Stubs for the jobs strike ladder and the cron defect log (as declutterDelivery.pglite.mjs).
stmts.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;`);
stmts.splice(2, 0, `
  CREATE OR REPLACE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text,
    p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
    p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
  BEGIN
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (p_user, p_violation_type, p_description, p_job_id, p_rungs[least(p_prior_count, array_length(p_rungs, 1) - 1) + 1]);
    RETURN jsonb_build_object('action', p_rungs[least(p_prior_count, array_length(p_rungs, 1) - 1) + 1]);
  END $$;
  REVOKE ALL ON FUNCTION public.apply_consequence_ladder(uuid, text, text, uuid, int, text[], text[], jsonb, boolean, int, boolean, text, text) FROM PUBLIC, anon, authenticated;`);
for (const sql of stmts) await db.exec(sql);
await db.exec(CARDS_SQL);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const run = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);

// 0. Prod's bodies, before the new migration.
for (const [name, md5] of Object.entries(PROD_MD5)) {
  const got = one(await svc(`SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.proname = '${name}'`));
  ok(got === md5, `the world's ${name} is prod's body (md5 ${got?.slice(0, 8)} = ${md5.slice(0, 8)})`);
}

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
async function anon(sql) {
  try {
    await db.exec(`SET ROLE anon;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE;`);
  }
}
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
const I = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const NEAR = { lat: 30.496234, lng: -91.154321 }; // ~5 road miles from every fixture item
const FAR = { lat: 30.75, lng: -91.154321 }; // ~27 road miles
const item = (n, seller, price) => db.exec(liveItemSql({ id: I(n), seller, title: `Seller delivery item ${n}`, price, floor: Math.min(price, 100) }));
const buy = (uid, n, cents) => me(uid, `SELECT public.declutter_buy_now('${I(n)}', ${cents})`);
const setDrop = (buyer, seller, p = NEAR) =>
  svc(`SELECT public.declutter_set_delivery_dropoff('${buyer}', '${seller}', '500 Drop Rd, Baton Rouge, LA 70805', 'North Baton Rouge', ${p.lat}, ${p.lng})`);
const offer = async (uid, seller) => one(await me(uid, `SELECT public.declutter_seller_delivery_offer('${seller}')`));
const lit = (v) => (v === null ? "NULL" : `'${v}'`);
// A seller delivery passes its time and the buyer's door choice ('leave' by default here).
const checkout = (uid, seller, handover, slotIso, handoff = "leave") =>
  me(uid, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}'${slotIso === undefined ? "" : `, ${lit(slotIso)}, ${lit(handoff)}`})`);
const order = async (id) => (await svc(`SELECT * FROM public.declutter_orders WHERE id = '${id}'`))[0];
const sd = async (id) => (await svc(`SELECT * FROM public.declutter_seller_deliveries WHERE order_id = '${id}'`))?.[0];
const markPaid = (o, tag) => svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_sd_${tag}', ${o?.total_cents}, now(), 150)`);
const iso = (t) => (t == null ? null : new Date(t).toISOString());
const RATE = 2000;
const FEE = (items, rate) => Math.round((items + rate) * 0.05) + 70;
const notes = async (uid, title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`));

// 1. The switch, the rules, the fee.
ok(one(await svc(`SELECT audience FROM public.feature_switches WHERE key = 'declutter_seller_delivery'`)) === "off",
  "the switch 'declutter_seller_delivery' is created OFF");
const rules = one(await svc(`SELECT public.declutter_seller_delivery_rules()`));
ok(rules?.rate_min_cents === 500 && rules.rate_max_cents === 15000 && rules.slot_minutes === 60 && rules.lead_hours === 24
  && rules.horizon_days === 14 && rules.per_slot === 1 && rules.radius_default_miles === 10
  && JSON.stringify(rules.radius_choices_miles) === "[5,10,25,50]", "the owner's rules (2026-10-22): $5-$150, 5/10/25/50 mi (10), 1 h slots, 24 h to 14 days, 1 per slot");
ok(one(await svc(`SELECT public.declutter_buyer_fee_cents_seller_delivery(5000, 2000)`)) === 420,
  "the buyer's fee counts the rate: 5% of ($50 + $20) + 70c = $4.20");
ok(refused(await me(SELLER, `SELECT public.declutter_my_seller_delivery()`), /feature_disabled/),
  "switch off: even a tester is refused (require_feature)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_seller_delivery'`);
ok(refused(await me(OUTSIDER, `SELECT public.declutter_set_seller_delivery(true, 2000, 10)`), /feature_disabled/),
  "switch at testers: an ordinary account is refused on settings");

// 2. Seller settings.
ok(refused(await me(SELLER, `SELECT public.declutter_set_seller_delivery(true, 450, 10)`), /invalid_delivery_rate/), "a $4.50 rate is refused (below $5)");
ok(refused(await me(SELLER, `SELECT public.declutter_set_seller_delivery(true, 15100, 10)`), /invalid_delivery_rate/), "a $151 rate is refused (above $150)");
ok(refused(await me(SELLER, `SELECT public.declutter_set_seller_delivery(true, 1050, 10)`), /invalid_delivery_rate/), "a $10.50 rate is refused (whole dollars)");
ok(refused(await me(SELLER, `SELECT public.declutter_set_seller_delivery(true, 2000, 7)`), /invalid_delivery_distance/), "7 miles is refused (not a choice)");
ok(refused(await anon(`SELECT public.declutter_set_seller_delivery(true, 2000, 10)`), /permission denied/), "anon cannot call it");
const mine0 = one(await me(SELLER, `SELECT public.declutter_my_seller_delivery()`));
ok(mine0?.enabled === false && mine0.radius_miles === 10 && mine0.rules?.rate_max_cents === 15000,
  "before saving: off, distance 10 (the default), the rules attached for the app");
const set1 = one(await me(SELLER, `SELECT public.declutter_set_seller_delivery(true, ${RATE}, 10)`));
ok(set1?.enabled === true && set1.rate_cents === RATE, "on at $20, 10 miles");
ok(refused(await me(SELLER, `SELECT public.declutter_set_delivery_schedule('[{"weekday":1,"starts":"09:00","ends":"09:30"}]'::jsonb, NULL)`), /invalid_delivery_windows/),
  "a window shorter than one slot is refused");
const dayOff = one(await svc(`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + 3)::text`));
const windows = JSON.stringify([0, 1, 2, 3, 4, 5, 6].flatMap((d) => [{ weekday: d, starts: "09:00", ends: "12:00" }, { weekday: d, starts: "14:00", ends: "15:00" }]));
const set2 = one(await me(SELLER, `SELECT public.declutter_set_delivery_schedule('${windows}'::jsonb, ARRAY['${dayOff}', '2000-01-01']::date[])`));
ok(set2?.windows?.length === 14 && JSON.stringify(set2.days_off) === JSON.stringify([dayOff]),
  `14 windows (two a day), one day off kept, the past one dropped (${JSON.stringify(set2?.days_off)})`);
ok(refused(await me(SELLER, `SELECT count(*) FROM public.declutter_seller_delivery`), /permission denied/)
  && refused(await me(SELLER, `SELECT count(*) FROM public.declutter_seller_deliveries`), /permission denied/)
  && refused(await me(SELLER, `SELECT count(*) FROM public.declutter_delivery_windows`), /permission denied/),
  "no member reads the tables directly (only through the RPCs)");

// 3. The buyer's offer.
await item(1, SELLER, 5000);
ok(refused(await me(BUYER, `SELECT public.declutter_seller_delivery_offer('${SELLER}')`), /cart_empty/),
  "no cart with this seller: cart_empty (no schedule or ban oracle on an arbitrary seller)");
await buy(BUYER, 1, 5000);
let of = await offer(BUYER, SELLER);
ok(of?.available === false && of.reason === "address_needed" && of.rate_cents === RATE, "no address yet: the rate, and 'address_needed'");
await setDrop(BUYER, SELLER, FAR);
of = await offer(BUYER, SELLER);
ok(of?.available === false && of.reason === "out_of_range" && of.slots?.length === 0, "27 miles away: 'out_of_range', no times");
ok(!!of && !/"(lat|lng|miles|road_miles|dropoff_address|dropoff_lat)"/.test(JSON.stringify(of)), "the answer carries no distance, coordinates or address");
await setDrop(BUYER, SELLER, NEAR);
of = await offer(BUYER, SELLER);
ok(of?.available === true && of.reason === null && of.slots?.length > 20, `5 miles away: available with ${of?.slots?.length} open times`);
const slotRows = await svc(`SELECT extract(hour FROM s AT TIME ZONE 'America/Chicago')::int AS h, extract(minute FROM s)::int AS m,
    (s AT TIME ZONE 'America/Chicago')::date::text AS day, s >= now() + interval '24 hours' AS lead_ok, s <= now() + interval '14 days' AS horizon_ok
  FROM jsonb_array_elements_text('${JSON.stringify(of?.slots ?? [])}'::jsonb) x(s0), LATERAL (SELECT x.s0::timestamptz) y(s)`);
ok(Array.isArray(slotRows) && slotRows.length > 0 && slotRows.every((r) => [9, 10, 11, 14].includes(r.h) && r.m === 0),
  "every time starts on the hour inside a window (9, 10, 11 in 9-12; 2 in 2-3)");
ok(Array.isArray(slotRows) && slotRows.length > 0 && slotRows.every((r) => r.lead_ok && r.horizon_ok), "every time is 24 h ahead or more and 14 days out or less");
ok(Array.isArray(slotRows) && !slotRows.some((r) => r.day === dayOff), "none on the day off");
ok(of?.slot_minutes === 60, "the offer says the slot length");
const [S1, S2, S3, S4] = of?.slots ?? [];
await me(SELLER, `SELECT public.declutter_set_item_seller_delivery('${I(1)}', false)`);
ok((await offer(BUYER, SELLER))?.reason === "item_not_deliverable", "the seller switched this item off: 'item_not_deliverable'");
ok(refused(await me(BUYER, `SELECT public.declutter_set_item_seller_delivery('${I(1)}', true)`), /item_not_found/), "only the item's seller switches it");
await me(SELLER, `SELECT public.declutter_set_item_seller_delivery('${I(1)}', true)`);
await me(SELLER, `SELECT public.declutter_set_seller_delivery(false, ${RATE}, 10)`);
of = await offer(BUYER, SELLER);
ok(of?.reason === "seller_not_delivering" && of.rate_cents === null, "setting off: 'seller_not_delivering', no rate shown");
await me(SELLER, `SELECT public.declutter_set_seller_delivery(true, ${RATE}, 10)`);
ok(refused(await me(OUTSIDER, `SELECT public.declutter_seller_delivery_offer('${SELLER}')`), /feature_disabled/), "an ordinary account gets no offer");

// 4. Checkout with seller delivery: the slot, the rate, the fee, the hold.
ok(refused(await checkout(BUYER, SELLER, "seller_delivery", null), /slot_unavailable/), "no time picked: refused");
ok(refused(await checkout(BUYER, SELLER, "seller_delivery", S1, null), /invalid_handoff/), "no door choice (leave it / hand it to me): refused");
ok(refused(await checkout(BUYER, SELLER, "seller_delivery", S1, "porch"), /invalid_handoff/), "an unknown door choice: refused");
ok(refused(await checkout(BUYER, SELLER, "seller_delivery", iso(Date.now() + 3600e3)), /slot_unavailable/), "a time 1 h from now (not open): refused");
ok(refused(await me(OUTSIDER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'seller_delivery', '${S1}')`), /feature_disabled|cart_empty/),
  "an ordinary account cannot check out with seller delivery");
const o1 = (await checkout(BUYER, SELLER, "seller_delivery", S1))?.[0];
const r1 = o1 && await order(o1.order_id);
ok(r1?.handover === "seller_delivery" && r1.delivery_cents === RATE && r1.items_cents === 5000
  && r1.premium_cents === FEE(5000, RATE) && r1.total_cents === 5000 + FEE(5000, RATE) + RATE && r1.fee_rule === "f1_seller_delivery",
  `the order: $50 + fee $${(FEE(5000, RATE) / 100).toFixed(2)} (on items + rate) + $20 delivery = $${((r1?.total_cents ?? 0) / 100).toFixed(2)}, rule f1_seller_delivery`);
const h1 = o1 && await sd(o1.order_id);
ok(h1?.status === "held" && iso(h1.slot_start) === iso(S1) && iso(h1.slot_end) === iso(Date.parse(S1) + 3600e3)
  && Date.parse(h1.held_until) > Date.now() + 30 * 60e3 && Date.parse(h1.held_until) < Date.now() + 40 * 60e3,
  "the slot is HELD for the page's life (about 35 min), 1 hour long");
ok(h1?.dropoff_address === "500 Drop Rd, Baton Rouge, LA 70805" && h1.handoff === "leave", "the drop-off and the buyer's door choice are frozen with the order");
const o1bRaw = await checkout(BUYER, SELLER, "seller_delivery", S1, "hand");
const o1b = o1bRaw?.[0];
ok(!!o1 && o1b?.order_id === o1.order_id, `the same checkout again returns the same open order (idempotent)${o1b ? "" : `: ${JSON.stringify(o1bRaw)}`}`);
ok((await sd(o1?.order_id))?.handoff === "hand", "a changed door choice is updated on the open order (no new order: no money moves)");
const ofHeld = await offer(BUYER, SELLER);
ok(!!S1 && ofHeld?.slots?.includes(S1) && iso(ofHeld.held_slot) === iso(S1), "the buyer still sees their own held time as open, and as held");
// lh-money-escrow review #1: an order handed back with no page yet re-arms its hold (its new page lives 31 min from now).
await svc(`UPDATE public.declutter_seller_deliveries SET held_until = now() + interval '1 minute' WHERE order_id = '${o1?.order_id}'`);
await checkout(BUYER, SELLER, "seller_delivery", S1);
ok(Date.parse((await sd(o1?.order_id))?.held_until) > Date.now() + 30 * 60e3, "no page attached yet: checking out again re-arms the hold");
await svc(`UPDATE public.declutter_orders SET stripe_checkout_session_id = 'cs_test_sd1' WHERE id = '${o1?.order_id}'`);
await svc(`UPDATE public.declutter_seller_deliveries SET held_until = now() + interval '5 minutes' WHERE order_id = '${o1?.order_id}'`);
const o1page = (await checkout(BUYER, SELLER, "seller_delivery", S1))?.[0];
ok(o1page?.checkout_session_id === "cs_test_sd1" && Date.parse((await sd(o1?.order_id))?.held_until) < Date.now() + 6 * 60e3,
  "with a page attached, the hold is not stretched (the page dies first)");
ok(refused(await svc(`UPDATE public.declutter_orders SET delivery_cents = 500 WHERE id = '${o1?.order_id}'`), /order_amounts_frozen/),
  "the rate is frozen on the order");
ok(refused(await svc(`INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents, delivery_cents, total_cents)
  VALUES ('${BUYER3}', '${SELLER2}', 'seller_delivery', 5000, 320, 0, 2000, 7320)`), /premium_rule/),
  "a seller-delivered order with the items-only fee fails the fee CHECK");

// 5. The race: one delivery per slot per seller.
await item(2, SELLER, 3000);
await buy(BUYER2, 2, 3000);
await setDrop(BUYER2, SELLER, NEAR);
ok(!!S1 && !(await offer(BUYER2, SELLER))?.slots?.includes(S1), "another buyer does not see the held time");
ok(refused(await checkout(BUYER2, SELLER, "seller_delivery", S1), /slot_unavailable/), "and cannot take it while the hold is live");
const o2 = (await checkout(BUYER2, SELLER, "seller_delivery", S2))?.[0];
ok(!!o2?.order_id && (await sd(o2.order_id))?.status === "held", "a different time is fine");
const o1c = (await checkout(BUYER, SELLER, "seller_delivery", S3))?.[0];
ok(!!o1c && o1c.order_id !== o1?.order_id && (await order(o1?.order_id))?.status === "superseded"
  && (await sd(o1?.order_id))?.status === "released" && (await sd(o1c.order_id))?.status === "held",
  "changing the time supersedes the open order and releases its hold");
ok(!!S1 && (await offer(BUYER2, SELLER))?.slots?.includes(S1), "the released time is open to others again");
await svc(`UPDATE public.declutter_seller_deliveries SET held_until = now() - interval '1 minute' WHERE order_id = '${o1c?.order_id}'`);
await item(3, SELLER, 2000);
await buy(BUYER3, 3, 2000);
await setDrop(BUYER3, SELLER, NEAR);
const o3 = (await checkout(BUYER3, SELLER, "seller_delivery", S3))?.[0];
ok(!!o3?.order_id && (await sd(o3.order_id))?.status === "held", "after the hold lapsed (page dead), another buyer takes that time");
const pLate = await markPaid(o1c, "late");
ok(one(pLate)?.result === "paid" && (await order(o1c?.order_id))?.status === "paid", "a late payment on the lapsed hold still stands (no refund)");
const dLate = await sd(o1c?.order_id);
ok(dLate?.status === "needs_time" && dLate.slot_start === null, "its delivery needs a new time (the slot is the other buyer's)");
ok(await notes(BUYER, "Pick a new delivery time") === 1, "and the buyer is told to pick a new time");
ok(refused(await me(SELLER, `SELECT public.declutter_seller_cancel_delivery('${o1c?.order_id}')`), /not_reschedulable/),
  "while the buyer re-picks a lost time, the seller cannot make it a seller-fault cancel (review #2: report a problem)");
const p2 = await markPaid(o2, "o2");
ok(one(p2)?.result === "paid" && (await sd(o2?.order_id))?.status === "booked", "a payment inside the hold books the slot");
ok(await notes(SELLER, "Delivery booked") === 1, "the seller is told the time and area");
ok(refused(await svc(`INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
  VALUES ('${o2?.order_id}', '${BUYER2}', '${SELLER}', now() + interval '2 days', now() + interval '2 days 30 minutes')`), /delivery_order/),
  "a seller-delivered order can never hold a pickup booking (the table refuses it, whichever function writes)");

// 6. The buyer's address: hidden from the seller before payment, shown after.
ok(refused(await me(SELLER, `SELECT public.declutter_seller_delivery_booking('${o3?.order_id}')`), /item_not_found/),
  "before payment the seller cannot read the delivery (or its address)");
const b3 = one(await me(BUYER3, `SELECT public.declutter_seller_delivery_booking('${o3?.order_id}')`));
ok(!!b3?.dropoff_address && b3.status === "held", "the buyer reads their own held delivery");
const b2 = one(await me(SELLER, `SELECT public.declutter_seller_delivery_booking('${o2?.order_id}')`));
ok(b2?.dropoff_address === "500 Drop Rd, Baton Rouge, LA 70805" && b2.status === "booked" && b2.delivery_cents === RATE,
  "after payment the seller reads the address and time");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_seller_delivery_booking('${o2?.order_id}')`), /item_not_found/), "a stranger reads nothing");
ok(refused(await me(BUYER2, `SELECT * FROM public.declutter_item_address('${I(2)}')`), /item_not_found/),
  "the seller's own address is not given to a buyer the seller delivers to");

// 7. Delivered -> "I got it" -> the seller is paid items + rate, exact cents.
const photo2 = `${SELLER}/declutter/handover/${o2?.order_id}/d.jpg`;
ok(refused(await me(SELLER, `SELECT public.declutter_seller_delivered('${o2?.order_id}', '${photo2}')`), /before_delivery_time/), "not before the booked time");
await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() - interval '2 hours', slot_end = now() - interval '1 hour' WHERE order_id = '${o2?.order_id}'`);
ok(refused(await me(SELLER, `SELECT public.declutter_seller_delivered('${o2?.order_id}', '${photo2}')`), /photo_not_uploaded/), "a photo is required");
ok(refused(await me(BUYER2, `SELECT public.declutter_seller_delivered('${o2?.order_id}', 'x')`), /wrong_side/), "the buyer cannot mark it delivered");
await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('declutter-handover', '${photo2}')`);
ok(one(await me(SELLER, `SELECT public.declutter_seller_delivered('${o2?.order_id}', '${photo2}')`))?.result === "delivered",
  "the seller marks it delivered with a photo");
ok((await order(o2?.order_id))?.status === "paid", "that alone pays nothing");
ok(refused(await me(BUYER2, `SELECT public.declutter_report_not_delivered('${o2?.order_id}')`), /seller_delivered/),
  "after the photo the buyer reports a problem instead of 'not delivered'");
ok(one(await me(BUYER2, `SELECT public.declutter_confirm_handover('${o2?.order_id}', 'buyer', NULL)`))?.result === "handed_over",
  "the buyer's \"I got it\" completes it (the existing confirm)");
const pay2 = (await svc(`SELECT * FROM public.declutter_payouts WHERE order_id = '${o2?.order_id}'`))?.[0];
ok(pay2?.items_cents === 3000 && pay2.delivery_cents === RATE && pay2.amount_cents === 3000 + RATE && pay2.status === "pending",
  `the seller's payout is items + rate, exact cents: $${((pay2?.amount_cents ?? 0) / 100).toFixed(2)} (no rounding, no cut)`);
ok((await sd(o2?.order_id))?.status === "done", "the delivery is done");
ok(one(await me(SELLER, `SELECT public.declutter_seller_delivery_booking('${o2?.order_id}')`))?.dropoff_address === null
  && !!one(await me(BUYER2, `SELECT public.declutter_seller_delivery_booking('${o2?.order_id}')`))?.dropoff_address,
  "after the handover the seller no longer reads the buyer's address (the buyer still does)");
ok(refused(await svc(`INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, delivery_cents, debt_cents, amount_cents, status)
  VALUES ('${o1?.order_id}', '${SELLER}', 100, 500, 0, 100, 'pending')`), /declutter_payouts_amount/),
  "a payout row that leaves the rate out fails its CHECK");
ok(refused(await svc(`SELECT public.declutter_delivery_refund('${o2?.order_id}', 'delivery_not_done')`), /no_delivery_fee/),
  "the rate is never refunded on its own");

// 8. "It wasn't delivered": everything back, delivery included; the seller pays the card fee.
await markPaid(o3, "o3");
ok((await sd(o3?.order_id))?.status === "booked", "the third buyer's payment books their time");
ok(refused(await me(BUYER3, `SELECT public.declutter_report_not_delivered('${o3?.order_id}')`), /too_early/), "not before the time ends + 15 min");
await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() - interval '2 hours', slot_end = now() - interval '20 minutes' WHERE order_id = '${o3?.order_id}'`);
ok(refused(await me(SELLER, `SELECT public.declutter_report_not_delivered('${o3?.order_id}')`), /wrong_side/), "only the buyer says it wasn't delivered");
await me(BUYER3, `SELECT public.declutter_report_not_delivered('${o3?.order_id}')`);
const r3 = await order(o3?.order_id);
const ref3 = (await svc(`SELECT * FROM public.declutter_refunds WHERE order_id = '${o3?.order_id}'`))?.[0];
ok(r3?.status === "refunded" && ref3?.reason === "seller_no_show" && ref3.fee_policy === "full_seller_pays_fee"
  && ref3.refund_cents === r3.total_cents && ref3.paid_cents === r3.total_cents,
  `not delivered: the whole $${((ref3?.refund_cents ?? 0) / 100).toFixed(2)} back, delivery included (seller fault)`);
ok(!!ref3 && one(await svc(`SELECT amount_cents FROM public.declutter_seller_fee_debts WHERE refund_id = '${ref3.id}'`)) === ref3.card_fee_cents,
  "the card fee is the seller's debt");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_strikes WHERE user_id = '${SELLER}' AND reason = 'seller_no_show'`)) === 1, "and a seller strike");
ok((await sd(o3?.order_id))?.status === "cancelled", "the delivery is cancelled, its time free");

// 9. The seller cancels a paid delivery: the same seller-fault rules.
await item(4, SELLER2, 4000);
await me(SELLER2, `SELECT public.declutter_set_seller_delivery(true, 1500, 25)`);
await me(SELLER2, `SELECT public.declutter_set_delivery_schedule('${windows}'::jsonb, NULL)`);
await buy(BUYER, 4, 4000);
await setDrop(BUYER, SELLER2, NEAR);
const T4 = (await offer(BUYER, SELLER2))?.slots?.[5];
const o4 = (await checkout(BUYER, SELLER2, "seller_delivery", T4))?.[0];
await markPaid(o4, "o4");
ok(refused(await me(BUYER, `SELECT public.declutter_seller_cancel_delivery('${o4?.order_id}')`), /wrong_side/), "only the seller cancels");
await me(SELLER2, `SELECT public.declutter_seller_cancel_delivery('${o4?.order_id}')`);
const ref4 = (await svc(`SELECT * FROM public.declutter_refunds WHERE order_id = '${o4?.order_id}'`))?.[0];
ok(ref4?.reason === "seller_backed_out" && ref4.fee_policy === "full_seller_pays_fee" && ref4.refund_cents === 4000 + FEE(4000, 1500) + 1500,
  `seller cancels: the buyer gets all $${((ref4?.refund_cents ?? 0) / 100).toFixed(2)} back; the seller pays the card fee`);

// 9b. The buyer cancels for their own reason (owner 2026-10-22): until 24 h before the slot,
// everything back except the card fee; no strike; the items go back on sale; the slot is free.
await item(7, SELLER, 1500);
await buy(BUYER3, 7, 1500);
await setDrop(BUYER3, SELLER, NEAR);
const T7 = (await offer(BUYER3, SELLER))?.slots?.[6];
const o7 = (await checkout(BUYER3, SELLER, "seller_delivery", T7))?.[0];
await markPaid(o7, "o7");
const strikesBefore7 = one(await svc(`SELECT count(*)::int FROM public.declutter_strikes WHERE user_id = '${BUYER3}'`));
ok(refused(await me(SELLER, `SELECT public.declutter_buyer_cancel_delivery('${o7?.order_id}')`), /wrong_side/), "only the buyer uses the buyer's cancel");
await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() + interval '23 hours', slot_end = now() + interval '24 hours' WHERE order_id = '${o7?.order_id}'`);
ok(refused(await me(BUYER3, `SELECT public.declutter_buyer_cancel_delivery('${o7?.order_id}')`), /cancel_window_closed/),
  "less than 24 h before the delivery: no cancel (Report a problem only)");
await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() + interval '48 hours', slot_end = now() + interval '49 hours' WHERE order_id = '${o7?.order_id}'`);
await me(BUYER3, `SELECT public.declutter_buyer_cancel_delivery('${o7?.order_id}')`);
const r7 = await order(o7?.order_id);
const ref7 = (await svc(`SELECT * FROM public.declutter_refunds WHERE order_id = '${o7?.order_id}'`))?.[0];
ok(r7?.status === "refunded" && ref7?.reason === "buyer_cancelled" && ref7.fee_policy === "keep_card_fee"
  && ref7.paid_cents === r7.total_cents && ref7.refund_cents === r7.total_cents - 150 && r7.delivery_cents === RATE,
  `the buyer cancels 2 days ahead: $${((ref7?.refund_cents ?? 0) / 100).toFixed(2)} of $${((r7?.total_cents ?? 0) / 100).toFixed(2)} back (items + delivery, less the $1.50 card fee)`);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_strikes WHERE user_id = '${BUYER3}'`)) === strikesBefore7, "no strike for the buyer");
ok((await sd(o7?.order_id))?.status === "cancelled" && one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(7)}'`)) === "live",
  "the slot is free again and the item is back on sale");

// 10. A new time: propose, accept, a time taken meanwhile, the cap.
await item(5, SELLER2, 2500);
await buy(BUYER2, 5, 2500);
await setDrop(BUYER2, SELLER2, NEAR);
const o5s = (await offer(BUYER2, SELLER2))?.slots ?? [];
const o5 = (await checkout(BUYER2, SELLER2, "seller_delivery", o5s[0], "hand"))?.[0];
await markPaid(o5, "o5");
ok(one(await me(SELLER2, `SELECT public.declutter_seller_delivery_booking('${o5?.order_id}')`))?.handoff === "hand"
  && await notes(SELLER2, "Delivery booked") >= 1, "the seller sees the buyer wants it handed to them");
ok(refused(await me(SELLER2, `SELECT public.declutter_set_delivery_handoff('${o5?.order_id}', 'leave')`), /wrong_side/), "only the buyer changes the door choice");
ok(one(await me(BUYER2, `SELECT public.declutter_set_delivery_handoff('${o5?.order_id}', 'leave')`)) === "leave"
  && await notes(SELLER2, "Delivery changed") === 1, "the buyer changes it after paying; the seller is told");
await me(BUYER2, `SELECT public.declutter_set_delivery_handoff('${o5?.order_id}', 'hand')`);
const times5 = one(await me(BUYER2, `SELECT public.declutter_delivery_open_times('${o5?.order_id}')`));
ok(Array.isArray(times5?.slots) && times5.slots.length > 10 && times5.slot_minutes === 60
  && one(await me(SELLER2, `SELECT public.declutter_delivery_open_times('${o5?.order_id}')`))?.slots?.length === times5.slots.length,
  "both sides read the open times to move to (the checkout list, after payment)");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_delivery_open_times('${o5?.order_id}')`), /item_not_found/), "a stranger reads no times");
ok(refused(await me(BUYER2, `SELECT public.declutter_propose_delivery_time('${o5?.order_id}', '${iso(Date.now() + 3600e3)}')`), /slot_unavailable/),
  "a proposed time must be one of the seller's open times");
ok(one(await me(BUYER2, `SELECT public.declutter_propose_delivery_time('${o5?.order_id}', '${o5s[1]}')`))?.result === "proposed", "the buyer proposes a new time");
await me(BUYER2, `SELECT public.declutter_propose_delivery_time('${o5?.order_id}', '${o5s[1]}')`);
ok((await sd(o5?.order_id))?.buyer_proposals === 1, "a double tap on the same time uses one request, not two");
ok(refused(await me(BUYER2, `SELECT public.declutter_answer_delivery_time('${o5?.order_id}', true)`), /wrong_side/), "the proposer cannot accept their own");
ok(one(await me(SELLER2, `SELECT public.declutter_answer_delivery_time('${o5?.order_id}', true)`))?.result === "moved"
  && iso((await sd(o5?.order_id))?.slot_start) === iso(o5s[1]), "the seller accepts: the delivery moves");
ok(one(await me(SELLER2, `SELECT public.declutter_propose_delivery_time('${o5?.order_id}', '${o5s[2]}')`))?.result === "proposed"
  && one(await me(BUYER2, `SELECT public.declutter_answer_delivery_time('${o5?.order_id}', false)`))?.result === "kept"
  && iso((await sd(o5?.order_id))?.slot_start) === iso(o5s[1]), "the seller proposes, the buyer turns it down: the time stays");
await me(BUYER2, `SELECT public.declutter_propose_delivery_time('${o5?.order_id}', '${o5s[3]}')`);
await item(6, SELLER2, 1000);
await buy(BUYER3, 6, 1000);
await setDrop(BUYER3, SELLER2, NEAR);
const o6 = (await checkout(BUYER3, SELLER2, "seller_delivery", o5s[3]))?.[0];
ok(!!o6?.order_id, "another buyer takes the proposed time first");
ok(one(await me(SELLER2, `SELECT public.declutter_answer_delivery_time('${o5?.order_id}', true)`))?.result === "slot_taken"
  && iso((await sd(o5?.order_id))?.slot_start) === iso(o5s[1]) && (await sd(o5?.order_id))?.proposed_start === null,
  "accepting a time taken meanwhile: 'slot_taken', the old time kept, the proposal cleared");
await me(BUYER2, `SELECT public.declutter_propose_delivery_time('${o5?.order_id}', '${o5s[4]}')`);
ok(refused(await me(BUYER2, `SELECT public.declutter_propose_delivery_time('${o5?.order_id}', '${o5s[5]}')`), /reschedule_used/),
  "each side asks at most 3 times");
ok(one(await me(BUYER, `SELECT public.declutter_propose_delivery_time('${o1c?.order_id}', '${S4}')`))?.result === "booked"
  && (await sd(o1c?.order_id))?.status === "booked", "a buyer whose time was lost picks a new one, booked at once");

// 11. The sweep: auto-pay 24 h after the photo; never the 7-day pickup no-show; reminders.
await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() - interval '30 hours', slot_end = now() - interval '29 hours', proposed_start = NULL, proposed_by = NULL WHERE order_id = '${o5?.order_id}'`);
const handed5 = await me(SELLER2, `SELECT public.declutter_seller_delivered('${o5?.order_id}', NULL)`);
ok(one(handed5)?.result === "delivered", `"Hand it to me": the seller marks it handed over without a photo${one(handed5) ? "" : `: ${JSON.stringify(handed5)}`}`);
ok(refused(await me(BUYER2, `SELECT public.declutter_set_delivery_handoff('${o5?.order_id}', 'leave')`), /not_reschedulable/),
  "after the seller's mark the door choice is fixed");
await svc(`UPDATE public.declutter_seller_deliveries SET delivered_at = now() - interval '25 hours' WHERE order_id = '${o5?.order_id}'`);
await svc(`UPDATE public.declutter_orders SET paid_at = now() - interval '8 days' WHERE id = '${o1c?.order_id}'`);
const sw = one(await svc(`SELECT public.declutter_handover_sweep()`));
ok((await order(o5?.order_id))?.status === "handed_over" && sw?.delivery_auto_paid === 1, "24 h after the seller's mark (no photo needed when handed over) the sweep pays the seller");
const pay5 = (await svc(`SELECT * FROM public.declutter_payouts WHERE order_id = '${o5?.order_id}'`))?.[0];
ok(pay5?.delivery_cents === 1500 && pay5.debt_cents === 150 && pay5.amount_cents === 2500 + 1500 - 150,
  "auto-pay pays items + rate too, less the $1.50 card fee this seller owed from the cancel (the debt cap counts the rate)");
ok((await order(o1c?.order_id))?.status === "paid" && sw?.not_picked_up === 0,
  "a seller delivery paid 8 days ago is NOT refunded as a pickup no-show");
await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() + interval '23 hours', slot_end = now() + interval '24 hours', reminded_hours = '{}' WHERE order_id = '${o1c?.order_id}'`);
const swr = one(await svc(`SELECT public.declutter_handover_sweep()`));
ok(swr?.delivery_reminders >= 1 && JSON.stringify((await sd(o1c?.order_id))?.reminded_hours) === "[24]", "23 h before: the 24 h reminder");
await svc(`SELECT public.declutter_handover_sweep()`);
ok(JSON.stringify((await sd(o1c?.order_id))?.reminded_hours) === "[24]", "the next run sends nothing again");
await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() + interval '30 minutes', slot_end = now() + interval '90 minutes' WHERE order_id = '${o1c?.order_id}'`);
await svc(`SELECT public.declutter_handover_sweep()`);
ok(JSON.stringify((await sd(o1c?.order_id))?.reminded_hours) === "[1,24]", "30 min before: the 1 h reminder");
ok(await notes(BUYER, "Delivery coming up") === 2, "the buyer got exactly two reminders");

// 12. Grants: anon runs nothing new; members run no internal.
const memberFns = ["declutter_my_seller_delivery()", "declutter_set_seller_delivery(boolean,integer,integer)", "declutter_set_delivery_schedule(jsonb,date[])",
  "declutter_set_item_seller_delivery(uuid,boolean)", "declutter_seller_delivery_offer(uuid)", "declutter_seller_delivery_booking(uuid)",
  "declutter_seller_delivered(uuid,text)", "declutter_report_not_delivered(uuid)", "declutter_seller_cancel_delivery(uuid)",
  "declutter_propose_delivery_time(uuid,timestamptz)", "declutter_answer_delivery_time(uuid,boolean)", "declutter_set_delivery_handoff(uuid,text)",
  "declutter_buyer_cancel_delivery(uuid)", "declutter_delivery_open_times(uuid)",
  "declutter_start_checkout(uuid,text,timestamptz,text)", "declutter_seller_delivery_rules()",
  "declutter_buyer_fee_cents_seller_delivery(integer,integer)"];
const internalFns = ["declutter_delivery_slot_starts(uuid,timestamptz,timestamptz)", "declutter_delivery_slot_used(uuid,timestamptz,uuid)",
  "declutter_delivery_open_slots(uuid,uuid)", "declutter_seller_delivery_check(uuid,uuid,uuid[])", "declutter_delivery_when(timestamptz)",
  "declutter_seller_delivery_on_order()", "declutter_seller_delivery_seed()",
  // Restated: still service only (CREATE OR REPLACE keeps the ACL; the migration restates the REVOKE too).
  "declutter_complete_handover(uuid,text)", "declutter_handover_sweep()", "declutter_delivery_refund(uuid,text)",
  "declutter_address_access(uuid,uuid)", "declutter_bookings_not_delivery()", "declutter_orders_fee_rule_f1()"];
let grantsOk = true;
for (const [fns, member] of [[memberFns, true], [internalFns, false]]) {
  for (const fn of fns) {
    const r = (await svc(`SELECT has_function_privilege('anon', 'public.${fn}', 'execute') a, has_function_privilege('authenticated', 'public.${fn}', 'execute') u`))?.[0];
    if (r?.a !== false || r?.u !== member) { grantsOk = false; console.log("  grant:", fn, JSON.stringify(r)); }
  }
}
ok(grantsOk, `grants: ${memberFns.length} member RPCs (authenticated, not anon), ${internalFns.length} internals (neither)`);
ok(one(await svc(`SELECT count(*)::int FROM pg_proc WHERE proname = 'declutter_start_checkout'`)) === 1, "one declutter_start_checkout (the old signature is gone)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261027211754_declutter_bundle_discount (Q2427, owner 2026-10-27: "Buy 2+, get N% off").
 *
 * The world is the safe-meetup proof's (declutterSafeMeetup.pglite.mjs: the Free-section world on prod's bodies,
 * md5-checked), with 20261027204500_declutter_safe_meetup applied once as this one's base (it restated
 * declutter_start_checkout last); the bundle migration is then applied 3 times. MONEY: covers the rule (5-50, the
 * seller's own, members read only the percent), the preview equal to checkout, each paid line N% off its own price,
 * the buyer's fee on the discounted paid total, never below an item's floor, free lines never counted or changed,
 * a changed or removed rule opening a new order (the old one superseded, never charged), originals restored, the
 * seller paid the discounted total, a refund never more than what was paid, and the grants.
 *
 *   node src/test/pglite/declutterBundleDiscount.pglite.mjs                      # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBundleDiscount.pglite.mjs   # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterBundleDiscount.pglite.mjs
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const DELIVERY_FILE = "20261027153244_declutter_seller_delivery.sql";
const FREE_FILE = "20261027170717_declutter_free_section.sql";
const MEETUP_FILE = "20261027204500_declutter_safe_meetup.sql";
const NEW_FILE = "20261027211754_declutter_bundle_discount.sql";
const OWED_FILE = "20261027163240_payout_setup_only_when_owed.sql";
// main's later Declutter money migrations (on prod): the chain 141d's own proof replays.
const LATER_ON_PROD = [
  "20261021181118_helpr_delivery_payout_round_down.sql",
  "20261021185418_declutter_delivery_raise_pay.sql",
  "20261021204947_declutter_sales_outlive_a_deleted_party.sql",
];
// Written on top of these two (not on prod yet; they land first).
const SETUP_FEE_FILE = "20261026154738_declutter_setup_fee_once.sql";
const REFUND_141D_FILE = "20261026155251_declutter_refund_requests.sql";
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
// Prod's bodies (md5 of pg_proc.prosrc, read-only SQL on fncmgoasalhdgfwzhsqa, 2026-10-21; re-read 2026-10-27: unchanged).
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
const { SELLER, SELLER2, SELLER3, BUYER, BUYER2, BUYER3, OUTSIDER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }, ...[...BEFORE, ...LATER_ON_PROD, SETUP_FEE_FILE, REFUND_141D_FILE].map((file) => ({ file, times: 1 }))];
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
// What prod holds that the slice chain lacks and the setup-fee and 141d migrations read (the stubs
// declutterRefundRequests.pglite.mjs uses): the account fee flag, the platform's live fee (200), the
// payout send marks (20261019070737) and the updated_at trigger function.
const feeAt = stmts.indexOf(readFileSync(`${MIG_DIR}${SETUP_FEE_FILE}`, "utf8"));
if (feeAt < 0) throw new Error("setup-fee migration not in the chain");
stmts.splice(feeAt, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_fee_paid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS onboarding_fee_charged_at timestamptz;
  CREATE TABLE IF NOT EXISTS public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_fee_cents integer NOT NULL DEFAULT 200);
  INSERT INTO public.platform_settings (onboarding_fee_cents) VALUES (200);
  CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
  CREATE TABLE IF NOT EXISTS public.payout_send_marks (payout_kind text NOT NULL CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop')),
    payout_id uuid NOT NULL, marked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (payout_kind, payout_id));
  -- 20261021061341 (on prod): the free checkout names the taker to the giver.
  CREATE OR REPLACE FUNCTION public.member_display_name(p_full_name text, p_fallback text DEFAULT 'A neighbor')
  RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE WHEN v.t = '' THEN p_fallback
                WHEN array_length(v.parts, 1) > 1 THEN v.parts[1] || ' ' || left(v.parts[array_length(v.parts, 1)], 1) || '.'
                ELSE v.parts[1] END
      FROM (SELECT x.t, regexp_split_to_array(x.t, '\\s+') AS parts
              FROM (SELECT regexp_replace(coalesce(p_full_name, ''), '^\\s+|\\s+$', '', 'g') AS t) x) v
  $fn$;`);
// The prod chain first; prod's bodies are checked at that point (section 0), before the two branches land.
for (const sql of stmts.slice(0, feeAt)) await db.exec(sql);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const run = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);

// 0. Prod's bodies, before the setup-fee, 141d and new migrations.
for (const [name, md5] of Object.entries(PROD_MD5)) {
  const got = one(await svc(`SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.proname = '${name}'`));
  ok(got === md5, `the world's ${name} is prod's body (md5 ${got?.slice(0, 8)} = ${md5.slice(0, 8)})`);
}
// Then the two migrations this one is written on (they land first), and the cards.
for (const sql of stmts.slice(feeAt)) await db.exec(sql);
// Every member here already paid the one-time setup fee, so each order's total is the sale's own.
await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true`);
await db.exec(CARDS_SQL);

{
  const r = await run(readFileSync(`${MIG_DIR}${DELIVERY_FILE}`, "utf8"));
  ok(!r?.error, `the seller-delivery migration (this one's base) applies${r?.error ? `: ${r.error}` : ""}`);
}
// 20261027163240 (payout setup only when money is owed) lands first: its Declutter listing bodies (no payout
// gate) are in the world, and the tables its payout_setup_hire_allowed reads, which the slice chain lacks,
// are stubbed in prod's shape (only the columns it reads).
{
  const owed = readFileSync(`${MIG_DIR}${OWED_FILE}`, "utf8");
  const fnSql = (name) => {
    const m = [...owed.matchAll(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
    const open = /\bAS\s+(\$\w*\$)/i.exec(owed.slice(m.index));
    const close = owed.indexOf(open[1], m.index + open.index + open[0].length);
    return owed.slice(m.index, owed.indexOf(";", close) + 1);
  };
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid, payment_status text);
    CREATE TABLE IF NOT EXISTS public.group_job_helpers (job_id uuid, helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.job_accept_pending (job_id uuid, helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.cancellation_fee_transfers (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.crew_cancellation_fee_shares (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.crew_block_fees (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.payout_transfers (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, status text, captured_at timestamptz);
    CREATE TABLE IF NOT EXISTS public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid);
    CREATE OR REPLACE FUNCTION public.job_payment_is_funded(s text) RETURNS boolean LANGUAGE sql IMMUTABLE
      AS $$ SELECT s IN ('escrow', 'payout_pending') $$;`);
  for (const n of ["declutter_publish_item", "declutter_relist_listing", "payout_setup_hire_allowed"]) await db.exec(fnSql(n));
}
{
  const r = await run(readFileSync(`${MIG_DIR}${FREE_FILE}`, "utf8"));
  ok(!r?.error, `the Free-section migration (this one's base, on prod) applies${r?.error ? `: ${r.error}` : ""}`);
}
// 0b. The bodies this migration restates or calls are prod's (read-only, 2026-10-27).
const PROD_NOW = {
  declutter_start_checkout: "1fbbec4bb53508e8f4d0cbb714de1a15",
  declutter_address_access: "8df36808c9b023c8455b9f076b592994",
  declutter_seller_picked_up: "b85d84e9dff4bcae895f92be6f45057d",
  declutter_lock_order: "da782605b8f7f519f4b99dfe13a11774",
  declutter_order_side: "94ab8fc0f15f6e22ed96af4dbe8e18c4",
  declutter_confirm_handover: "0c4a4abef15ee02d4b367e4cce3ff0f3",
  declutter_complete_handover: "8d1b929bbebcd1849edb6aaf0226690a",
};
for (const [name, md5] of Object.entries(PROD_NOW)) {
  const got = one(await svc(`SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.proname = '${name}'`));
  ok(got === md5, `the world's ${name} is prod's body now (md5 ${got?.slice(0, 8)} = ${md5.slice(0, 8)})`);
}
{
  const r = await run(readFileSync(`${MIG_DIR}${MEETUP_FILE}`, "utf8"));
  ok(!r?.error, `the safe-meetup migration (this one's base) applies${r?.error ? `: ${r.error}` : ""}`);
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
const I = (n) => `88888888-0000-0000-0000-${String(n).padStart(12, "0")}`;
const NEAR = { lat: 30.496234, lng: -91.154321 }; // ~5 road miles from every fixture item
const FAR = { lat: 30.75, lng: -91.154321 }; // ~27 road miles
const item = (n, seller, price) => db.exec(liveItemSql({ id: I(n), seller, title: `Free section item ${n}`, price, floor: price === 0 ? 0 : Math.min(price, 100) }));
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

const { NOCARD, NOPAYOUT } = USERS;
// Prod has seed_hidden_for (20261007033530; it reads the launch switch). The slice chain lacks it: a stub answering
// as prod does for these test accounts (enrolled is_seed accounts are never hidden from).
await db.exec(`CREATE OR REPLACE FUNCTION public.seed_hidden_for(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  REVOKE ALL ON FUNCTION public.seed_hidden_for(uuid) FROM PUBLIC, anon, authenticated;`);
const claim = (uid, n) => me(uid, `SELECT public.declutter_claim_free('${I(n)}') AS id`);
const freeOut = (uid, seller, handover = "pickup_home") => me(uid, `SELECT public.declutter_checkout_free('${seller}', '${handover}') AS id`);
const ordersOf = async (buyer, seller) => svc(`SELECT * FROM public.declutter_orders WHERE buyer_id = '${buyer}' AND seller_id = '${seller}' ORDER BY created_at`);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT s, d, '00:00', '23:59' FROM unnest(ARRAY['${SELLER}', '${SELLER2}', '${SELLER3}', '${NOPAYOUT}']::uuid[]) s, generate_series(0, 6) d
  ON CONFLICT DO NOTHING;`);

// ---------------------------------------------------------------------------------------------------------------
// Q2427 bundle discounts. SELLER3 sells; BUYER buys. Fixture items sit at the slice harness's area.
const setRule = (uid, pct) => me(uid, `SELECT public.declutter_set_bundle_discount(${pct === null ? "NULL" : pct}) AS r`);
const lines = async (buyer, seller) => svc(`SELECT c.id, c.item_id, c.price_cents, c.list_price_cents, c.status, c.order_id
  FROM public.declutter_cart_items c WHERE c.buyer_id = '${buyer}' AND c.seller_id = '${seller}' ORDER BY c.item_id`);
const preview = async (uid, seller) => one(await me(uid, `SELECT public.declutter_bundle_preview('${seller}')`));
const co = async (uid, seller, handover = "pickup_home") => (await me(uid, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}')`))?.[0];
const itemFloor = (n, seller, price, floor) => db.exec(liveItemSql({ id: I(n), seller, title: `Bundle item ${n}`, price, floor }));

// B1. The rule: the seller sets 5-50 or removes it; members read the percent; nothing else.
{
  ok(refused(await setRule(SELLER3, 60), /invalid_bundle_percent/), "60% is refused");
  ok(refused(await setRule(SELLER3, 4), /invalid_bundle_percent/), "4% is refused");
  ok(one(await setRule(SELLER3, 10)) === 10, "the seller sets Buy 2+, get 10% off");
  ok(one(await me(BUYER, `SELECT public.declutter_bundle_rule('${SELLER3}')`)) === 10, "a member reads the seller's percent");
  ok(one(await me(BUYER, `SELECT public.declutter_bundle_rule('${SELLER2}')`)) === null, "no rule reads as none");
  ok(refused(await anon(`SELECT public.declutter_bundle_rule('${SELLER3}')`), /permission denied/), "anon cannot read a rule");
  ok(refused(await me(BUYER, `SELECT * FROM public.declutter_bundle_rules`), /permission denied/), "members cannot read the rules table");
  ok(refused(await me(BUYER, `SELECT * FROM public.declutter_bundle_targets('${SELLER3}', ARRAY[]::uuid[])`), /permission denied/),
    "members cannot run the price computation (it reads private floors)");
  await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'`);
  ok(refused(await setRule(SELLER3, 10), /feature_disabled/), "with Declutter off, the rule cannot be set");
  await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);
}

// B2. Two paid lines: each 10% off its own price, the fee on the discounted paid total, the discount recorded.
await itemFloor(60, SELLER3, 4000, 2000);
await itemFloor(61, SELLER3, 2500, 100);
let B;
{
  await buy(BUYER, 60, 4000);
  ok(await preview(BUYER, SELLER3) === 0, "one paid line: no discount yet (Buy 2+)");
  await buy(BUYER, 61, 2500);
  ok(await preview(BUYER, SELLER3) === 650, `two paid lines: the cart previews $6.50 off (${await preview(BUYER, SELLER3)})`);
  B = await co(BUYER, SELLER3);
  ok(B?.items_cents === 5850, `checkout: items $65.00 less 10% = $58.50 (${B?.items_cents})`);
  ok(B?.premium_cents === FEE(5850, 0), `the buyer's fee is on the discounted paid total (${B?.premium_cents} = ${FEE(5850, 0)})`);
  ok(B?.total_cents === 5850 + FEE(5850, 0), "the total is the discounted items plus the fee");
  const o = await order(B?.order_id);
  ok(o?.bundle_discount_cents === 650, "the order records the $6.50 bundle discount");
  const ls = await lines(BUYER, SELLER3);
  ok(ls.map((l) => [l.price_cents, l.list_price_cents]).join("|") === "3600,4000|2250,2500", `each line keeps its original (${JSON.stringify(ls.map((l) => [l.price_cents, l.list_price_cents]))})`);
  const cartView = await me(BUYER, `SELECT price_cents FROM public.declutter_my_cart() WHERE seller_id = '${SELLER3}' ORDER BY item_id`);
  ok(Array.isArray(cartView) && cartView.map((r) => r.price_cents).join(",") === "4000,2500", "a line still in the cart shows its original price");
  const again = await co(BUYER, SELLER3);
  ok(again?.order_id === B?.order_id, "the same lines and rule hand back the same order (idempotent)");
}

// B3. The rule changes while the order is open: a new order at the new total; the old one superseded.
{
  await setRule(SELLER3, 20);
  ok(await preview(BUYER, SELLER3) === 1300, "the preview follows the new rule (20%)");
  const B2 = await co(BUYER, SELLER3);
  ok(B2?.order_id !== B?.order_id && B2?.items_cents === 5200, `a changed rule opens a new order at $52.00 (${B2?.items_cents})`);
  ok((await order(B?.order_id))?.status === "superseded", "the order at the old total is superseded, never charged");
  B = B2;
  // Removed: the next checkout restores every original price.
  await setRule(SELLER3, null);
  const B3 = await co(BUYER, SELLER3);
  ok(B3?.items_cents === 6500 && (await order(B3?.order_id))?.bundle_discount_cents === 0, "the rule removed: the original prices come back");
  ok((await lines(BUYER, SELLER3)).every((l) => l.list_price_cents === null), "and no line keeps a stale original");
  await setRule(SELLER3, 10);
  B = await co(BUYER, SELLER3);
  ok(B?.items_cents === 5850, "the rule set again: 10% off again");
}

// B4. Never below the item's floor; never below $1; free lines never count or change.
{
  await itemFloor(62, SELLER2, 4000, 3900);
  await itemFloor(63, SELLER2, 3000, 100);
  await setRule(SELLER2, 50);
  await buy(BUYER2, 62, 4000);
  await buy(BUYER2, 63, 3000);
  const r = await co(BUYER2, SELLER2);
  ok(r?.items_cents === 3900 + 1500, `50% off, but the first item stops at its $39 floor (${r?.items_cents})`);
  await setRule(SELLER2, null);
  // One paid line and one free line: no discount (the free line never counts).
  await item(64, SELLER, 2000);
  await item(65, SELLER, 0);
  await setRule(SELLER, 25);
  await buy(BUYER3, 64, 2000);
  await me(BUYER3, `SELECT public.declutter_claim_free('${I(65)}')`);
  ok(await preview(BUYER3, SELLER) === 0, "one paid line plus one free line: no bundle discount");
  const mixed = await co(BUYER3, SELLER);
  ok(mixed?.items_cents === 2000, `the mixed order is the paid line's own price (${mixed?.items_cents})`);
  const free = (await lines(BUYER3, SELLER)).find((l) => l.item_id === I(65));
  ok(free?.price_cents === 0 && free?.list_price_cents === null, "the free line is untouched");
  await setRule(SELLER, null);
}

// B5. Paid: the seller is paid the discounted total; a refund is of what was paid (pro-rated by construction).
{
  await svc(`SELECT public.declutter_mark_order_paid('${B?.order_id}', 'pi_bundle_1', ${B?.total_cents}, now(), 150)`);
  ok((await order(B?.order_id))?.status === "paid", "the bundle order is paid at its discounted total");
  const paidView = await me(BUYER, `SELECT price_cents FROM public.declutter_my_cart() WHERE seller_id = '${SELLER3}' ORDER BY item_id`);
  ok(Array.isArray(paidView) && paidView.map((r) => r.price_cents).join(",") === "3600,2250", "paid lines show what was paid");
  const done = await svc(`SELECT public.declutter_complete_handover('${B?.order_id}', 'buyer') AS r`);
  ok(Array.isArray(done), `the handover completes${Array.isArray(done) ? "" : `: ${JSON.stringify(done)}`}`);
  const pay = (await svc(`SELECT amount_cents FROM public.declutter_payouts WHERE order_id = '${B?.order_id}'`))?.[0];
  ok(pay?.amount_cents === 5850, `the seller's payout is the discounted $58.50, never $65 (${pay?.amount_cents})`);
  const refund = await svc(`SELECT public.declutter_refund_after_handover('${B?.order_id}', 'not_as_described', NULL) AS r`);
  const after = (await svc(`SELECT amount_cents, refunded_cents FROM public.declutter_payouts WHERE order_id = '${B?.order_id}'`))?.[0];
  ok(Array.isArray(refund) && after?.refunded_cents === 5850,
    `a full refund after the handover is exactly what was paid for the items, $58.50, never $65 (${JSON.stringify(after)} ${Array.isArray(refund) ? JSON.stringify(refund[0]?.r) : refund?.error})`);
}

// B7. Seller delivery's free-over-$X reads the BUNDLE total (lh-money-escrow review #1): $30 + $25 = $55 listed, 20% off
//     = $44, under the seller's free-from-$50, so the offer AND checkout both charge the $10 rate (never free at $44).
{
  await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_seller_delivery'`);
  const setSd = await me(SELLER2, `SELECT public.declutter_set_seller_delivery(true, 1000, 25, 5000) AS r`);
  ok(Array.isArray(setSd), `SELLER2: $10 delivery, free from $50${Array.isArray(setSd) ? "" : `: ${setSd?.error}`}`);
  const allDay = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, starts: "00:00", ends: "23:00" })));
  await me(SELLER2, `SELECT public.declutter_set_delivery_schedule('${allDay}'::jsonb, NULL)`);
  await setRule(SELLER2, 20);
  await itemFloor(66, SELLER2, 3000, 100);
  await itemFloor(67, SELLER2, 2500, 100);
  await buy(BUYER3, 66, 3000);
  await buy(BUYER3, 67, 2500);
  await setDrop(BUYER3, SELLER2);
  const fo = await offer(BUYER3, SELLER2);
  ok(fo?.items_cents === 4400 && fo?.rate_cents === 1000 && fo?.free_over_cents === 5000,
    `the offer: this order is $44 at the bundle price, under $50, so $10 delivery (${JSON.stringify({ items: fo?.items_cents, rate: fo?.rate_cents, reason: fo?.reason })})`);
  ok(fo?.available === true, `and delivery is offered (${fo?.reason ?? "available"})`);
  const slot = fo?.slots?.[3];
  const r = (await checkout(BUYER3, SELLER2, "seller_delivery", slot))?.[0];
  const o = r && await order(r.order_id);
  ok(o?.items_cents === 4400 && o?.delivery_cents === 1000 && o?.bundle_discount_cents === 1100,
    `checkout agrees: items $44, delivery $10, discount $11 (${o ? JSON.stringify({ items: o.items_cents, delivery: o.delivery_cents, disc: o.bundle_discount_cents }) : JSON.stringify(r)})`);
  ok(o?.premium_cents === FEE(4400, 1000) && o?.total_cents === 4400 + 1000 + FEE(4400, 1000),
    "the fee is on the discounted items + the rate");
  // The other direction: the seller removes the rule after that checkout priced the lines at $44. The offer reads
  // the originals again ($55, free from $50), never the stale discounted prices; checkout agrees.
  await setRule(SELLER2, null);
  const fo2 = await offer(BUYER3, SELLER2);
  ok(fo2?.items_cents === 5500 && fo2?.rate_cents === 0,
    `the rule removed: the offer reads $55 again, so delivery is free (${JSON.stringify({ items: fo2?.items_cents, rate: fo2?.rate_cents })})`);
  const r2 = (await checkout(BUYER3, SELLER2, "seller_delivery", fo2?.slots?.[3]))?.[0];
  const o2 = r2 && await order(r2.order_id);
  ok(o2?.items_cents === 5500 && o2?.delivery_cents === 0 && o2?.bundle_discount_cents === 0 && r2?.order_id !== r?.order_id,
    `and checkout agrees: a new order at $55 with free delivery (${o2 ? JSON.stringify({ items: o2.items_cents, delivery: o2.delivery_cents }) : JSON.stringify(r2)})`);
}

// B6. Grants.
{
  ok(one(await svc(`SELECT has_function_privilege('anon', 'public.declutter_bundle_preview(uuid)', 'EXECUTE')`)) === false, "anon cannot preview");
  ok(one(await svc(`SELECT has_function_privilege('anon', 'public.declutter_set_bundle_discount(integer)', 'EXECUTE')`)) === false, "anon cannot set a rule");
  ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_bundle_targets(uuid, uuid[])', 'EXECUTE')`)) === false,
    "members cannot run the floor-reading computation");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

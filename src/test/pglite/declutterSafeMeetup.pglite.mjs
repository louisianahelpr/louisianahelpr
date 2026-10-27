#!/usr/bin/env node
/**
 * PGlite proof for 20261027204500_declutter_safe_meetup (Q2425, owner 2026-10-27: safe meetup spots).
 *
 * The world is the Free-section proof's (declutterFreeSection.pglite.mjs: prod's slice bodies md5-checked, then
 * the setup-fee, 141d, seller-delivery and payout-owed migrations), with 20261027170717_declutter_free_section
 * applied once as this one's base (on main and on prod); section 0b checks the bodies this migration restates and
 * calls against PROD's (md5 of pg_proc.prosrc, read-only `supabase db query --linked`, 2026-10-27). The meetup
 * migration is then applied 3 times. Covers: admin-only spot CRUD (audited), members cannot read the table, spots
 * near a cart (25 miles) and only active ones, choosing a spot, checkout 'meetup' (the switch, a spot needed, a
 * snapshot frozen, idempotent, a new spot a new order), the fee as a pickup's, NO home address for a meetup,
 * "I'm here" for each side (an hour before, once, the other told, strangers refused), the seller's "Picked up" at
 * a meetup, and the buyer's "I got it".
 *
 *   node src/test/pglite/declutterSafeMeetup.pglite.mjs                      # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSafeMeetup.pglite.mjs   # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterSafeMeetup.pglite.mjs
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const DELIVERY_FILE = "20261027153244_declutter_seller_delivery.sql";
const FREE_FILE = "20261027170717_declutter_free_section.sql";
const NEW_FILE = "20261027204500_declutter_safe_meetup.sql";
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
// Q2425 safe meetup spots. Fixture items sit at the slice harness's area (Mid-City, Baton Rouge: 30.45, -91.15).
const { ADMIN } = USERS;
const at = (h, days = 1) => `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '${days} day ${h} hours') AT TIME ZONE 'America/Chicago')`;
const saveSpot = (uid, id, name, lat, lng, active = true, kind = "police") =>
  me(uid, `SELECT public.admin_declutter_save_meetup_spot(${id ? `'${id}'` : "NULL"}, 'East Baton Rouge', '${name}',
    '9000 Airline Hwy, Baton Rouge, LA', ${lat}, ${lng}, '${kind}', 'Lit lot, cameras', ${active}) AS id`);
const near = async (uid, seller) => {
  const r = await me(uid, `SELECT * FROM public.declutter_meetup_spots_near('${seller}')`);
  return Array.isArray(r) ? r : [];
};

// M1. Spots: admins only, audited; members never read the table.
{
  ok(refused(await saveSpot(BUYER, null, "BRPD Safe Exchange", 30.46, -91.14), /admin_only/), "a member cannot add a meetup spot");
  const s1 = await saveSpot(ADMIN, null, "BRPD Safe Exchange", 30.46, -91.14);
  ok(Array.isArray(s1) && !!one(s1), `an admin adds a spot${Array.isArray(s1) ? "" : `: ${JSON.stringify(s1)}`}`);
  globalThis.S1 = one(s1);
  ok(refused(await saveSpot(ADMIN, null, "Houston spot", 29.76, -95.37), /meetup_spot_invalid/), "a map point outside Louisiana is refused");
  const far = await saveSpot(ADMIN, null, "Shreveport PD lot", 32.52, -93.75);
  globalThis.SFAR = one(far);
  const off = await saveSpot(ADMIN, null, "Closed store", 30.45, -91.15, false, "store");
  globalThis.SOFF = one(off);
  ok(one(await svc(`SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'declutter_meetup_spot_added'`)) === 3, "each add is in the admin audit log");
  const ren = await saveSpot(ADMIN, globalThis.S1, "BRPD Safe Exchange Zone", 30.46, -91.14);
  ok(one(ren) === globalThis.S1 && one(await svc(`SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'declutter_meetup_spot_saved'`)) === 1,
    "an admin edits a spot (audited)");
  const read = await me(BUYER, `SELECT * FROM public.declutter_meetup_spots`);
  ok(Array.isArray(read) && read.length === 0, "a member reads no spot rows from the table (RLS: admins only)");
  ok((await me(ADMIN, `SELECT * FROM public.declutter_meetup_spots`))?.length === 3, "an admin reads every spot");
}

// M2. Near this cart: only active spots within 25 miles of every item, nothing without a cart.
await item(40, SELLER2, 4000);
await item(41, SELLER2, 2500);
{
  ok((await near(BUYER, SELLER2)).length === 0, "no cart from this seller: no spots");
  await buy(BUYER, 40, 4000);
  await buy(BUYER, 41, 2500);
  const list = await near(BUYER, SELLER2);
  ok(list.length === 1 && list[0].id === globalThis.S1 && Number(list[0].miles) < 2,
    `the cart sees only the active spot nearby (${JSON.stringify(list.map((s) => [s.name, s.miles]))})`);
  ok(!list.some((s) => s.id === globalThis.SFAR || s.id === globalThis.SOFF), "a spot 170 miles away and a retired one are not offered");
  ok(refused(await me(BUYER, `SELECT public.declutter_set_meetup_spot('${SELLER2}', '${globalThis.SFAR}')`), /meetup_spot_unavailable/),
    "choosing a far spot is refused");
  ok(refused(await me(BUYER, `SELECT public.declutter_set_meetup_spot('${SELLER2}', '${globalThis.SOFF}')`), /meetup_spot_unavailable/),
    "choosing a retired spot is refused");
  ok(refused(await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'meetup')`), /meetup_spot_needed/),
    "checkout 'meetup' with no spot chosen is refused");
  ok(one(await me(BUYER, `SELECT public.declutter_set_meetup_spot('${SELLER2}', '${globalThis.S1}')`)) === globalThis.S1, "the buyer chooses the spot");
  ok((await near(BUYER, SELLER2))[0]?.chosen === true, "the chosen spot reads as chosen");
}

// M3. Checkout 'meetup': the switch, the snapshot, the fee as a pickup's, idempotent.
let M;
{
  await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'`);
  ok(refused(await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'meetup')`), /feature_disabled/),
    "with Declutter switched off, a meetup checkout is refused");
  await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);
  const r = await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'meetup')`);
  M = Array.isArray(r) ? r[0] : null;
  ok(!!M?.order_id, `checkout 'meetup' opens one order for both lines${M ? "" : `: ${JSON.stringify(r)}`}`);
  ok(M?.items_cents === 6500 && M?.delivery_cents === 0 && M?.premium_cents === FEE(6500, 0),
    `the fee is a pickup's: items $65, no delivery (${M?.premium_cents})`);
  const snap = (await svc(`SELECT * FROM public.declutter_order_meetups WHERE order_id = '${M?.order_id}'`))?.[0];
  ok(snap?.spot_id === globalThis.S1 && snap?.spot_name === "BRPD Safe Exchange Zone", "the spot is frozen on the order");
  const again = await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'meetup')`);
  ok(Array.isArray(again) && again[0]?.order_id === M?.order_id, "the same lines and spot hand back the same order (idempotent)");
  await saveSpot(ADMIN, globalThis.S1, "Renamed later", 30.46, -91.14);
  ok((await svc(`SELECT spot_name FROM public.declutter_order_meetups WHERE order_id = '${M?.order_id}'`))?.[0]?.spot_name === "BRPD Safe Exchange Zone",
    "an admin renaming the spot later never moves an agreed meeting");
  // A different spot picked before paying: the open order is superseded (its page is then closed: declutter-checkout's
  // spotChanged closes it first), and a new order freezes the new spot.
  const s2 = one(await saveSpot(ADMIN, null, "Busy grocery lot", 30.47, -91.16, true, "store"));
  ok(one(await me(BUYER, `SELECT public.declutter_set_meetup_spot('${SELLER2}', '${s2}')`)) === s2, "the buyer picks another spot before paying");
  const moved = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'meetup')`))?.[0];
  ok(!!moved?.order_id && moved.order_id !== M?.order_id, "a changed spot opens a new order");
  ok((await order(M?.order_id))?.status === "superseded", "the order with the old spot is superseded");
  ok((await svc(`SELECT spot_id FROM public.declutter_order_meetups WHERE order_id = '${moved?.order_id}'`))?.[0]?.spot_id === s2,
    "the new order freezes the new spot");
  M = moved;
  const o = await order(M?.order_id);
  ok(o?.handover === "meetup", "the order's handover is 'meetup'");
  await svc(`SELECT public.declutter_mark_order_paid('${M?.order_id}', 'pi_meet_1', ${M?.total_cents}, now(), 150)`);
  ok((await order(M?.order_id))?.status === "paid", "fixture: the meetup order is paid");
}

// M4. The home address is never shared for a meetup.
{
  const access = one(await svc(`SELECT public.declutter_address_access('${I(40)}', '${BUYER}')`));
  ok(access === null, `the paid meetup buyer gets no address access (${access})`);
  const addr = await me(BUYER, `SELECT public.declutter_item_address('${I(40)}')`);
  ok(!JSON.stringify(addr).includes("Example St"), "the item's pickup address never reaches the meetup buyer");
  ok(one(await svc(`SELECT public.declutter_address_access('${I(40)}', '${SELLER2}')`)) === "seller", "the seller still reads their own");
}

// M5. "I'm here": booked first, from an hour before, once each, the other side told; strangers refused.
{
  ok(refused(await me(BUYER, `SELECT public.declutter_meetup_here('${M?.order_id}')`), /not_booked_yet/), "check-in before a time is booked is refused");
  const b = await me(BUYER, `SELECT public.declutter_book_pickup('${M?.order_id}', ${at(12)})`);
  ok(Array.isArray(b), `the buyer books a meeting time${Array.isArray(b) ? "" : `: ${JSON.stringify(b)}`}`);
  ok(refused(await me(BUYER, `SELECT public.declutter_meetup_here('${M?.order_id}')`), /too_early_to_check_in/), "check-in a day early is refused");
  await svc(`UPDATE public.declutter_bookings SET slot_start = now() + interval '30 minutes', slot_end = now() + interval '60 minutes' WHERE order_id = '${M?.order_id}'`);
  ok(refused(await me(OUTSIDER, `SELECT public.declutter_meetup_here('${M?.order_id}')`), /item_not_found/), "a stranger cannot check in");
  ok(one(await me(BUYER, `SELECT public.declutter_meetup_here('${M?.order_id}')`)) === "here", "the buyer checks in half an hour before");
  ok(one(await me(BUYER, `SELECT public.declutter_meetup_here('${M?.order_id}')`)) === "already_here", "a second tap changes nothing");
  ok(await notes(SELLER2, "Your buyer is at the meeting spot") === 1, "the seller is told once");
  ok(one(await me(SELLER2, `SELECT public.declutter_meetup_here('${M?.order_id}')`)) === "here", "the seller checks in");
  ok(await notes(BUYER, "The seller is at the meeting spot") === 1, "the buyer is told");
  const m = (await svc(`SELECT * FROM public.declutter_order_meetups WHERE order_id = '${M?.order_id}'`))?.[0];
  ok(!!m?.buyer_here_at && !!m?.seller_here_at, "both arrivals are stamped");
}

// M6. Then the existing handover confirm: the seller's "Picked up" works at a meetup; the buyer's "I got it" too.
{
  await svc(`UPDATE public.declutter_bookings SET slot_start = now() - interval '5 minutes', slot_end = now() + interval '25 minutes' WHERE order_id = '${M?.order_id}'`);
  const pu = await me(SELLER2, `SELECT public.declutter_seller_picked_up('${M?.order_id}', NULL)`);
  ok(Array.isArray(pu) && (await order(M?.order_id))?.status === "handed_over", `the seller's "Picked up" completes a meetup${Array.isArray(pu) ? "" : `: ${JSON.stringify(pu)}`}`);
  ok(refused(await me(BUYER, `SELECT public.declutter_meetup_here('${M?.order_id}')`), /not_a_meetup/), "no check-in after the handover");
  // A second meetup order, finished by the buyer's "I got it".
  await item(42, SELLER2, 1500);
  await buy(BUYER2, 42, 1500);
  await me(BUYER2, `SELECT public.declutter_set_meetup_spot('${SELLER2}', '${globalThis.S1}')`);
  const r2 = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'meetup')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${r2?.order_id}', 'pi_meet_2', ${r2?.total_cents}, now(), 150)`);
  const got = one(await me(BUYER2, `SELECT public.declutter_confirm_handover('${r2?.order_id}', 'buyer', NULL)`));
  ok(got?.result === "handed_over", `the buyer's "I got it" completes a meetup (${JSON.stringify(got)})`);
}

// M7. A door pickup still shares the address, and is not a meetup.
{
  await item(43, SELLER2, 2000);
  await buy(BUYER3, 43, 2000);
  const p = (await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${p?.order_id}', 'pi_meet_3', ${p?.total_cents}, now(), 150)`);
  ok(one(await svc(`SELECT public.declutter_address_access('${I(43)}', '${BUYER3}')`)) === "paid_buyer", "a paid door-pickup buyer still gets the address");
  ok(refused(await me(BUYER3, `SELECT public.declutter_meetup_here('${p?.order_id}')`), /not_a_meetup/), "a door pickup has no check-in");
}

// M8. Grants.
{
  for (const fn of ["declutter_meetup_spot_near_lines(uuid, uuid[])", "declutter_my_cart_lines(uuid, uuid)", "declutter_miles_between(numeric, numeric, numeric, numeric)"]) {
    ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`)) === false, `${fn}: members cannot run it`);
  }
  ok(one(await svc(`SELECT has_function_privilege('anon', 'public.declutter_meetup_spots_near(uuid)', 'EXECUTE')`)) === false, "anon cannot list spots");
  ok(one(await svc(`SELECT has_table_privilege('authenticated', 'public.declutter_meetup_choices', 'SELECT')`)) === false, "members cannot read the choices table");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261028235247_declutter_handover_choices (owner 2026-10-28, step 4 "How can buyers get it?":
 * the seller ticks porch pickup, they deliver, a safe meeting spot, Helpr delivery; pickup at the door is gone).
 *
 * The world is the bundle-discount proof's (declutterBundleDiscount.pglite.mjs: prod's bodies, md5-checked), with
 * 20261027211754_declutter_bundle_discount applied once as this one's base (it restated declutter_start_checkout
 * last); this migration is then applied 3 times. Covers: the seller's own draft only, at least one way, only the
 * four ways, a free item porch only, porch_ok kept in step, checkout and the free checkout refusing a way an item
 * does not offer (before any order), an item listed before the choice (NULL) unchanged, the cart saying each
 * line's ways, and the grants.
 *
 *   node src/test/pglite/declutterHandoverChoices.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHandoverChoices.pglite.mjs  # RED: the migration absent
 *   TALK_MIGRATION=skip node src/test/pglite/declutterHandoverChoices.pglite.mjs # RED: 20261028235249 absent
 *
 * Then 20261028235249_declutter_handover_talk (owner 2026-10-28, Q2462 #3730: "let them chat to figure it out"),
 * applied 3 times: no fallback to the seller's door; when no way that always works is shared, the buyer and seller
 * open a private chat (contact-leak filter, rate limit, only the two of them read it), the checkout time waits
 * for it, the seller may ADD a way, and a sale that runs out after such a talk ends with no strike.
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterHandoverChoices.pglite.mjs
 *
 * Then T9, AL-6 (owner 2026-10-28, "Chats saved and filtered"): 20261029005124_declutter_admin_problem_talk, applied
 * 3 times: for a reported problem an admin reads the order's whole chat and its items' questions (removed ones marked)
 * as sides only; members, anon and an unknown problem are refused.
 *   AL6_MIGRATION=skip node src/test/pglite/declutterHandoverChoices.pglite.mjs      # RED: T9 fails
 *   AL6_PATH=<planted copy> node src/test/pglite/declutterHandoverChoices.pglite.mjs
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const DELIVERY_FILE = "20261027153244_declutter_seller_delivery.sql";
const FREE_FILE = "20261027170717_declutter_free_section.sql";
const MEETUP_FILE = "20261027204500_declutter_safe_meetup.sql";
const BUNDLE_FILE = "20261027211754_declutter_bundle_discount.sql";
const NEW_FILE = "20261028235247_declutter_handover_choices.sql";
const TALK_FILE = "20261028235249_declutter_handover_talk.sql";
const skipTalk = process.env.TALK_MIGRATION === "skip" || process.env.NEW_MIGRATION === "skip";
// AL-6 (owner 2026-10-28): the admin's read of a problem's chat and questions, applied 3x in T9.
// AL6_MIGRATION=skip leaves it out (T9 is RED); AL6_PATH=<planted copy> applies a planted one.
const AL6_FILE = "20261029005124_declutter_admin_problem_talk.sql";
const al6Sql = process.env.AL6_MIGRATION === "skip" ? "" : readFileSync(process.env.AL6_PATH ?? `${MIG_DIR}${AL6_FILE}`, "utf8");
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
const { SELLER, SELLER2, SELLER3, BUYER, BUYER2, BUYER3, OUTSIDER, ADMIN } = USERS;
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
{
  const r = await run(readFileSync(`${MIG_DIR}${BUNDLE_FILE}`, "utf8"));
  ok(!r?.error, `the bundle-discount migration (this one's base) applies${r?.error ? `: ${r.error}` : ""}`);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}
if (!skipTalk) {
  const sql = readFileSync(process.env.TALK_PATH ?? `${MIG_DIR}${TALK_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the handover-talk migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
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
// Owner 2026-10-28: the seller ticks the ways. SELLER3 sells; BUYER buys.
const co = async (uid, seller, handover = "pickup_home") => (await me(uid, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}')`))?.[0];
const itemFloor = (n, seller, price, floor) => db.exec(liveItemSql({ id: I(n), seller, title: `Handover item ${n}`, price, floor }));
const ways = (uid, n, arr) => me(uid, `SELECT public.declutter_set_handovers('${I(n)}', ${arr === null ? "NULL" : `ARRAY[${arr.map((w) => `'${w}'`).join(",")}]::text[]`}) AS r`);
const itemRow = async (n) => (await svc(`SELECT status, porch_ok, handovers FROM public.declutter_items WHERE id = '${I(n)}'`))?.[0];
const draft = async (n, seller, price) => {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Handover item ${n}`, price, floor: price === 0 ? 0 : Math.min(price, 100) }));
  await svc(`UPDATE public.declutter_items SET status = 'draft' WHERE id = '${I(n)}'`);
};
// The ways of a LIVE fixture item, set as a draft (the table freezes them once listed), then live again.
const setWays = async (n, arr) => {
  await svc(`UPDATE public.declutter_items SET status = 'draft' WHERE id = '${I(n)}'`);
  await svc(`UPDATE public.declutter_items SET handovers = ARRAY[${arr.map((w) => `'${w}'`).join(",")}]::text[], porch_ok = ${arr.includes("porch")} WHERE id = '${I(n)}'`);
  await svc(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(n)}'`);
};

// H1. The seller's choice, on their own draft.
await draft(70, SELLER3, 4000);
{
  const r = await ways(SELLER3, 70, ["meetup", "porch", "porch"]);
  ok(Array.isArray(r) && JSON.stringify(r[0]?.r) === JSON.stringify(["meetup", "porch"]), `the seller ticks porch + meetup (stored once each, ordered: ${JSON.stringify(r?.[0]?.r ?? r)})`);
  ok((await itemRow(70))?.porch_ok === true, "porch_ok follows the porch tick");
  await ways(SELLER3, 70, ["seller_delivery", "delivery"]);
  ok((await itemRow(70))?.porch_ok === false, "untick porch: porch_ok goes off with it");
  ok(refused(await ways(SELLER3, 70, []), /invalid_handovers/), "none ticked is refused");
  ok(refused(await ways(SELLER3, 70, null), /invalid_handovers/), "NULL is refused");
  ok(refused(await ways(SELLER3, 70, ["pickup_home"]), /invalid_handovers/), "pickup at the door can no longer be ticked");
  ok(refused(await ways(SELLER3, 70, ["porch", "teleport"]), /invalid_handovers/), "an unknown way is refused");
  ok(refused(await ways(SELLER2, 70, ["porch"]), /item_not_found/), "another seller's item is item_not_found");
  ok(refused(await ways(OUTSIDER, 70, ["porch"]), /feature_disabled/), "an account the switch is off for is refused (feature_disabled)");
  ok(refused(await anon(`SELECT public.declutter_set_handovers('${I(70)}', ARRAY['porch'])`), /permission denied/), "anon cannot call it");
  await draft(71, SELLER3, 0);
  ok(refused(await ways(SELLER3, 71, ["porch", "meetup"]), /invalid_handovers/), "a free item: only porch pickup");
  ok(Array.isArray(await ways(SELLER3, 71, ["porch"])), "a free item: porch pickup is accepted");
  await svc(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(70)}'`);
  // A way that leaves porch_ok as it is: the RPC's own draft check, not only the porch freeze trigger.
  ok(refused(await ways(SELLER3, 70, ["delivery"]), /item_not_editable/), "after it is listed the ways are frozen (as porch_ok)");
  const bad = await run(`UPDATE public.declutter_items SET handovers = ARRAY['teleport'] WHERE id = '${I(71)}'`);
  ok(/declutter_items_handovers_check/.test(bad?.error ?? ""), "the table refuses a way that does not exist");
  const empty = await run(`UPDATE public.declutter_items SET handovers = ARRAY[]::text[] WHERE id = '${I(71)}'`);
  ok(/declutter_items_handovers_check/.test(empty?.error ?? ""), "the table refuses an empty set");
}

// H2. Checkout refuses a way the item does not offer, before any order.
await itemFloor(72, SELLER3, 3000, 100);
await setWays(72, ["porch", "meetup"]);
{
  await buy(BUYER2, 72, 3000);
  const before = (await ordersOf(BUYER2, SELLER3)).length;
  ok(refused(await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER3}', 'pickup_home')`), /handover_not_offered/),
    "pickup at the door, not ticked: refused (handover_not_offered)");
  ok(refused(await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER3}', 'delivery')`), /handover_not_offered/),
    "Helpr delivery, not ticked: refused");
  ok((await ordersOf(BUYER2, SELLER3)).length === before, "a refused way makes no order");
  const cart = await me(BUYER2, `SELECT item_id, handovers FROM public.declutter_my_cart() WHERE item_id = '${I(72)}'`);
  ok(Array.isArray(cart) && JSON.stringify(cart[0]?.handovers) === JSON.stringify(["porch", "meetup"]), `the cart says the line's ways (${JSON.stringify(cart?.[0] ?? cart)})`);
  const p = await co(BUYER2, SELLER3, "porch");
  ok(p?.order_id, `porch pickup, ticked: the checkout opens (${JSON.stringify(p ?? null).slice(0, 80)})`);
  // Reusing that open order is no way around it.
  ok(refused(await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER3}', 'pickup_home')`), /handover_not_offered/),
    "with an order open, an unticked way is still refused");
}

// H2b. Owner 2026-10-28 (Q2462 #3730): no fallback to the seller's door. Only conditional ways ticked (a meetup
// needs a spot near): the home is refused; porch is still the seller's porch_ok; Helpr delivery, not ticked, refused.
await itemFloor(75, SELLER2, 2000, 100);
await setWays(75, ["meetup"]);
{
  await buy(BUYER, 75, 2000);
  ok(refused(await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'delivery')`), /handover_not_offered/),
    "meetup only: Helpr delivery, not ticked, refused");
  ok(refused(await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`), /porch_unavailable/),
    "meetup only: porch refused (porch_ok follows the ticks)");
  ok(refused(await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`), /handover_not_offered/),
    "meetup only: pickup at the seller's home is no fallback any more (refused)");
}
// Two lines that share no way: no way at all is open (the buyer and seller talk it through, below).
await itemFloor(76, SELLER, 1500, 100);
await itemFloor(77, SELLER, 1500, 100);
await setWays(76, ["porch"]);
await setWays(77, ["delivery"]);
{
  await buy(BUYER3, 76, 1500);
  await buy(BUYER3, 77, 1500);
  for (const w of ["delivery", "porch", "pickup_home"]) {
    const r = await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER}', '${w}')`);
    ok(refused(r, /handover_not_offered|porch_unavailable/), `two lines sharing no way: ${w} is refused (${JSON.stringify(r).slice(0, 60)})`);
  }
}

// An older item with porch off plus a new one ticked porch + Helpr delivery (re-review should-fix 2): porch is not
// shared (the older item's porch is off) and the home is not either (the new item did not tick it): Helpr delivery.
await itemFloor(81, SELLER3, 1200, 100);
await svc(`UPDATE public.declutter_items SET status = 'draft' WHERE id = '${I(81)}'`);
await svc(`UPDATE public.declutter_items SET porch_ok = false WHERE id = '${I(81)}'`);
await svc(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(81)}'`);
await itemFloor(82, SELLER3, 1200, 100);
await setWays(82, ["porch", "delivery"]);
{
  await buy(BUYER, 81, 1200);
  await buy(BUYER, 82, 1200);
  ok(refused(await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER3}', 'pickup_home')`), /handover_not_offered/),
    "an older porch-off item + a porch/delivery item: the home is refused (not shared)");
}

// H2c. In the table: frozen once listed; porch_ok changed another way moves the porch tick, never to no way.
{
  const frozen = await run(`UPDATE public.declutter_items SET handovers = ARRAY['delivery'] WHERE id = '${I(72)}'`);
  ok(/item_not_editable/.test(frozen?.error ?? ""), "a listed item's ways cannot change (frozen in the table)");
  await draft(78, SELLER3, 4000);
  await ways(SELLER3, 78, ["porch", "delivery"]);
  ok(one(await me(SELLER3, `SELECT public.declutter_set_porch_ok('${I(78)}', false)`)) === false, "the old porch switch still works");
  ok(JSON.stringify((await itemRow(78))?.handovers) === JSON.stringify(["delivery"]), `...and takes porch out of the ticks (${JSON.stringify((await itemRow(78))?.handovers)})`);
  await draft(79, SELLER3, 0);
  await ways(SELLER3, 79, ["porch"]);
  ok(refused(await me(SELLER3, `SELECT public.declutter_set_porch_ok('${I(79)}', false)`), /invalid_handovers/),
    "porch off on an item whose only way is porch is refused (never no way)");
}

// H3. An item listed before the choice (NULL) keeps every way, as before.
await itemFloor(73, SELLER2, 2500, 100);
{
  await buy(BUYER3, 73, 2500);
  ok((await itemRow(73))?.handovers === null, "an older item has no recorded ways");
  const r = await co(BUYER3, SELLER2, "pickup_home");
  ok(r?.order_id, "an older item: pickup at the door still checks out");
}

// H4. The free checkout refuses a way the free item does not offer.
await db.exec(liveItemSql({ id: I(74), seller: SELLER3, title: "Free handover item", price: 0, floor: 0 }));
await setWays(74, ["porch"]);
{
  ok(Array.isArray(await claim(BUYER3, 74)), "a buyer claims the free item");
  ok(refused(await freeOut(BUYER3, SELLER3, "pickup_home"), /handover_not_offered/), "free: pickup at the door, not ticked, refused");
  const okFree = await freeOut(BUYER3, SELLER3, "porch");
  ok(Array.isArray(okFree), `free: porch pickup, ticked, goes through${Array.isArray(okFree) ? "" : `: ${okFree.error}`}`);
}
// H4b. A priced item made free on day 12 (Q2430) with only Helpr delivery ticked: the free checkout takes porch or
// the home only, and neither is ticked: refused (they talk; the seller adds porch pickup, below).
await db.exec(liveItemSql({ id: I(80), seller: SELLER2, title: "Made free on day 12", price: 0, floor: 0 }));
await setWays(80, ["delivery"]);
{
  ok(Array.isArray(await claim(BUYER2, 80)), "a buyer claims the item made free");
  ok(refused(await freeOut(BUYER2, SELLER2, "pickup_home"), /handover_not_offered/), "made free with only delivery ticked: the home is refused");
}

// H5. Grants.
{
  const acl = one(await svc(`SELECT proacl::text FROM pg_proc WHERE proname = 'declutter_set_handovers'`)) ?? "";
  ok(/authenticated=X/.test(acl) && !/anon=X/.test(acl) && !/(^|[{,])=X/.test(acl), `declutter_set_handovers: authenticated only (${acl})`);
}


// ---------------------------------------------------------------------------------------------------------------
// T. 20261028235249: the private handover chat (owner 2026-10-28, Q2462 #3730 "let them chat to figure it out").
if (process.env.NEW_MIGRATION !== "skip") { // runs with TALK_MIGRATION=skip too, so that run is RED
  const openTalk = (uid, other) => me(uid, `SELECT public.declutter_open_handover_talk('${other}') AS id`);
  const send = (uid, talk, body) => me(uid, `SELECT public.declutter_send_handover_message('${talk}', $$${body}$$) AS id`);
  const line = async (buyer, n) => (await svc(`SELECT status, checkout_by, reminded_24h_at FROM public.declutter_cart_items WHERE buyer_id = '${buyer}' AND item_id = '${I(n)}' ORDER BY created_at DESC LIMIT 1`))?.[0];
  const strikes = async (uid) => one(await svc(`SELECT count(*)::int FROM public.declutter_strikes WHERE user_id = '${uid}'`));

  // T1. A sure way shared (porch): no talk needed, the buyer checks out with it.
  await itemFloor(90, SELLER3, 1500, 100);
  await setWays(90, ["porch", "meetup"]);
  await buy(BUYER2, 90, 1500);
  ok(refused(await openTalk(BUYER2, SELLER3), /handover_way_open/), "porch pickup shared: no talk (the buyer can check out with it)");

  // T2. BUYER3's two SELLER lines share no way (76 porch, 77 delivery): the talk opens, from either side.
  const before = await line(BUYER3, 77);
  const t = await openTalk(BUYER3, SELLER);
  const talkId = Array.isArray(t) ? t[0]?.id : null;
  ok(!!talkId, `no shared way: the buyer opens the talk (${JSON.stringify(t).slice(0, 80)})`);
  ok(one(await openTalk(SELLER, BUYER3)) === talkId, "the seller opening it gets the same talk (one per pair)");
  const after = await line(BUYER3, 77);
  ok(new Date(after.checkout_by) > new Date(before.checkout_by) && new Date(after.checkout_by) > new Date(Date.now() + 71 * 3600e3),
    `the checkout time waits for the talk (72 h: ${iso(before.checkout_by)} -> ${iso(after.checkout_by)})`);
  {
    const o = await openTalk(BUYER, SELLER);
    ok(refused(o, /no_agreed_sale/), `a member with no agreed sale with them cannot open one (${JSON.stringify(o).slice(0, 90)})`);
    ok(refused(await openTalk(OUTSIDER, SELLER), /feature_disabled/), "an account without Declutter is refused (the switch)");
  }
  ok(refused(await anon(`SELECT public.declutter_open_handover_talk('${SELLER}')`), /permission denied/), "anon cannot open one");

  // T3. Messages: the two of them only, the contact-leak filter, the rate limit, a notice without the words.
  ok(Array.isArray(await send(BUYER3, talkId, "Could you add a safe meeting spot near the library?")), "the buyer sends a message");
  ok(Array.isArray(await send(SELLER, talkId, "Sure, I will add porch pickup instead.")), "the seller answers");
  ok(refused(await send(BUYER3, talkId, "text me at 225-555-0142"), /check_violation|phone|contact/i), "a phone number is refused (contact-leak filter)");
  // The refusal is in words the app shows as they are (src/lib/declutter/errors.ts passes a 23514 that says
  // "Keep contact details and payment out"), never the generic "Check the details" copy.
  { const o = await send(BUYER3, talkId, "email me at someone@example.com"); ok(refused(o, /Keep contact details and payment out of the chat/), `an email is refused in words the app shows (${JSON.stringify(o).slice(0, 140)})`); }
  { const o = await send(BUYER2, talkId, "hello"); ok(refused(o, /talk_not_found/), `another member cannot write in it (${JSON.stringify(o).slice(0, 90)})`); }
  ok(refused(await send(BUYER3, talkId, "   "), /invalid_message/), "an empty message is refused");
  const seen = await me(BUYER2, `SELECT count(*)::int AS n FROM public.declutter_handover_talk_messages WHERE talk_id = '${talkId}'`);
  ok(Array.isArray(seen) && seen[0].n === 0, "another member reads none of it (RLS)");
  const seenTalk = await me(BUYER2, `SELECT count(*)::int AS n FROM public.declutter_handover_talks WHERE id = '${talkId}'`);
  ok(Array.isArray(seenTalk) && seenTalk[0].n === 0, "another member cannot see the talk exists (RLS)");
  const sellerSees = await me(SELLER, `SELECT count(*)::int AS n FROM public.declutter_handover_talk_messages WHERE talk_id = '${talkId}'`);
  ok(Array.isArray(sellerSees) && sellerSees[0].n === 2, `the seller reads the two messages (${JSON.stringify(sellerSees)})`);
  const mine = await me(BUYER3, `SELECT count(*)::int AS n FROM public.declutter_handover_talk_messages WHERE talk_id = '${talkId}'`);
  ok(Array.isArray(mine) && mine[0].n === 2, `the buyer reads the two messages (${JSON.stringify(mine)})`);
  ok(refused(await me(BUYER3, `INSERT INTO public.declutter_handover_talk_messages (talk_id, sender_id, body) VALUES ('${talkId}', '${BUYER3}', 'x')`), /permission denied/),
    "nobody writes the table directly");
  const note = await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'New message about a handover'`);
  ok(Array.isArray(note) && note.length === 1 && !/library/.test(note[0].message), `the seller is told once, without the words (${JSON.stringify(note).slice(0, 120)})`);
  // The notices open the recipient's own tab with the chat on it (DeclutterPage reads ?talk=), never a route that
  // does not exist (the WIP's /declutter/talk/<id>).
  { const l = await svc(`SELECT link FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'New message about a handover'`);
    ok(Array.isArray(l) && l[0]?.link === `/declutter?tab=selling&talk=${talkId}`, `the seller's notice opens Selling with the chat (${JSON.stringify(l)})`); }
  { const l = await svc(`SELECT link FROM public.notifications WHERE user_id = '${BUYER3}' AND title = 'New message about a handover'`);
    ok(Array.isArray(l) && l[0]?.link === `/declutter?tab=buying&talk=${talkId}`, `the buyer's notice opens Buying with the chat (${JSON.stringify(l)})`); }
  await svc(`INSERT INTO public.declutter_handover_talk_messages (talk_id, sender_id, body, created_at)
    SELECT '${talkId}', '${BUYER3}', 'm' || g, now() - interval '1 minute' FROM generate_series(1, 29) g`);
  ok(refused(await send(BUYER3, talkId, "one more"), /message_rate_limited/), "31 messages in an hour: refused");

  // T4. While they talk, no reminder says "or you get a strike".
  await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() + interval '20 hours', reminded_24h_at = NULL WHERE buyer_id = '${BUYER3}' AND seller_id = '${SELLER}' AND status = 'in_cart'`);
  await svc(`SELECT public.declutter_deadline_sweep()`);
  ok((await line(BUYER3, 77)).reminded_24h_at === null, "no 24-hour strike reminder while they talk it through");

  // T5. The seller adds a way (never takes one away): porch on 77; the buyer gets a day and checks out with porch.
  ok(refused(await me(SELLER, `SELECT public.declutter_add_handover('${I(77)}', 'pickup_home')`), /invalid_handovers/), "the seller cannot add pickup at the door");
  ok(refused(await me(BUYER3, `SELECT public.declutter_add_handover('${I(77)}', 'porch')`), /item_not_found/), "only the seller adds a way");
  const add = await me(SELLER, `SELECT public.declutter_add_handover('${I(77)}', 'porch') AS w`);
  ok(Array.isArray(add) && JSON.stringify(add[0].w) === JSON.stringify(["delivery", "porch"]), `the seller adds porch pickup (${JSON.stringify(add)})`);
  ok(new Date((await line(BUYER3, 77)).checkout_by) > new Date(Date.now() + 23 * 3600e3), "the buyer has at least 24 hours to check out with it");
  ok(/item_not_editable/.test((await run(`UPDATE public.declutter_items SET handovers = ARRAY['porch'] WHERE id = '${I(77)}'`))?.error ?? ""),
    "a listed item still cannot lose a way");
  const paid = await co(BUYER3, SELLER, "porch");
  ok(paid?.order_id, `with porch shared now, the buyer checks out with porch (${JSON.stringify(paid ?? null).slice(0, 60)})`);

  // T6. No way added and the time runs out after the talk: the sale ends, NO strike for anyone, the item back on sale.
  await itemFloor(91, SELLER2, 1800, 100);
  await setWays(91, ["meetup"]);
  await buy(BUYER3, 91, 1800);
  const t6 = one(await openTalk(SELLER2, BUYER3));
  ok(!!t6, "meetup only, no spot: the seller opens the talk");
  const s0 = [await strikes(BUYER3), await strikes(SELLER2)];
  await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE buyer_id = '${BUYER3}' AND item_id = '${I(91)}' AND status = 'in_cart'`);
  await svc(`UPDATE public.declutter_handover_talks SET expires_at = now() - interval '1 minute' WHERE id = '${t6}'`);
  await svc(`SELECT public.declutter_deadline_sweep()`);
  ok((await line(BUYER3, 91)).status === "missed", "the line ends");
  ok((await strikes(BUYER3)) === s0[0] && (await strikes(SELLER2)) === s0[1], "nobody gets a strike");
  ok((await itemRow(91))?.status === "live", "the item is back on sale");
  ok((await notes(BUYER3, "Sale ended, no strike")) === 1, "the buyer is told");
  ok(one(await svc(`SELECT (closed_at IS NOT NULL)::text FROM public.declutter_handover_talks WHERE id = '${t6}'`)) === "true", "the talk past 72 hours closed");
  {
    // A new sale between the same two within the week: still no second talk (the wait cannot be stretched).
    await itemFloor(93, SELLER2, 1800, 100);
    await setWays(93, ["meetup"]);
    await buy(BUYER3, 93, 1800);
    const again = await openTalk(BUYER3, SELLER2);
    ok(refused(again, /talk_recently_closed/), `no second talk the same week (${JSON.stringify(again).slice(0, 80)})`);
  }

  // T7. No talk at all: a missed checkout is still the buyer's strike (the talk is the only no-strike way out).
  await itemFloor(92, SELLER2, 1800, 100);
  await setWays(92, ["meetup"]);
  await buy(BUYER2, 92, 1800);
  const b0 = await strikes(BUYER2);
  await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE buyer_id = '${BUYER2}' AND item_id = '${I(92)}' AND status = 'in_cart'`);
  await svc(`SELECT public.declutter_deadline_sweep()`);
  ok((await strikes(BUYER2)) === b0 + 1, "no talk opened: the missed checkout is a strike, as before");

  // T9. AL-6 (owner 2026-10-28, "Chats saved and filtered"): the chat and the item questions are kept and an admin
  // reads them for a reported problem, as sides only, never a name or id (declutter_admin_problem_talk).
  if (al6Sql !== null) { // always: AL6_MIGRATION=skip runs T9 against no migration, so it is RED
    for (let i = 1; i <= 3; i++) {
      const r = await run(al6Sql);
      ok(!r?.error, `the AL-6 admin chat read applies (run ${i} of 3)${r?.error ? `: ${r.error}` : ""}`);
    }
    const orderId = paid.order_id;
    await svc(`UPDATE public.declutter_orders SET status = 'paid', paid_at = now() WHERE id = '${orderId}'`);
    const pid = one(await svc(`INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note)
      VALUES ('${orderId}', '${BUYER3}', 'buyer', 'not_received', 'It was not on the porch') RETURNING id`));
    ok(!!pid, `a problem is reported on the order the talk was about (${pid})`);
    // The item's questions: the buyer's (answered) and another member's (removed later); both kept for the admin.
    await svc(`INSERT INTO public.declutter_questions (item_id, asker_id, question, answer, answered_at, created_at)
      VALUES ('${I(77)}', '${BUYER3}', 'Does the lamp work?', 'Yes, new bulb.', now(), now() - interval '2 days')`);
    await svc(`INSERT INTO public.declutter_questions (item_id, asker_id, question, removed_at, created_at)
      VALUES ('${I(77)}', '${BUYER2}', 'Is it heavy?', now(), now() - interval '1 day')`);
    // A talk between the same two about an EARLIER sale (before this order's lines were in the cart): not this order's.
    await svc(`INSERT INTO public.declutter_handover_talks (id, buyer_id, seller_id, opened_by, opened_at, expires_at, closed_at)
      VALUES ('99999999-0000-0000-0000-000000000001', '${BUYER3}', '${SELLER}', '${BUYER3}', now() - interval '40 days', now() - interval '37 days', now() - interval '37 days')`);
    await svc(`INSERT INTO public.declutter_handover_talk_messages (talk_id, sender_id, body, created_at)
      VALUES ('99999999-0000-0000-0000-000000000001', '${BUYER3}', 'an older sale', now() - interval '40 days')`);
    const rows = await me(ADMIN, `SELECT * FROM public.declutter_admin_problem_talk('${pid}')`);
    ok(Array.isArray(rows), `an admin reads the problem's chat and questions (${JSON.stringify(rows).slice(0, 120)})`);
    const chat = Array.isArray(rows) ? rows.filter((r) => r.kind === "chat") : [];
    const qs = Array.isArray(rows) ? rows.filter((r) => r.kind === "question") : [];
    const kept = one(await svc(`SELECT count(*)::int FROM public.declutter_handover_talk_messages WHERE talk_id = '${talkId}'`));
    ok(chat.length === kept && kept >= 31, `every message of the order's talk is there, none dropped (${chat.length} of ${kept})`);
    ok(Array.isArray(rows) && rows.every((r, i) => i === 0 || new Date(rows[i - 1].said_at) <= new Date(r.said_at)), "oldest first");
    ok(chat.some((r) => r.side === "buyer" && /library/.test(r.body)), "the buyer's message as \"buyer\"");
    ok(chat.some((r) => r.side === "seller" && /porch pickup instead/.test(r.body)), "the seller's answer as \"seller\"");
    ok(!chat.some((r) => /older sale/.test(r.body)), "a talk about an earlier sale between the same two is left out");
    ok(!chat.some((r) => /225-555-0142|example\.com/.test(r.body)), "the refused contact details were never stored");
    ok(qs.length === 2 && qs[0].side === "buyer" && qs[0].answer === "Yes, new bulb." && !qs[0].removed, `the buyer's answered question (${JSON.stringify(qs[0])})`);
    ok(qs[1]?.side === "another_member" && qs[1]?.removed === true, `another member's removed question, kept and marked (${JSON.stringify(qs[1])})`);
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    ok(Array.isArray(rows) && rows.every((r) => !uuidRe.test(JSON.stringify(r))), "no row carries a member id");
    ok(Array.isArray(rows) && rows.every((r) => Object.keys(r).sort().join() === "answer,answered_at,body,kind,removed,said_at,side"),
      `only the seven columns, no name or address (${Array.isArray(rows) && rows[0] ? Object.keys(rows[0]).join() : ""})`);
    ok(refused(await me(BUYER3, `SELECT * FROM public.declutter_admin_problem_talk('${pid}')`), /not_admin/), "the buyer cannot read it here");
    ok(refused(await me(SELLER, `SELECT * FROM public.declutter_admin_problem_talk('${pid}')`), /not_admin/), "the seller cannot read it here");
    ok(refused(await anon(`SELECT * FROM public.declutter_admin_problem_talk('${pid}')`), /permission denied/), "anon cannot call it");
    ok(refused(await me(ADMIN, `SELECT * FROM public.declutter_admin_problem_talk('99999999-0000-0000-0000-0000000000ff')`), /problem_not_found/),
      "an unknown problem: problem_not_found");
    const acl = one(await svc(`SELECT proacl::text FROM pg_proc WHERE proname = 'declutter_admin_problem_talk'`)) ?? "";
    ok(/authenticated=X/.test(acl) && !/anon=X/.test(acl) && !/(^|[{,])=X/.test(acl), `declutter_admin_problem_talk: no PUBLIC or anon (${acl})`);
  }

  // T8. Grants.
  for (const fn of ["declutter_open_handover_talk", "declutter_send_handover_message", "declutter_add_handover"]) {
    const acl = one(await svc(`SELECT proacl::text FROM pg_proc WHERE proname = '${fn}'`)) ?? "";
    ok(/authenticated=X/.test(acl) && !/anon=X/.test(acl) && !/(^|[{,])=X/.test(acl), `${fn}: members only (${acl})`);
  }
  for (const fn of ["declutter_pair_shared_ways", "declutter_pair_needs_talk", "declutter_pair_talking"]) {
    const acl = one(await svc(`SELECT proacl::text FROM pg_proc WHERE proname = '${fn}'`)) ?? "";
    ok(!/authenticated=X/.test(acl) && !/anon=X/.test(acl) && !/(^|[{,])=X/.test(acl), `${fn}: definer use only (${acl})`);
  }
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

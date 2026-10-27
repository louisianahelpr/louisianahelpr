#!/usr/bin/env node
/**
 * PGlite proof for 20261027170717_declutter_free_section (owner 2026-10-27: a Free section for the
 * Declutter launch; lead decisions).
 *
 * The world is the seller-delivery proof's (prod's bodies, md5-checked, then the setup-fee and board 141d
 * migrations), plus 20261027153244_declutter_seller_delivery once; then the free migration is applied 3
 * times (replay-safe). Covers: the price CHECKs (0 or $1-$1,000, never 1-99 cents; a free item stays
 * free), listing free without payout setup, claiming without a card and the 3-claim limit, buy/offer
 * refused on a free item, a $0 order never reaching a payment page (no fee, no setup fee), the free order
 * paid-equivalent at once with no payout row after the handover, a missed free pickup closing with a strike
 * and no refund, a mixed cart's fee on the paid lines only, and no refund request on a free order.
 *
 *   node src/test/pglite/declutterFreeSection.pglite.mjs                      # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFreeSection.pglite.mjs   # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterFreeSection.pglite.mjs
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const DELIVERY_FILE = "20261027153244_declutter_seller_delivery.sql";
const NEW_FILE = "20261027170717_declutter_free_section.sql";
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
    payout_id uuid NOT NULL, marked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (payout_kind, payout_id));`);
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

// 1. The CHECKs: $0 or $1-$1,000, never 1-99 cents; a free item stays free.
ok(one(await svc(`SELECT (public.declutter_free_rules() ->> 'max_open_claims')::int`)) === 3, "the rule: 3 open free claims per buyer");
ok(refused(await run(liveItemSql({ id: I(90), seller: SELLER, price: 50, floor: 50 })), /price_cap/), "an item at 50 cents is refused (1-99 cents never)");
ok(refused(await run(liveItemSql({ id: I(91), seller: SELLER, price: 99, floor: 99 })), /price_cap/), "an item at 99 cents is refused");
await item(9, SELLER, 1500);
ok(refused(await svc(`UPDATE public.declutter_items SET current_price_cents = 0 WHERE id = '${I(9)}'`), /free_whole/),
  "a priced item can never drop to $0 (it stays priced)");
await item(1, SELLER, 0);
// Fixture: the seller turned porch off for this item (declutter_set_porch_ok works on drafts only; set directly).
ok(!(await run(`SET session_replication_role = replica; UPDATE public.declutter_items SET porch_ok = false WHERE id = '${I(1)}'; SET session_replication_role = origin;`))
  && one(await svc(`SELECT porch_ok FROM public.declutter_items WHERE id = '${I(1)}'`)) === false, "fixture: porch is off for the first free item");
ok(one(await svc(`SELECT current_price_cents FROM public.declutter_items WHERE id = '${I(1)}'`)) === 0, "a free item: price 0, current price 0, floor 0");
ok(refused(await svc(`UPDATE public.declutter_items SET price_cents = 500 WHERE id = '${I(1)}'`), /free_whole/), "a free item stays free (price and current price move together)");
ok(refused(await svc(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, checkout_by)
  VALUES ('${I(1)}', '${BUYER}', '${SELLER}', 50, 'buy', now() + interval '1 day')`), /price_cap/), "a 50-cent cart line is refused");

// 2. Listing free: create, and never a payout-setup gate for a free item.
const created = await me(SELLER, `SELECT public.declutter_create_item('Free lamp', 'Works.', 'furniture', 4, 'small', 0, 0, 'Mid-City', '12 Oak St, Baton Rouge, LA 70806', 30.45, -91.15) AS id`);
ok(Array.isArray(created) && !!one(created), `create_item lists a free item (price 0, floor 0)${Array.isArray(created) ? "" : `: ${JSON.stringify(created)}`}`);
ok(refused(await me(SELLER, `SELECT public.declutter_create_item('Free lamp', 'Works.', 'furniture', 4, 'small', 0, 500, 'Mid-City', '12 Oak St, Baton Rouge, LA 70806', 30.45, -91.15)`), /invalid_floor_price/),
  "a free item with a lowest price is refused");
ok(refused(await me(SELLER, `SELECT public.declutter_create_item('Cheap lamp', 'Works.', 'furniture', 4, 'small', 50, 50, 'Mid-City', '12 Oak St, Baton Rouge, LA 70806', 30.45, -91.15)`), /price_cap|invalid_floor_price/),
  "a 50-cent listing is refused");
await item(2, NOPAYOUT, 0);
await item(3, NOPAYOUT, 2000);
await svc(`UPDATE public.declutter_items SET status = 'paused' WHERE id IN ('${I(2)}', '${I(3)}')`);
const relFree = await me(NOPAYOUT, `SELECT public.declutter_relist_listing('${I(2)}')`);
ok(Array.isArray(relFree), `a seller with no payout setup puts a FREE item back up (nothing is owed)${Array.isArray(relFree) ? "" : `: ${JSON.stringify(relFree)}`}`);
ok(Array.isArray(await me(NOPAYOUT, `SELECT public.declutter_relist_listing('${I(3)}')`)), "  and a priced one (20261027163240: listing never asks for payouts)");

// 2b. The one-time setup fee (owner 2026-10-27, "No fee for free listings"): a member who never paid it lists a FREE
// item with nothing charged; their next PAID listing still asks for it (setup_fee_required_to_list). The listing goes
// up as the member (auth.uid() = the seller, the trigger's own test), straight from INSERT.
const asSeller = async (uid, sql) => {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}';`);
    await db.exec(sql);
    return null;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET request.jwt.claim.sub;`);
  }
};
await svc(`UPDATE public.profiles SET onboarding_fee_paid = false WHERE user_id = '${SELLER2}'`);
ok(one(await svc(`SELECT public.declutter_setup_fee_due_cents('${SELLER2}')`)) === 200, "fixture: this seller never paid the $2 setup fee");
const freeFirst = await asSeller(SELLER2, liveItemSql({ id: I(60), seller: SELLER2, title: "Free first listing", price: 0, floor: 0 }));
ok(freeFirst === null, `a FIRST listing that is free goes up and charges nothing${freeFirst ? `: ${freeFirst.error}` : ""}`);
ok(one(await svc(`SELECT onboarding_fee_paid FROM public.profiles WHERE user_id = '${SELLER2}'`)) === false
  && one(await svc(`SELECT public.declutter_setup_fee_due_cents('${SELLER2}')`)) === 200, "  and the fee is still owed, untouched");
ok(refused(await asSeller(SELLER2, liveItemSql({ id: I(61), seller: SELLER2, title: "Paid next listing", price: 2500, floor: 2500 })), /setup_fee_required_to_list/),
  "the next PAID listing still asks for the $2 setup fee (once per account, as before)");
await svc(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${SELLER2}'`);

// 3. Claiming: no card, buy and offers refused on a free item, the 3-claim limit.
ok(refused(await buy(BUYER, 1, 0), /free_item_claim_it/), "Buy is refused on a free item (it is claimed, not bought)");
ok(refused(await me(BUYER, `SELECT public.declutter_make_offer('${I(1)}', 100)`), /invalid_offer_amount/), "an offer on a free item is refused");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_claim_free('${I(1)}')`), /feature_disabled/), "an ordinary (non-tester) account cannot claim while Declutter is testers-only");
ok(refused(await anon(`SELECT public.declutter_claim_free('${I(1)}')`), /permission denied/), "anon cannot claim");
ok(refused(await me(SELLER, `SELECT public.declutter_claim_free('${I(1)}')`), /own_item/), "the seller cannot claim their own item");
await item(4, SELLER, 2000);
ok(refused(await me(NOCARD, `SELECT public.declutter_claim_free('${I(4)}')`), /not_free/), "claiming a priced item is refused");
const c1 = await claim(NOCARD, 1);
ok(Array.isArray(c1) && !!one(c1), `a buyer with NO saved card claims the free item${Array.isArray(c1) ? "" : `: ${JSON.stringify(c1)}`}`);
const line1 = (await svc(`SELECT * FROM public.declutter_cart_items WHERE item_id = '${I(1)}'`))[0];
ok(line1?.price_cents === 0 && line1.status === "in_cart" && Date.parse(line1.checkout_by) > Date.now() + 47 * 3600e3
  && one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(1)}'`)) === "reserved",
  "it is reserved to the buyer exactly like a purchase: a $0 cart line, 48 hours");
ok(refused(await claim(BUYER, 1), /item_not_available/), "a second buyer cannot claim it");
for (const n of [5, 6]) { await item(n, SELLER2, 0); await claim(NOCARD, n); }
await item(7, SELLER3, 0);
ok(refused(await claim(NOCARD, 7), /free_claim_limit/), "a 4th open free claim is refused (3 at a time)");
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(7)}'`)) === "live", "  and the item stays up for others");

// 4. A $0 order never reaches a payment page; the free checkout is paid-equivalent at once.
await svc(`UPDATE public.profiles SET onboarding_fee_paid = false WHERE user_id = '${NOCARD}'`);
ok(refused(await checkout(NOCARD, SELLER, "pickup_home"), /free_order/), "declutter_start_checkout refuses an all-free cart (no page, no fee)");
ok(refused(await freeOut(NOCARD, SELLER, "delivery"), /handover_unavailable/), "free orders cannot use Helpr delivery");
ok(refused(await freeOut(NOCARD, SELLER, "seller_delivery"), /handover_unavailable/), "  nor seller delivery");
ok(refused(await freeOut(NOCARD, SELLER, "porch"), /porch_unavailable/), "porch only where the item allows it");
const f1 = await freeOut(NOCARD, SELLER, "pickup_home");
ok(Array.isArray(f1) && !!one(f1), `the free checkout goes through${Array.isArray(f1) ? "" : `: ${JSON.stringify(f1)}`}`);
const o1 = (await ordersOf(NOCARD, SELLER)).at(-1);
ok(o1?.status === "paid" && o1.paid_with === "free" && o1.fee_rule === "free" && o1.total_cents === 0 && o1.premium_cents === 0
  && o1.items_cents === 0 && o1.setup_fee_cents === 0 && o1.stripe_checkout_session_id === null && o1.stripe_payment_intent_id === null
  && o1.card_fee_cents === 0,
  "the order: $0 everywhere, no fee, no setup fee (although this buyer never paid it), no Stripe page or payment, paid-equivalent");
ok(one(await svc(`SELECT status FROM public.declutter_cart_items WHERE item_id = '${I(1)}'`)) === "paid"
  && one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(1)}'`)) === "sold", "  its line is paid and the item sold, as after a payment");
ok(refused(await svc(`INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents, delivery_cents, total_cents, paid_with)
  VALUES ('${BUYER}', '${SELLER}', 'pickup_home', 0, 70, 0, 0, 70, 'card')`), /items_cents_check|premium_rule/), "a $0 CARD order can never exist (it would be a fee for nothing)");
ok(refused(await svc(`INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents, delivery_cents, total_cents, paid_with)
  VALUES ('${BUYER}', '${SELLER}', 'delivery', 0, 0, 0, 1000, 1000, 'free')`), /declutter_orders_free|declutter_orders_delivery/), "a free order can never carry a delivery charge");

// 5. The handover: no payout row, ever.
ok(one(await me(NOCARD, `SELECT public.declutter_confirm_handover('${o1?.id}', 'buyer', NULL)`))?.result === "handed_over", "the buyer's \"I got it\" completes the free handover");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_payouts WHERE order_id = '${o1?.id}'`)) === 0, "  and NO payout row is written (nothing is owed)");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_refunds WHERE order_id = '${o1?.id}'`)) === 0, "  and no refund row");
ok(one(await svc(`SELECT public.payout_setup_hire_allowed('${SELLER}')`)) === false,
  "  and the giver may NOT open a payout account for it (a free claim is never money owed)");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_orders WHERE seller_id = '${SELLER}' AND status = 'handed_over' AND paid_with = 'free'`)) === 1,
  "    (fixture: the giver's one handed-over order is the free one)");
ok(refused(await me(NOCARD, `SELECT public.declutter_ask_refund('${o1?.id}', 'damaged', 'It arrived broken, which the photos did not show.')`), /refund_window_over|nothing|free/),
  "no refund request on a free order (nothing was paid)");

// 6. A missed free pickup: closed with the strike rules, no refund.
const f2 = await freeOut(NOCARD, SELLER2, "pickup_home");
const o2 = (await ordersOf(NOCARD, SELLER2)).at(-1);
ok(Array.isArray(f2) && o2?.paid_with === "free", "a second free order (two items from one seller, one order)");
await svc(`INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
  VALUES ('${o2?.id}', '${NOCARD}', '${SELLER2}', now() - interval '3 hours', now() - interval '150 minutes')`);
const strikes0 = one(await svc(`SELECT count(*)::int FROM public.declutter_strikes WHERE user_id = '${SELLER2}'`));
const ns = await me(NOCARD, `SELECT public.declutter_report_no_show('${o2?.id}')`);
ok(one(ns)?.result === "cancelled" && (await order(o2?.id))?.status === "refunded",
  `the seller did not show: the free order closes${Array.isArray(ns) ? "" : `: ${JSON.stringify(ns)}`}`);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_strikes WHERE user_id = '${SELLER2}'`)) === strikes0 + 1
  && one(await svc(`SELECT count(*)::int FROM public.declutter_refunds WHERE order_id = '${o2?.id}'`)) === 0,
  "  the existing strike rule applies, and no refund is recorded (there was no payment)");
ok(/free Declutter pickup/.test(one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'You got a Declutter strike' ORDER BY created_at DESC LIMIT 1`)) ?? ""),
  "  the strike's words say a free pickup, not a card fee");

// 7. A cart mixing free and paid lines checks out normally; the fee is on the paid total.
await item(8, SELLER3, 2000);
await buy(BUYER, 8, 2000);
await claim(BUYER, 7);
const m = (await checkout(BUYER, SELLER3, "pickup_home"))?.[0];
const mo = m && await order(m.order_id);
ok(mo?.items_cents === 2000 && mo.premium_cents === Math.round(2000 * 0.05) + 70 && mo.total_cents === 2000 + 170 && mo.paid_with === "card"
  && one(await svc(`SELECT count(*)::int FROM public.declutter_cart_items WHERE order_id = '${m?.order_id}'`)) === 2,
  "a $20 item and a free one from one seller: one order, $20 + fee $1.70 on the paid total = $21.70");
ok(refused(await freeOut(BUYER, SELLER3, "pickup_home"), /not_free_order/), "the free checkout refuses a cart with a priced line");
await svc(`UPDATE public.declutter_orders SET stripe_checkout_session_id = 'cs_test_mixed' WHERE id = '${m?.order_id}'`);
await svc(`UPDATE public.declutter_cart_items SET status = 'missed', order_id = NULL WHERE item_id = '${I(8)}'`);
ok(refused(await freeOut(BUYER, SELLER3, "pickup_home"), /checkout_page_open/),
  "a free checkout never replaces an order whose payment page is still open (it could still be paid)");

// 8. Grants.
let gOk = true;
for (const [fn, member] of [["declutter_claim_free(uuid)", true], ["declutter_checkout_free(uuid,text)", true], ["declutter_free_rules()", true],
  ["declutter_take_item(uuid,uuid,integer,text,uuid)", false], ["declutter_close_paid_order(uuid,text,text,text,text)", false],
  ["declutter_complete_handover(uuid,text)", false]]) {
  const r = (await svc(`SELECT has_function_privilege('anon', 'public.${fn}', 'execute') a, has_function_privilege('authenticated', 'public.${fn}', 'execute') u`))?.[0];
  if (r?.a !== false || r?.u !== member) { gOk = false; console.log("  grant:", fn, JSON.stringify(r)); }
}
ok(gOk, "grants: claim / free checkout / rules for members (not anon); internals for neither");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

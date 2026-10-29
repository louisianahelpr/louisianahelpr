#!/usr/bin/env node
/**
 * PGlite proof for 20261029161347_declutter_porch_weekdays (owner 2026-10-29: porch weekday chips on the
 * sell form, builder 23's leftover). The seller may pick their porch weekdays; with none picked, the
 * days are the weekdays of their pickup times (the 20261028225038 rule). declutter_porch_days (offered)
 * and declutter_book_porch_day (accepted) share ONE helper, declutter_is_porch_day, so they never disagree.
 *
 *   node src/test/pglite/declutterPorchWeekdays.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPorchWeekdays.pglite.mjs # RED: the chain without it
 *
 * The world is declutterPorchPickADay.pglite.mjs's chain, plus 20261028225038 once, then this migration 3x.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const PICK_A_DAY_FILE = "20261028225038_declutter_porch_pick_a_day.sql";
const NEW_FILE = "20261029161347_declutter_porch_weekdays.sql";
const CHAIN_AFTER = [
  "20261021181118_helpr_delivery_payout_round_down.sql",
  "20261021185418_declutter_delivery_raise_pay.sql",
  "20261021204947_declutter_sales_outlive_a_deleted_party.sql",
];
const SETUP_FEE_FILE = "20261026154738_declutter_setup_fee_once.sql";
const REFUND_141D_FILE = "20261026155251_declutter_refund_requests.sql";
const SELLER_DELIVERY_FILE = "20261027153244_declutter_seller_delivery.sql";
const REMINDERS_FILE = "20261027205028_declutter_pickup_reminders.sql";
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
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, BUYER, BUYER2, OUTSIDER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 },
  ...[...BEFORE, ...CHAIN_AFTER, SETUP_FEE_FILE, REFUND_141D_FILE].map((file) => ({ file, times: 1 }))];
const stmts = setupStatements({ times: 1, times3b: 1, extra });
// The stubs declutterSellerDelivery.pglite.mjs uses (strike ladder, cron defect log, setup fee world).
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
  END $$;`);
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
for (const sql of stmts) await db.exec(sql);
await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true`);
await db.exec(CARDS_SQL);
// Seller delivery, then the pickup reminders (their email call and its error log stubbed, as their own proof).
await db.exec(readFileSync(`${MIG_DIR}${SELLER_DELIVERY_FILE}`, "utf8"));
await db.exec(`CREATE SCHEMA IF NOT EXISTS net; CREATE SCHEMA IF NOT EXISTS vault;
  CREATE TABLE IF NOT EXISTS net.calls (id serial PRIMARY KEY, url text, body jsonb);
  CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
    RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id::bigint $$;
  CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (name text, decrypted_secret text);
  CREATE TABLE IF NOT EXISTS public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL DEFAULT 'error',
    message text NOT NULL, tags jsonb NOT NULL DEFAULT '{}', context jsonb NOT NULL DEFAULT '{}');`);
await db.exec(readFileSync(`${MIG_DIR}${REMINDERS_FILE}`, "utf8"));

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const run = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
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
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);

await db.exec(readFileSync(`${MIG_DIR}${PICK_A_DAY_FILE}`, "utf8"));
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

// Pickup windows: every weekday but Sunday for SELLER.
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER}'::uuid, d, '09:00', '18:00' FROM generate_series(1, 6) d ON CONFLICT DO NOTHING;`);
const TODAY = one(await svc(`SELECT (now() AT TIME ZONE 'America/Chicago')::date::text`));
const dayOf = async (n) => one(await svc(`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + ${n})::text`));
const dowOf = async (d) => Number(one(await svc(`SELECT extract(dow FROM '${d}'::date)::int`)));
const I = (n) => `99999999-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function paidOrder(n, buyer, seller, price) {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Porch weekday item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', 'porch')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_pw_${n}', ${o?.total_cents}, now(), 150)`);
  return o ?? {};
}
const offered = async (id) => { const r = await me(BUYER, `SELECT d::text FROM public.declutter_porch_days('${id}') d`); return Array.isArray(r) ? r.map((x) => x.d) : r; };
const bookDay = (uid, id, d) => me(uid, `SELECT public.declutter_book_porch_day('${id}', '${d}'::date) AS r`);

// A. No porch days picked: the pickup-time weekdays, exactly as before (no Sunday).
const A = await paidOrder(1, BUYER, SELLER, 2000);
const before = await offered(A.order_id);
ok(Array.isArray(before) && before.length >= 5, `with no porch days picked, the pickup-time days are offered (${before?.length})`);
let anySunday = false;
for (const d of before ?? []) if ((await dowOf(d)) === 0) anySunday = true;
ok(!anySunday, "  never a Sunday (no pickup time that day), as before");
ok(one(await me(SELLER, `SELECT public.declutter_my_porch_days() AS d`)) === null, "  my porch days read back as none picked");

// B. The seller picks Sunday and Wednesday only.
const set = await me(SELLER, `SELECT public.declutter_set_porch_days(ARRAY[3, 0, 3]::smallint[]) AS d`);
ok(JSON.stringify(one(set)) === JSON.stringify([0, 3]), `the seller picks Sun + Wed, stored sorted and once each (${JSON.stringify(one(set))})`);
const after = await offered(A.order_id);
const dows = [];
for (const d of after ?? []) dows.push(await dowOf(d));
ok(Array.isArray(after) && after.length >= 1 && dows.every((w) => w === 0 || w === 3), `only Sundays and Wednesdays are offered now (${dows.join(",")})`);
// Offered and accepted agree: a picked Sunday books (no pickup time that day), a Monday does not.
let sunday = null;
let monday = null;
for (let n = 1; n <= 6; n++) {
  const d = await dayOf(n);
  const w = await dowOf(d);
  if (w === 0) sunday ??= d;
  if (w === 1) monday ??= d;
}
ok(refused(await bookDay(BUYER, A.order_id, monday), /invalid_day/), "  a Monday (a pickup-time day, not a porch day) is refused at booking");
ok(one(await bookDay(BUYER, A.order_id, sunday))?.result === "booked", "  a Sunday (a porch day with no pickup time) books");
ok(JSON.stringify(one(await me(SELLER, `SELECT public.declutter_my_porch_days() AS d`))) === JSON.stringify([0, 3]), "  my porch days read back");

// C. Bad input, strangers, and going back to the old rule.
ok(refused(await me(SELLER, `SELECT public.declutter_set_porch_days(ARRAY[7]::smallint[])`), /invalid_porch_days/), "a weekday outside 0-6 is refused");
ok(refused(await me(SELLER, `SELECT public.declutter_set_porch_days(ARRAY[NULL]::smallint[])`), /invalid_porch_days/), "a null weekday is refused");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_set_porch_days(ARRAY[1]::smallint[])`), /feature_disabled/), "an account without Declutter cannot set porch days");
const otherRow = await me(BUYER, `SELECT count(*)::int AS n FROM public.declutter_seller_porch_days`);
ok(one(otherRow) === 0, "another member cannot read the seller's porch days (own row only)");
ok(refused(await me(SELLER, `INSERT INTO public.declutter_seller_porch_days (seller_id, weekdays) VALUES ('${SELLER}', ARRAY[1]::smallint[])`), /permission denied/),
  "no direct writes: only the RPC");
ok(refused(await me(SELLER, `SELECT public.declutter_is_porch_day('${SELLER}', 1::smallint)`), /permission denied/), "members cannot call the helper directly");
ok(JSON.stringify(one(await me(SELLER, `SELECT public.declutter_set_porch_days(ARRAY[]::smallint[]) AS d`))) === "[]", "an empty pick clears them");
const B = await paidOrder(2, BUYER, SELLER, 1500);
const back = await offered(B.order_id);
let backSunday = false;
for (const d of back ?? []) if ((await dowOf(d)) === 0) backSunday = true;
ok(Array.isArray(back) && back.length >= 5 && !backSunday, "  and the pickup-time days apply again");

// D. Grants.
const acl = async (role, fn) => one(await svc(`SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`));
ok(await acl("anon", "declutter_set_porch_days(smallint[])") === false && await acl("anon", "declutter_my_porch_days()") === false,
  "anon cannot call the new RPCs (REVOKE FROM PUBLIC, anon)");
ok(await acl("authenticated", "declutter_is_porch_day(uuid, smallint)") === false, "the helper is internal");
void TODAY;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261028202844_declutter_sd_confirm_waits_for_delivery_day (deep audit 2026-10-28, Broken #7):
 * on a seller delivery the buyer's "I got it" waits until the seller marked it delivered or the delivery day
 * (Louisiana calendar) arrives. Every other handover is unchanged.
 *
 *   node src/test/pglite/declutterSdConfirmDeliveryDay.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSdConfirmDeliveryDay.pglite.mjs # RED: prod's body
 *   MIGRATION_PATH=<planted copy> node ...                                           # RED on a planted defect
 *
 * World: the seller-delivery proof's chain (scripts/declutter/slice3Harness.mjs), then this migration 3x. The
 * booked slot is moved with triggers bypassed (setup only, said so where it is done).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028202844_declutter_sd_confirm_waits_for_delivery_day.sql";
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
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3 } = USERS;
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
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb) RETURNS void LANGUAGE sql
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
await db.exec(readFileSync(`${MIG_DIR}${SELLER_DELIVERY_FILE}`, "utf8"));

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

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `12121212-0000-0000-0000-${String(n).padStart(12, "0")}`;
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT u, d, '09:00', '18:00' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) u, generate_series(0, 6) d ON CONFLICT DO NOTHING;`);
await me(SELLER2, `SELECT public.declutter_set_seller_delivery(true, 2000, 10)`);
const windows = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, starts: "09:00", ends: "17:00" })));
await me(SELLER2, `SELECT public.declutter_set_delivery_schedule('${windows}'::jsonb, NULL)`);
/** A paid seller-delivery order from SELLER2 to `buyer` (its booked time is at least 24 h out, the rules' lead time). */
async function sdOrder(n, buyer) {
  await db.exec(liveItemSql({ id: I(n), seller: SELLER2, title: `Delivered item ${n}`, price: 5000, floor: 100 }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', 5000)`);
  await svc(`SELECT public.declutter_set_delivery_dropoff('${buyer}', '${SELLER2}', '500 Drop Rd, Baton Rouge, LA 70805', 'North Baton Rouge', 30.496234, -91.154321)`);
  const offer = one(await me(buyer, `SELECT public.declutter_seller_delivery_offer('${SELLER2}')`));
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'seller_delivery', '${offer?.slots?.[0]}', 'leave')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_sd7_${n}', ${o?.total_cents}, now(), 150)`);
  return o?.order_id;
}
const confirm = (uid, id) => me(uid, `SELECT public.declutter_confirm_handover('${id}', 'buyer', NULL) AS r`);
const status = async (id) => one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`));
/** Move the booked slot (setup only; the delivery rules' triggers are bypassed for this one write). */
const setSlot = (id, sqlTs) => db.exec(`SET session_replication_role = replica;
  UPDATE public.declutter_seller_deliveries SET slot_start = ${sqlTs}, slot_end = ${sqlTs} + interval '1 hour' WHERE order_id = '${id}';
  SET session_replication_role = origin;`);
const chicago = (dayOffset, hhmm) => `((((now() AT TIME ZONE 'America/Chicago')::date + ${dayOffset}) + time '${hhmm}') AT TIME ZONE 'America/Chicago')`;

const A = await sdOrder(1, BUYER);
const sdA = (await svc(`SELECT status, slot_start, delivered_at FROM public.declutter_seller_deliveries WHERE order_id = '${A}'`))?.[0];
ok(await status(A) === "paid" && sdA?.status === "booked" && sdA.delivered_at === null, "setup: a paid seller delivery, booked, not delivered");

// The day before (the booked time is at least 24 h out): not yet.
const early = await confirm(BUYER, A);
ok(refused(early, /not_delivered_yet/) && await status(A) === "paid", `before the delivery day the buyer's "I got it" is refused: not_delivered_yet (${early?.error ?? "accepted"})`);
// The Louisiana calendar, not UTC. One of these two cases differs from a UTC rule at any hour of the day.
await setSlot(A, chicago(1, "00:30"));
ok(refused(await confirm(BUYER, A), /not_delivered_yet/), "a slot at 12:30 AM tomorrow (Louisiana): still the day before, refused (a UTC date already says tomorrow from 7 PM Louisiana time)");
await setSlot(A, chicago(0, "23:00"));
const sameDay = await confirm(BUYER, A);
ok(Array.isArray(sameDay) && await status(A) === "handed_over", `a slot at 11 PM today (Louisiana; already tomorrow in UTC): the delivery day, accepted${Array.isArray(sameDay) ? "" : `: ${sameDay?.error}`}`);

// Marked delivered early: the buyer may confirm at once.
const B = await sdOrder(2, BUYER2);
await svc(`UPDATE public.declutter_seller_deliveries SET delivered_at = now() WHERE order_id = '${B}'`);
const marked = await confirm(BUYER2, B);
ok(Array.isArray(marked) && await status(B) === "handed_over", `the seller marked it delivered: the buyer can confirm before the day${Array.isArray(marked) ? "" : `: ${marked?.error}`}`);

// No time booked (the slot was given away): never, until it is delivered.
const C = await sdOrder(3, BUYER3);
await db.exec(`SET session_replication_role = replica;
  UPDATE public.declutter_seller_deliveries SET status = 'needs_time', slot_start = NULL, slot_end = NULL WHERE order_id = '${C}';
  SET session_replication_role = origin;`);
ok(refused(await confirm(SELLER2, C), /wrong_side/), "the seller still cannot confirm for the buyer (unchanged)");
ok(refused(await confirm(BUYER3, C), /not_delivered_yet/), "no time booked and not delivered: refused");

// A row that is not a booking keeps its slot (an expired hold is 'released' with slot_start kept): not a booking,
// even on its day. Setup state only (triggers bypassed); the check reads status, not just a slot.
const D = await sdOrder(5, BUYER2);
await db.exec(`SET session_replication_role = replica;
  UPDATE public.declutter_seller_deliveries SET status = 'released', slot_start = ${chicago(0, "23:00")},
         slot_end = ${chicago(0, "23:00")} + interval '1 hour' WHERE order_id = '${D}';
  SET session_replication_role = origin;`);
ok(refused(await confirm(BUYER2, D), /not_delivered_yet/) && await status(D) === "paid", "a released (not booked) row with a slot today: refused");

// Every other handover is unchanged: a door pickup confirms at once.
await db.exec(liveItemSql({ id: I(4), seller: SELLER, title: "Pickup chair", price: 2000, floor: 100 }));
await me(BUYER, `SELECT public.declutter_buy_now('${I(4)}', 2000)`);
const p = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0];
await svc(`SELECT public.declutter_mark_order_paid('${p?.order_id}', 'pi_sd7_p', ${p?.total_cents}, now(), 150)`);
const pk = await confirm(BUYER, p?.order_id);
ok(Array.isArray(pk) && await status(p?.order_id) === "handed_over", `a door pickup: the buyer's "I got it" works as before${Array.isArray(pk) ? "" : `: ${pk?.error}`}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

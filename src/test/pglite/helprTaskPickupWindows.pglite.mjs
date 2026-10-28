#!/usr/bin/env node
/**
 * PGlite proof for 20261028232930_helpr_task_pickup_windows (lead 2026-10-28): a Helpr choosing a pickup time for an
 * OPEN delivery reads the seller's pickup windows and the latest a pickup may end, exactly when
 * helpr_tasks_open_near would show them the task; nobody else.
 *
 *   node src/test/pglite/helprTaskPickupWindows.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/helprTaskPickupWindows.pglite.mjs # RED: no such function
 *   MIGRATION_PATH=<planted copy> node ...                                    # RED on a planted defect
 *
 * World: the pickup-window reads proof's (src/test/pglite/declutterPickupWindowReads.pglite.mjs: the seller-delivery
 * chain, slices 1-5). Its Helpr helpers (helpr_task_assert_helpr, helpr_task_vehicle_fits,
 * helpr_task_same_stripe_mode) are the 20261017055505 bodies in that chain, not prod's newer ones; this function
 * only calls them, so their own rules are proven in their own proofs. The task row is written directly
 * (booking a real Helpr delivery is the helpr-delivery proof's job).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028232930_helpr_task_pickup_windows.sql";
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
const { SELLER, SELLER2, SELLER3, BUYER, BUYER2, BUYER3, OUTSIDER, BANNED, MINOR, NOPAYOUT } = USERS;
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
    await db.exec(uid ? `SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;` : `SET ROLE anon;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}

await db.exec(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false`);
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `44444444-0000-0000-0000-${String(n).padStart(12, "0")}`;
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local) VALUES
  ('${SELLER}', 1, '09:00', '12:00'), ('${SELLER}', 1, '14:00', '17:00'), ('${SELLER}', 3, '18:00', '20:00'),
  ('${SELLER2}', 6, '08:00', '10:00');`);
const win = (uid, id) => me(uid, `SELECT * FROM public.helpr_task_pickup_windows('${id}')`);
// A paid order from SELLER to BUYER (its delivery task is written below).
await db.exec(liveItemSql({ id: I(2), seller: SELLER, title: "Order chair", price: 3000, floor: 1000 }));
await me(BUYER, `SELECT public.declutter_buy_now('${I(2)}', 3000)`);
const o = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))[0];
await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_htw', ${o.total_cents}, now(), 150)`);
const paidAt = new Date(one(await svc(`SELECT paid_at FROM public.declutter_orders WHERE id = '${o.order_id}'`))).getTime();
const T = I(500);
const task = ({ status = "open", helpr = null, size = "small", openUntil = "now() + interval '1 day'", latest = "now() + interval '2 days'" } = {}) => db.exec(`SET session_replication_role = replica;
  DELETE FROM public.helpr_tasks WHERE id = '${T}';
  INSERT INTO public.helpr_tasks (id, source_kind, source_id, status, size, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng, trip_miles, pay_cents, fee_cents, open_until, latest_pickup_at, dropoff_code, helpr_id,
    pickup_slot_start, customer_id, pickup_contact_id)
  VALUES ('${T}', 'declutter_delivery', '${o.order_id}', '${status}', '${size}', 'Order chair', 'Mid-City', 'North BR', '1 A St', 30.4, -91.1,
    '2 B St', 30.5, -91.1, 3, 1500, 150, ${openUntil}, ${latest}, '1234',
    ${helpr ? `'${helpr}'` : "NULL"}, ${status === "open" ? "NULL" : "now() + interval '1 day'"}, '${BUYER}', '${SELLER}');
  SET session_replication_role = origin;`);

await task();
// The Helpr helpers of this world, as they answer for BUYER3 on this task (so a refusal below is this function's).
const can = one(await svc(`SELECT public.helpr_task_vehicle_fits('${BUYER3}', 'small') AND public.helpr_task_same_stripe_mode('${BUYER3}', '${BUYER}')`));
ok(can === true, "setup: BUYER3 is a Helpr this open delivery would be shown to");
const hw = await win(BUYER3, T);
ok(Array.isArray(hw) && hw.length === 3 && JSON.stringify(hw.map((r) => [r.weekday, r.starts, r.ends]))
  === JSON.stringify([[1, "09:00:00", "12:00:00"], [1, "14:00:00", "17:00:00"], [3, "18:00:00", "20:00:00"]]),
  `an eligible Helpr reads the seller's windows, in order (${Array.isArray(hw) ? hw.length : hw?.error})`);
ok(Array.isArray(hw) && hw.every((r) => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(["ends", "latest_pickup_at", "starts", "weekday"])),
  "  nothing else: no address, no seller id");
const taskLatest = new Date(one(await svc(`SELECT latest_pickup_at FROM public.helpr_tasks WHERE id = '${T}'`))).getTime();
ok(Array.isArray(hw) && hw.every((r) => new Date(r.latest_pickup_at).getTime() === Math.min(taskLatest, paidAt + 7 * 864e5)),
  "  latest_pickup_at is the task's own latest pickup (earlier than the 7-day deadline here)");
await task({ latest: "now() + interval '30 days'" });
const late = await win(BUYER3, T);
ok(Array.isArray(late) && late.every((r) => new Date(r.latest_pickup_at).getTime() === paidAt + 7 * 864e5),
  "  and never past the order's 7-day deadline (helpr_task_accept checks both)");
await task();
ok(refused(await win(BUYER, T), /task_not_found/), "the task's buyer: task_not_found (open_near never shows it to them)");
ok(refused(await win(SELLER, T), /task_not_found/), "the task's seller: task_not_found");
ok(refused(await win(BUYER3, "00000000-0000-0000-0000-00000000dead"), /task_not_found/), "an unknown task: task_not_found (the same answer)");
await db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${BUYER}', '${BUYER3}')`);
ok(refused(await win(BUYER3, T), /task_not_found/), "a Helpr the buyer blocked: task_not_found");
await db.exec(`DELETE FROM public.user_blocks; INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${BUYER3}', '${SELLER}')`);
ok(refused(await win(BUYER3, T), /task_not_found/), "a Helpr who blocked the seller: task_not_found");
await db.exec(`DELETE FROM public.user_blocks`);
await task({ status: "accepted", helpr: BUYER2 });
ok(refused(await win(BUYER3, T), /task_not_found/), "a task another Helpr took: task_not_found (not open)");
await task({ openUntil: "now() - interval '1 minute'" });
ok(refused(await win(BUYER3, T), /task_not_found/), "a task past its open window: task_not_found");
const xlFits = one(await svc(`SELECT public.helpr_task_vehicle_fits('${BUYER3}', 'xl')`));
await task({ size: "xl" });
const xl = await win(BUYER3, T);
ok(xlFits === false ? refused(xl, /task_not_found/) : Array.isArray(xl), `a task the Helpr's vehicle cannot carry: task_not_found (vehicle fits xl: ${xlFits})`);
await task();
ok(refused(await win(OUTSIDER, T), /feature_disabled/), "a non-tester: feature_disabled (the Declutter switch)");
// helpr_task_assert_helpr's refusals reach this read (a member who may not deliver never reads the windows).
ok(refused(await win(BANNED, T), /account_restricted/), "a banned member: account_restricted");
ok(refused(await win(MINOR, T), /under_18/), "a member under 18: under_18");
ok(refused(await win(NOPAYOUT, T), /payout_setup_incomplete/), "a member with no payout account: payout_setup_incomplete");
// A test account (test_accounts + a seed profile) never takes a real buyer's delivery (helpr_task_same_stripe_mode).
const seedOk = one(await svc(`SELECT public.helpr_task_vehicle_fits('${SELLER3}', 'small') AND NOT public.helpr_task_same_stripe_mode('${SELLER3}', '${BUYER}')`));
ok(seedOk === true && refused(await win(SELLER3, T), /task_not_found/), `a Helpr in the other Stripe mode: task_not_found (setup ${seedOk})`);
const acl = await svc(`SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS m,
    p.provolatile::text AS v, p.prosecdef AS d, array_to_string(p.proconfig, ',') AS cfg
  FROM pg_proc p WHERE p.proname = 'helpr_task_pickup_windows'`);
ok(Array.isArray(acl) && acl.length === 1 && acl[0].a === false && acl[0].m === true && acl[0].v === "s" && acl[0].d === true && /search_path=/.test(acl[0].cfg),
  `anon revoked, members granted, STABLE SECURITY DEFINER, search_path pinned (${JSON.stringify(acl)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

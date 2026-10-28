#!/usr/bin/env node
/**
 * PGlite proof for 20261028195840_declutter_pickup_window_reads (lead 2026-10-28, for Broken #2 / #58): an item's
 * pickup windows for any signed-in member while it is for sale or reserved; an order's for its paid buyer, its
 * seller or its assigned Helpr, with the 7-day pickup deadline. Nothing but the windows.
 *
 *   node src/test/pglite/declutterPickupWindowReads.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPickupWindowReads.pglite.mjs # RED: no such functions
 *   MIGRATION_PATH=<planted copy> node ...                                        # RED on a planted defect
 *
 * World: the seller-delivery proof's chain (scripts/declutter/slice3Harness.mjs) plus declutter_items.seller_hidden
 * (20261021142959, on prod: only its column, which this read checks), then this migration 3x.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028195840_declutter_pickup_window_reads.sql";
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
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3, NOCARD, OUTSIDER } = USERS;
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
const itemWin = (uid, n) => me(uid, `SELECT * FROM public.declutter_item_pickup_windows('${I(n)}')`);
const orderWin = (uid, id) => me(uid, `SELECT * FROM public.declutter_order_pickup_windows('${id}')`);
await db.exec(liveItemSql({ id: I(1), seller: SELLER, title: "Window lamp", price: 2000, floor: 1000 }));

// A. An item's windows: any signed-in member, only while it is up for sale or reserved, only the windows.
const w = await itemWin(BUYER, 1);
ok(Array.isArray(w) && w.length === 3, `a signed-in member reads the seller's windows for a live item (${Array.isArray(w) ? w.length : w?.error})`);
ok(Array.isArray(w) && JSON.stringify(w.map((r) => [r.weekday, r.starts, r.ends]))
  === JSON.stringify([[1, "09:00:00", "12:00:00"], [1, "14:00:00", "17:00:00"], [3, "18:00:00", "20:00:00"]]),
  "  in weekday then time order, only this seller's");
ok(Array.isArray(w) && w.every((r) => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(["ends", "starts", "weekday"])),
  "  and nothing else: no address, no seller id");
for (const st of ["paused", "draft", "pending_review", "withdrawn", "sold"]) {
  await svc(`UPDATE public.declutter_items SET status = '${st}' WHERE id = '${I(1)}'`);
  ok(refused(await itemWin(BUYER, 1), /item_not_found/), `  not for a ${st} item`);
}
await svc(`UPDATE public.declutter_items SET status = 'reserved' WHERE id = '${I(1)}'`);
ok(Array.isArray(await itemWin(BUYER, 1)), "  a reserved item: still readable");
await svc(`UPDATE public.declutter_items SET status = 'live', seller_hidden = true WHERE id = '${I(1)}'`);
ok(refused(await itemWin(BUYER, 1), /item_not_found/), "  not while the seller is hidden (out of Declutter)");
await svc(`UPDATE public.declutter_items SET seller_hidden = false WHERE id = '${I(1)}'`);
ok(refused(await itemWin(BUYER, 99), /item_not_found/), "  an unknown item: item_not_found");
ok(refused(await itemWin(OUTSIDER, 1), /feature_disabled/), "  a non-tester: feature_disabled (require_feature)");
ok(refused(await me(null, `SELECT * FROM public.declutter_item_pickup_windows('${I(1)}')`), /not_authenticated|permission denied|invalid input/)
  || one(await svc(`SELECT has_function_privilege('anon', 'public.declutter_item_pickup_windows(uuid)', 'EXECUTE')`)) === false,
  "  anon cannot call it");

// B. An order's windows: the paid buyer, the seller, the assigned Helpr. Nobody else.
await db.exec(liveItemSql({ id: I(2), seller: SELLER, title: "Order chair", price: 3000, floor: 1000 }));
await me(BUYER, `SELECT public.declutter_buy_now('${I(2)}', 3000)`);
const o = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))[0];
ok(!!o?.order_id, "setup: an order, not paid yet");
ok(refused(await orderWin(BUYER, o.order_id), /item_not_found/), "the buyer cannot read an unpaid order's windows");
const sellerUnpaid = await orderWin(SELLER, o.order_id);
ok(Array.isArray(sellerUnpaid) && sellerUnpaid.length === 3 && sellerUnpaid[0].latest_pickup_at === null, "the seller can (no deadline yet: not paid)");
await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_win', ${o.total_cents}, now(), 150)`);
const paidAt = one(await svc(`SELECT paid_at FROM public.declutter_orders WHERE id = '${o.order_id}'`));
const bw = await orderWin(BUYER, o.order_id);
ok(Array.isArray(bw) && bw.length === 3 && bw.every((r) => new Date(r.latest_pickup_at).getTime() === new Date(paidAt).getTime() + 7 * 864e5),
  `the paid buyer reads them, with the 7-day pickup deadline (${Array.isArray(bw) ? bw[0]?.latest_pickup_at : bw?.error})`);
ok(Array.isArray(bw) && bw.every((r) => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(["ends", "latest_pickup_at", "starts", "weekday"])),
  "  nothing else");
ok(refused(await orderWin(BUYER2, o.order_id), /item_not_found/), "another buyer: item_not_found");
ok(refused(await orderWin(SELLER2, o.order_id), /item_not_found/), "another seller: item_not_found");
ok(refused(await orderWin(BUYER, "00000000-0000-0000-0000-00000000dead"), /item_not_found/), "an unknown order: item_not_found (the same answer)");
// The Helpr on its delivery (row written directly; booking a real Helpr delivery is the helpr-delivery proof's job).
const task = (status, helpr) => db.exec(`SET session_replication_role = replica;
  DELETE FROM public.helpr_tasks WHERE source_id = '${o.order_id}';
  INSERT INTO public.helpr_tasks (source_kind, source_id, status, size, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng, trip_miles, pay_cents, fee_cents, open_until, latest_pickup_at, dropoff_code, helpr_id,
    pickup_slot_start, customer_id)
  VALUES ('declutter_delivery', '${o.order_id}', '${status}', 'small', 'Order chair', 'Mid-City', 'North BR', '1 A St', 30.4, -91.1,
    '2 B St', 30.5, -91.1, 3, 1500, 150, now() + interval '1 day', now() + interval '2 days', '1234',
    ${helpr ? `'${helpr}'` : "NULL"}, ${status === "open" ? "NULL" : "now() + interval '1 day'"}, '${BUYER}');
  SET session_replication_role = origin;`);
await task("accepted", BUYER3);
const hw = await orderWin(BUYER3, o.order_id);
ok(Array.isArray(hw) && hw.length === 3, `the Helpr who took the delivery reads them${Array.isArray(hw) ? "" : `: ${hw?.error}`}`);
ok(refused(await orderWin(NOCARD, o.order_id), /item_not_found/), "  another Helpr (not the one on it) cannot");
await task("open", null);
ok(refused(await orderWin(BUYER3, o.order_id), /item_not_found/), "  a Helpr on an open (not taken) delivery cannot");
await task("cancelled", BUYER3);
ok(refused(await orderWin(BUYER3, o.order_id), /item_not_found/), "  nor once it is cancelled");
ok(refused(await orderWin(OUTSIDER, o.order_id), /feature_disabled/), "a non-tester: feature_disabled");

// C. Grants and shape.
const acl = await svc(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS m,
    p.provolatile::text AS v, p.prosecdef AS d, array_to_string(p.proconfig, ',') AS cfg
  FROM pg_proc p WHERE p.proname IN ('declutter_item_pickup_windows', 'declutter_order_pickup_windows') ORDER BY 1`);
ok(Array.isArray(acl) && acl.length === 2 && acl.every((r) => r.a === false && r.m === true && r.v === "s" && r.d === true && /search_path=/.test(r.cfg)),
  `both: anon revoked, members granted, STABLE SECURITY DEFINER, search_path pinned (${JSON.stringify(acl)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261028201659_declutter_setup_helpr_item_details (lead 2026-10-28, Confusing #27): the
 * buyer's "Need a hand?" read returns each item's category and size (item_details) beside the titles, additively.
 *
 *   node src/test/pglite/declutterSetupHelprItemDetails.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSetupHelprItemDetails.pglite.mjs # RED: prod's body (titles only)
 *   MIGRATION_PATH=<planted copy> node ...                                            # RED on a planted defect
 *
 * World: the seller-delivery proof's chain (scripts/declutter/slice3Harness.mjs), 20261017073146's switch and
 * declutter_order_jobs table (verbatim) on a jobs table stubbed with the columns the read uses, and prod's
 * declutter_setup_helpr (20261017073146), then this migration 3x.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028201659_declutter_setup_helpr_item_details.sql";
const ADD_HELPR_FILE = "20261017073146_declutter_add_a_helpr.sql";
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
const { SELLER, BUYER, BUYER2, OUTSIDER } = USERS;
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

{
  const add = readFileSync(`${MIG_DIR}${ADD_HELPR_FILE}`, "utf8");
  const sw = /INSERT INTO public\.feature_switches[\s\S]*?ON CONFLICT \(key\) DO NOTHING;/.exec(add);
  const tbl = /CREATE TABLE IF NOT EXISTS public\.declutter_order_jobs[\s\S]*?\n\);/.exec(add);
  const fn = /CREATE OR REPLACE FUNCTION public\.declutter_setup_helpr\([\s\S]*?\$fn\$;/.exec(add);
  if (!sw || !tbl || !fn) throw new Error("20261017073146 pieces not found");
  await db.exec(`CREATE TABLE IF NOT EXISTS public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, title text,
    category text, status text, payment_status text)`);
  await db.exec(sw[0]); await db.exec(tbl[0]); await db.exec(fn[0]);
  await db.exec(`GRANT EXECUTE ON FUNCTION public.declutter_setup_helpr(uuid) TO authenticated; REVOKE ALL ON FUNCTION public.declutter_setup_helpr(uuid) FROM PUBLIC, anon;`);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
await db.exec(liveItemSql({ id: I(1), seller: SELLER, title: "Blue mug", price: 500, floor: 100 }));
await db.exec(liveItemSql({ id: I(2), seller: SELLER, title: "Oak bookshelf", price: 4000, floor: 1000 }));
await svc(`UPDATE public.declutter_items SET category = 'kitchen', delivery_size = 'small' WHERE id = '${I(1)}'`);
for (const n of [1, 2]) await me(BUYER, `SELECT public.declutter_buy_now('${I(n)}', ${n === 1 ? 500 : 4000})`);
const o = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))[0];
await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_sh', ${o?.total_cents}, now(), 150)`);
ok(one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${o?.order_id}'`)) === "paid", "setup: a paid order of a mug and a bookshelf");

const r = await me(BUYER, `SELECT public.declutter_setup_helpr('${o.order_id}') AS r`);
const info = one(r);
ok(Array.isArray(r) && JSON.stringify(info?.items) === JSON.stringify(["Blue mug", "Oak bookshelf"]),
  `'items' is unchanged: the titles, in order (${JSON.stringify(info?.items ?? r)})`);
ok(JSON.stringify(info?.item_details) === JSON.stringify([
  { title: "Blue mug", category: "kitchen", delivery_size: "small" },
  { title: "Oak bookshelf", category: "furniture", delivery_size: "large" },
]), `'item_details' gives each item's category and size, same order (${JSON.stringify(info?.item_details)})`);
ok(info && JSON.stringify(Object.keys(info).sort()) === JSON.stringify(["handover", "item_details", "items", "jobs", "order_id", "pickup_at", "status"]),
  "every earlier key is still there (additive: only item_details is new)");
ok(refused(await me(BUYER2, `SELECT public.declutter_setup_helpr('${o.order_id}')`), /item_not_found/), "another member: item_not_found (unchanged)");
ok(refused(await me(SELLER, `SELECT public.declutter_setup_helpr('${o.order_id}')`), /item_not_found/), "the seller: item_not_found (the buyer's offer only, unchanged)");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_setup_helpr('${o.order_id}')`), /feature_disabled/), "a non-tester: feature_disabled (unchanged)");
ok(one(await svc(`SELECT has_function_privilege('anon', 'public.declutter_setup_helpr(uuid)', 'EXECUTE')`)) === false, "anon cannot call it");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

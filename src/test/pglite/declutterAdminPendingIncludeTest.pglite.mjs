#!/usr/bin/env node
/**
 * PGlite proof for 20261028194414_declutter_admin_pending_include_test (lead 2026-10-28, #14): the admin
 * "listings to review" read takes p_include_test boolean DEFAULT false; a call with no argument still resolves
 * and still hides test listings (the owner's rule); declutter_admin_review_item decides a test seller's listing.
 *
 *   node src/test/pglite/declutterAdminPendingIncludeTest.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAdminPendingIncludeTest.pglite.mjs # RED: no argument exists
 *   MIGRATION_PATH=<planted copy> node ...                                              # RED on a planted defect
 *
 * World: the seller-delivery proof's chain (scripts/declutter/slice3Harness.mjs), then prod's current body
 * (20261028022715, test listings hidden), then this migration 3x. pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028194414_declutter_admin_pending_include_test.sql";
const HIDES_TEST_FILE = "20261028022715_admin_declutter_review_hides_test_listings.sql";
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
const { SELLER, SELLER3, BUYER, OUTSIDER, ADMIN } = USERS;
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

await db.exec(readFileSync(`${MIG_DIR}${HIDES_TEST_FILE}`, "utf8"));
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;
const pending = async (n, seller, title) => {
  await db.exec(liveItemSql({ id: I(n), seller, title, price: 4000, floor: 2000 }));
  await svc(`UPDATE public.declutter_items SET status = 'pending_review', admin_approved_at = NULL, submitted_at = now() - interval '${n} minutes'
              WHERE id = '${I(n)}'`);
};
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
const ids = (r) => (Array.isArray(r) ? r.map((x) => x.item_id) : []);
await pending(1, SELLER, "Real lamp");
await pending(2, SELLER3, "Fixture side table [E2E-PRODAUDIT]");
ok(one(await svc(`SELECT is_seed FROM public.profiles WHERE user_id = '${SELLER3}'`)) === true, "setup: SELLER3 is a test (is_seed) account");

const noArg = await me(ADMIN, `SELECT * FROM public.declutter_admin_pending_items()`);
ok(Array.isArray(noArg) && ids(noArg).includes(I(1)) && !ids(noArg).includes(I(2)),
  `a call with NO argument (every installed app build) still resolves, and still leaves the test listing out (${Array.isArray(noArg) ? ids(noArg).length : noArg?.error})`);
const asked = await me(ADMIN, `SELECT * FROM public.declutter_admin_pending_items(true)`);
ok(Array.isArray(asked) && ids(asked).includes(I(1)) && ids(asked).includes(I(2)), "p_include_test => true: the test listing is shown too");
const named = await me(ADMIN, `SELECT * FROM public.declutter_admin_pending_items(p_include_test => false)`);
ok(Array.isArray(named) && ids(named).includes(I(1)) && !ids(named).includes(I(2)), "p_include_test => false: left out");
const nulled = await me(ADMIN, `SELECT * FROM public.declutter_admin_pending_items(NULL)`);
ok(Array.isArray(nulled) && !ids(nulled).includes(I(2)), "NULL counts as false: left out");
ok(Array.isArray(asked) && asked.find((r) => r.item_id === I(1))?.title === "Real lamp", "the row is the same shape (title read back)");

ok(refused(await me(BUYER, `SELECT * FROM public.declutter_admin_pending_items(true)`), /not_admin/), "a member who is not an admin is refused, even asking for test listings");
ok(refused(await me(OUTSIDER, `SELECT * FROM public.declutter_admin_pending_items()`), /feature_disabled|not_admin/), "a non-tester is refused");
ok(one(await svc(`SELECT count(*)::int FROM pg_proc WHERE proname = 'declutter_admin_pending_items' AND pronamespace = 'public'::regnamespace`)) === 1,
  "one function of that name: the no-argument one is gone (never two overloads)");
const acl = await svc(`SELECT has_function_privilege('anon', 'public.declutter_admin_pending_items(boolean)', 'EXECUTE') AS a,
                              has_function_privilege('authenticated', 'public.declutter_admin_pending_items(boolean)', 'EXECUTE') AS m`);
ok(Array.isArray(acl) && acl[0]?.a === false && acl[0]?.m === true, "anon cannot call it; signed-in members can (the admin check is inside)");
const vol = one(await svc(`SELECT provolatile::text || ':' || prosecdef::text AS v FROM pg_proc WHERE proname = 'declutter_admin_pending_items'`));
ok(vol === "s:true", `STABLE SECURITY DEFINER (${vol})`);

// declutter_admin_review_item decides a test seller's listing (unchanged; it never refused one).
const rev = await me(ADMIN, `SELECT public.declutter_admin_review_item('${I(2)}', true, NULL) AS r`);
ok(Array.isArray(rev) && one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(2)}'`)) === "live",
  `an admin can approve a test seller's listing${Array.isArray(rev) ? "" : `: ${rev?.error}`}`);
ok(refused(await me(BUYER, `SELECT public.declutter_admin_review_item('${I(1)}', true, NULL)`), /not_admin/), "  and only an admin");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

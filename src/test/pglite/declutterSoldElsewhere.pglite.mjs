#!/usr/bin/env node
/**
 * PGlite proof for 20261028192719_declutter_sold_elsewhere (Declutter audit 2 SE2-1 / lead's A2-5): "Mark sold
 * elsewhere" is its own outcome, kept in the seller's history; "Delete" stays a withdraw.
 *
 *   node src/test/pglite/declutterSoldElsewhere.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSoldElsewhere.pglite.mjs # RED: no such status or RPC
 *   MIGRATION_PATH=<planted copy> node ...                                    # RED on a planted defect
 *
 * World: the seller-delivery proof's chain (scripts/declutter/slice3Harness.mjs: slices 1-4, manage listing,
 * the later Declutter money migrations, seller delivery), then this migration 3x. pglite is not a dependency
 * (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028192719_declutter_sold_elsewhere.sql";
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

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const item = async (n, seller, title, status = "live") => {
  await db.exec(liveItemSql({ id: I(n), seller, title, price: 4000, floor: 2000 }));
  if (status !== "live") await svc(`UPDATE public.declutter_items SET status = '${status}' WHERE id = '${I(n)}'`);
};
const statusOf = async (n) => one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(n)}'`));
const mark = (uid, n) => me(uid, `SELECT public.declutter_mark_sold_elsewhere('${I(n)}') AS paths`);
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
const photo = (n, seller, pos) => svc(`INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
  VALUES ('${I(n)}', '${seller}', '${seller}/declutter/${I(n)}/p${pos}.jpg', ${pos})`);

// A. A live listing with photos, a watcher and an open offer is marked sold elsewhere.
await item(1, SELLER, "Brass lamp");
await photo(1, SELLER, 0);
await photo(1, SELLER, 1);
await svc(`INSERT INTO public.declutter_watchlist (user_id, item_id) VALUES ('${BUYER2}', '${I(1)}')`);
const off = await me(BUYER, `SELECT public.declutter_make_offer('${I(1)}', 3000) AS id`);
ok(Array.isArray(off) && one(off), `setup: an open offer on the listing${Array.isArray(off) ? "" : `: ${off?.error}`}`);
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_item_photos WHERE item_id = '${I(1)}'`))) === 2
  && Number(one(await svc(`SELECT count(*) FROM public.declutter_watchlist WHERE item_id = '${I(1)}'`))) === 1, "setup: two photos and a watcher");
ok(refused(await mark(OUTSIDER, 1), /item_not_found|feature_disabled/), "a stranger cannot mark someone else's listing");
ok(refused(await mark(BUYER, 1), /item_not_found/), "nor can the buyer who made an offer");
const r1 = await mark(SELLER, 1);
const paths = one(r1);
ok(Array.isArray(paths) && paths.length === 2 && paths[0].endsWith("/p0.jpg"), `the seller marks it sold elsewhere; the photo paths come back to delete (${JSON.stringify(paths ?? r1)})`);
ok(await statusOf(1) === "sold_elsewhere", "  the listing is KEPT, as 'sold_elsewhere' (not 'withdrawn', not deleted)");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_item_photos WHERE item_id = '${I(1)}'`))) === 0
  && Number(one(await svc(`SELECT count(*) FROM public.declutter_watchlist WHERE item_id = '${I(1)}'`))) === 0,
  "  its photo rows and watchers are gone (off-sale photos are not left public by URL)");
ok(one(await svc(`SELECT status FROM public.declutter_offers WHERE id = '${one(off)}'`)) === "voided", "  the open offer is closed");
const note = (await svc(`SELECT type, title, message, link FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Item no longer available'`))?.[0];
ok(note?.message === '"Brass lamp" sold elsewhere, so your offer is closed. Nothing was charged.' && note?.link === "/declutter?tab=buying"
  && note?.type === "declutter_offers", `  and its buyer is told, naming the item, linked to Buying (${JSON.stringify(note)})`);
const mineRows = await me(SELLER, `SELECT status FROM public.declutter_items WHERE id = '${I(1)}'`);
ok(Array.isArray(mineRows) && mineRows[0]?.status === "sold_elsewhere", "  the seller still reads it (their history)");
const othersRows = await me(BUYER2, `SELECT id FROM public.declutter_items WHERE id = '${I(1)}'`);
ok(Array.isArray(othersRows) && othersRows.length === 0, "  nobody else does (not on sale)");
const again = one(await mark(SELLER, 1));
ok(Array.isArray(again) && again.length === 0 && await statusOf(1) === "sold_elsewhere", "marking it again changes nothing (idempotent)");
ok(refused(await me(SELLER, `SELECT public.declutter_relist_listing('${I(1)}')`), /item_not_editable|item_not_found|not_paused|22023|55000/),
  "a listing sold elsewhere cannot be relisted");

// B. Which listings can be marked.
await item(2, SELLER, "Paused chair", "paused");
await item(3, SELLER, "Ended rug", "ended");
await item(4, SELLER, "Waiting vase", "pending_review");
for (const [n, s] of [[2, "paused"], [3, "off sale"], [4, "waiting for review"]]) {
  const r = await mark(SELLER, n);
  ok(Array.isArray(r) && await statusOf(n) === "sold_elsewhere", `a ${s} listing can be marked sold elsewhere`);
}
for (const [n, st, why] of [[5, "draft", "a draft (never listed: Delete it)"], [6, "reserved", "a reserved one (someone is buying it in the app)"],
  [7, "sold", "one sold in the app"], [8, "removed", "one Louisiana Helpr removed"]]) {
  await item(n, SELLER, `Item ${n}`, st);
  ok(refused(await mark(SELLER, n), /item_not_editable/) && await statusOf(n) === st, `refused: ${why}`);
}

// C. Delete is unchanged: still a withdraw.
await item(9, SELLER, "Deleted kettle");
const w = await me(SELLER, `SELECT public.declutter_withdraw_item('${I(9)}')`);
ok(Array.isArray(w) && await statusOf(9) === "withdrawn", "Delete still takes it down as 'withdrawn' (declutter_withdraw_item unchanged)");

// D. The status CHECK, the switch and the grants.
ok(!!(await svc(`UPDATE public.declutter_items SET status = 'sold_elsewherex' WHERE id = '${I(9)}'`))?.error, "the status CHECK still refuses an unknown status");
ok(one(await svc(`SELECT has_function_privilege('anon', 'public.declutter_mark_sold_elsewhere(uuid)', 'EXECUTE')`)) === false,
  "anon cannot call it (REVOKE FROM PUBLIC, anon)");
await item(10, OUTSIDER, "Outsider lamp");
ok(refused(await mark(OUTSIDER, 10), /feature_disabled/), "an ordinary (non-tester) account is refused while Declutter is testers-only (require_feature)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

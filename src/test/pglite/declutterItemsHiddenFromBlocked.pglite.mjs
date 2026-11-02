#!/usr/bin/env node
/**
 * PGlite proof for 20261102022901_declutter_items_hidden_from_blocked (Q1888): a member in a block with a seller
 * (either direction) no longer reads that seller's live listings; the seller still reads their own; a buyer who
 * already paid still reads the item they bought; everyone else browses as before; the new helper answers only for
 * the caller and anon cannot run it (Supabase's default anon EXECUTE grant emulated first, so the REVOKE must bite).
 *
 *   node src/test/pglite/declutterItemsHiddenFromBlocked.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterItemsHiddenFromBlocked.pglite.mjs # RED: the blocked pair reads
 *   MIGRATION_PATH=<planted copy> node ...                                             # RED on a planted defect
 *
 * World: declutterBuyerReadsOwnItem.pglite.mjs's chain, then 20261030080020 (the live read policy), then this 3x.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261102022901_declutter_items_hidden_from_blocked.sql";
const WINDOWS_FILE = "20261028195840_declutter_pickup_window_reads.sql";
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


await db.exec(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false;
  ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS is_seed boolean NOT NULL DEFAULT false;
  DO $$ BEGIN
    IF to_regprocedure('public.seed_hidden_in_discovery()') IS NULL THEN
      -- The seed switch OFF (its own proof is seedSwitchHidesProfiles); the policy only calls it.
      CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
    END IF;
  END $$;`);
// The item windows read as prod has it (20261028195840, equal to the live pg_get_functiondef read 2026-10-30).
await db.exec(readFileSync(`${MIG_DIR}${WINDOWS_FILE}`, "utf8"));

await db.exec(readFileSync(`${MIG_DIR}20261030080020_declutter_buyer_reads_own_item.sql`, "utf8"));
// Supabase grants EXECUTE on every new public function to anon by default; emulate it so a missing REVOKE shows.
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated`);
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sees = async (uid, n) => {
  const r = await me(uid, `SELECT id FROM public.declutter_items WHERE id = '${I(n)}'`);
  return Array.isArray(r) ? r.length === 1 : `error: ${r?.error}`;
};
await db.exec(liveItemSql({ id: I(1), seller: SELLER, title: "Lamp", price: 2000, floor: 1000 }));
await db.exec(liveItemSql({ id: I(2), seller: SELLER2, title: "Rug", price: 1500, floor: 500 }));
ok((await sees(BUYER, 1)) === true && (await sees(BUYER2, 1)) === true, "before any block: members read the live item");

// A. The seller blocks BUYER: BUYER no longer reads the seller's live item; the seller still does; others still do.
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${SELLER}', '${BUYER}')`);
ok((await sees(BUYER, 1)) === false, "a member the seller blocked does not read the seller's live item");
ok((await sees(SELLER, 1)) === true, "  the seller still reads their own item");
ok((await sees(BUYER2, 1)) === true, "  another member still reads it");
ok((await sees(BUYER, 2)) === true, "  the blocked member still reads other sellers' items");

// B. The other direction: BUYER2 blocks SELLER2, so BUYER2 does not read SELLER2's items, and SELLER2 does not read BUYER2's.
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${BUYER2}', '${SELLER2}')`);
ok((await sees(BUYER2, 2)) === false, "a member who blocked the seller does not read the seller's item either");
await db.exec(liveItemSql({ id: I(3), seller: BUYER2, title: "Chair", price: 1000, floor: 500 }));
ok((await sees(SELLER2, 3)) === false && (await sees(BUYER3, 3)) === true, "  and the blocked seller does not read theirs (others do)");

// C. A buyer who already paid keeps reading the item they bought, block or not (the paid branch is unchanged).
await db.exec(liveItemSql({ id: I(4), seller: SELLER, title: "Bought desk", price: 2500, floor: 1000 }));
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${SELLER}' AND blocked_id = '${BUYER}'`);
await me(BUYER, `SELECT public.declutter_buy_now('${I(4)}', 2500)`);
const o = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))[0];
ok(!!o?.order_id, "setup: an order for the buyer");
await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_blk', ${o.total_cents}, now(), 150)`);
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${SELLER}', '${BUYER}')`);
ok((await sees(BUYER, 4)) === true, "a buyer who paid still reads the item they bought after a block");
ok((await sees(BUYER, 1)) === false, "  while the seller's live item stays hidden from them");

// D. The helper: the caller's partners only; empty for a member with none; anon cannot run it.
const mine = await me(BUYER, `SELECT public.declutter_my_block_partners() AS p`);
ok(Array.isArray(mine) && JSON.stringify(mine[0].p) === JSON.stringify([SELLER]), `the helper answers the caller's partners (${JSON.stringify(mine)})`);
const none = await me(BUYER3, `SELECT public.declutter_my_block_partners() AS p`);
ok(Array.isArray(none) && Array.isArray(none[0].p) && none[0].p.length === 0, `  empty for a member with no blocks (${JSON.stringify(none)})`);
const anon = await me(null, `SELECT public.declutter_my_block_partners() AS p`);
ok(!Array.isArray(anon) && /permission denied/.test(anon?.error ?? ""), `  anon cannot run it (${JSON.stringify(anon)})`);
const acl = await svc(`SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS m,
    p.provolatile::text AS v, p.prosecdef AS d, array_to_string(p.proconfig, ',') AS cfg
  FROM pg_proc p WHERE p.proname = 'declutter_my_block_partners'`);
ok(Array.isArray(acl) && acl.length === 1 && acl[0].a === false && acl[0].m === true && acl[0].v === "s" && acl[0].d === true && /search_path=/.test(acl[0].cfg),
  `helper: anon revoked, members granted, STABLE SECURITY DEFINER, search_path pinned (${JSON.stringify(acl)})`);
const pols = await svc(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'declutter_items' AND cmd = 'SELECT'`);
ok(one(pols) === 1, `declutter_items keeps exactly one member read policy (${one(pols)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

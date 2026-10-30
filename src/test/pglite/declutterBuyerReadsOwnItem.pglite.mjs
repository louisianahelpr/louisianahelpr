#!/usr/bin/env node
/**
 * PGlite proof for 20261030080020_declutter_buyer_reads_own_item (DA-6, Declutter audit 2026-10-30): the member who
 * paid for (or claimed) an item reads that item afterwards, so its page opens instead of "This item isn't available.";
 * only a PAID line of their own counts; Browse is unchanged; and the item windows read answers "not found" as PT404
 * (HTTP 404) instead of P0002 (HTTP 500).
 *
 *   node src/test/pglite/declutterBuyerReadsOwnItem.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBuyerReadsOwnItem.pglite.mjs # RED: the buyer reads nothing, P0002
 *   MIGRATION_PATH=<planted copy> node ...                                        # RED on a planted defect
 *
 * World: the pickup-window proof's chain (declutterPickupWindowReads.pglite.mjs, scripts/declutter/slice3Harness.mjs)
 * plus declutter_items.seller_hidden and the windows read as prod has it, then this migration 3x.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261030080020_declutter_buyer_reads_own_item.sql";
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
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `55555555-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sees = async (uid, n) => {
  const r = await me(uid, `SELECT id, status FROM public.declutter_items WHERE id = '${I(n)}'`);
  return Array.isArray(r) ? r.length === 1 : `error: ${r?.error}`;
};

// A. The paid buyer reads their own sold item; nobody else new does.
await db.exec(liveItemSql({ id: I(1), seller: SELLER, title: "Bought lamp", price: 2000, floor: 1000 }));
await db.exec(`INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
  VALUES ('${I(1)}', '${SELLER}', '${SELLER}/declutter/${I(1)}/a.jpg', 0)`);
await me(BUYER, `SELECT public.declutter_buy_now('${I(1)}', 2000)`);
const o = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))[0];
ok(!!o?.order_id, "setup: an order for the buyer");
await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_own', ${o.total_cents}, now(), 150)`);
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(1)}'`)) === "sold", "setup: paid, so the item is sold");
ok((await sees(BUYER, 1)) === true, "the buyer who paid reads their sold item (the page opens)");
ok((await sees(SELLER, 1)) === true, "  its seller still reads it");
ok((await sees(BUYER2, 1)) === false, "  another member does not (sold is not for sale)");
ok((await sees(OUTSIDER, 1)) === false, "  nor a non-tester");
const photos = await me(BUYER, `SELECT count(*)::int AS n FROM public.declutter_item_photos WHERE item_id = '${I(1)}'`);
const photosOther = await me(BUYER2, `SELECT count(*)::int AS n FROM public.declutter_item_photos WHERE item_id = '${I(1)}'`);
ok(Array.isArray(photos) && photos[0].n === 1 && Array.isArray(photosOther) && photosOther[0].n === 0,
  `  its photos follow (buyer ${JSON.stringify(photos)}, other ${JSON.stringify(photosOther)})`);
await svc(`UPDATE public.declutter_items SET status = 'completed' WHERE id = '${I(1)}'`);
ok((await sees(BUYER, 1)) === true, "  still after the handover (completed)");
ok((await sees(BUYER2, 1)) === false, "  and still nobody else");

// B. Only a PAID line counts: a line that was missed, removed or cancelled by the seller gives no read.
await db.exec(liveItemSql({ id: I(2), seller: SELLER, title: "Missed chair", price: 3000, floor: 1000 }));
for (const st of ["missed", "cancelled_by_seller", "in_cart"]) {
  await db.exec(`SET session_replication_role = replica;
    DELETE FROM public.declutter_cart_items WHERE item_id = '${I(2)}';
    INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, status, checkout_by)
    VALUES ('${I(2)}', '${BUYER2}', '${SELLER}', 3000, 'buy', '${st}', now() + interval '1 day');
    UPDATE public.declutter_items SET status = 'sold' WHERE id = '${I(2)}';
    SET session_replication_role = origin;`);
  ok((await sees(BUYER2, 2)) === false, `a buyer whose line is ${st} does not read the sold item`);
}
// Someone else's paid line on an item gives ME nothing.
await db.exec(`SET session_replication_role = replica;
  UPDATE public.declutter_cart_items SET status = 'paid' WHERE item_id = '${I(2)}';
  SET session_replication_role = origin;`);
ok((await sees(BUYER2, 2)) === true, "  the same line once paid: they do");
ok((await sees(BUYER, 2)) === false, "  and another member still does not (only the buyer's own line)");

// C. Browse is unchanged: live for switched-on members, a hidden seller's live item for no one but the seller.
await db.exec(liveItemSql({ id: I(3), seller: SELLER2, title: "Live rug", price: 1500, floor: 500 }));
ok((await sees(BUYER, 3)) === true && (await sees(OUTSIDER, 3)) === false, "a live item: members read it, a non-tester does not");
await svc(`UPDATE public.declutter_items SET seller_hidden = true WHERE id = '${I(3)}'`);
ok((await sees(BUYER, 3)) === false && (await sees(SELLER2, 3)) === true, "  a hidden seller's item: only the seller");

// D. The item windows read answers "not found" as PT404 (HTTP 404), not P0002 (HTTP 500), message unchanged.
const nf = await me(BUYER, `SELECT * FROM public.declutter_item_pickup_windows('${I(1)}')`);
ok(!Array.isArray(nf) && /item_not_found/.test(nf?.error ?? "") && nf.code === "PT404",
  `a sold item's windows: item_not_found as PT404 (${JSON.stringify(nf)})`);
const nf2 = await me(BUYER, `SELECT * FROM public.declutter_item_pickup_windows('${I(99)}')`);
ok(!Array.isArray(nf2) && nf2.code === "PT404", `an unknown item: the same (${nf2?.code})`);
await svc(`UPDATE public.declutter_items SET seller_hidden = false WHERE id = '${I(3)}'`);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local) VALUES ('${SELLER2}', 2, '09:00', '11:00')`);
const live = await me(BUYER, `SELECT * FROM public.declutter_item_pickup_windows('${I(3)}')`);
ok(Array.isArray(live) && live.length === 1, `a live item's windows still read (${Array.isArray(live) ? live.length : live?.error})`);
ok(!Array.isArray(await me(OUTSIDER, `SELECT * FROM public.declutter_item_pickup_windows('${I(3)}')`)), "  a non-tester is still refused");

// E. Grants and shape.
const acl = await svc(`SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS m,
    p.provolatile::text AS v, p.prosecdef AS d, array_to_string(p.proconfig, ',') AS cfg
  FROM pg_proc p WHERE p.proname = 'declutter_item_pickup_windows'`);
ok(Array.isArray(acl) && acl.length === 1 && acl[0].a === false && acl[0].m === true && acl[0].v === "s" && acl[0].d === true && /search_path=/.test(acl[0].cfg),
  `windows read: anon revoked, members granted, STABLE SECURITY DEFINER, search_path pinned (${JSON.stringify(acl)})`);
const pols = await svc(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'declutter_items' AND cmd = 'SELECT'`);
ok(one(pols) === 1, `declutter_items keeps exactly one read policy (${one(pols)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

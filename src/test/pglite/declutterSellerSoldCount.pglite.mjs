#!/usr/bin/env node
/**
 * PGlite proof for 20261028202132_declutter_seller_sold_count (lead 2026-10-28): "N sold" on a seller's profile,
 * the number of items the seller handed over through Declutter, priced above $0. One integer, nothing else.
 *
 *   node src/test/pglite/declutterSellerSoldCount.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerSoldCount.pglite.mjs # RED: no such function
 *   MIGRATION_PATH=<planted copy> node ...                                      # RED on a planted defect
 *
 * World: the seller-delivery proof's chain (scripts/declutter/slice3Harness.mjs); seed_hidden_for (prod:
 * 20261007033530, reads the launch switch) stubbed by a one-row flag the proof flips; then this migration 3x.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028202132_declutter_seller_sold_count.sql";
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
const { SELLER, SELLER2, SELLER3, BUYER, BUYER2, OUTSIDER } = USERS;
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

await db.exec(`CREATE TABLE public.seed_flag (hidden boolean NOT NULL); INSERT INTO public.seed_flag VALUES (false);
  CREATE OR REPLACE FUNCTION public.seed_hidden_for(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT hidden FROM public.seed_flag $$;
  REVOKE ALL ON FUNCTION public.seed_hidden_for(uuid) FROM PUBLIC, anon, authenticated;`);
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT u, d, '09:00', '18:00' FROM unnest(ARRAY['${SELLER}', '${SELLER2}', '${SELLER3}']::uuid[]) u, generate_series(0, 6) d ON CONFLICT DO NOTHING;`);
const tomorrowNoon = `(((now() AT TIME ZONE 'America/Chicago')::date + 1 + time '12:00') AT TIME ZONE 'America/Chicago')`;
async function order(tag, buyer, seller, items, handOver) {
  for (const [n, price] of items) {
    await db.exec(liveItemSql({ id: I(n), seller, title: `Sold item ${n}`, price, floor: Math.min(price, 100) }));
    await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  }
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', 'pickup_home')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_sc_${tag}', ${o?.total_cents}, now(), 150)`);
  if (handOver) {
    await me(buyer, `SELECT public.declutter_book_pickup('${o?.order_id}', ${tomorrowNoon})`);
    await svc(`UPDATE public.declutter_bookings SET slot_start = now() - interval '25 hours', slot_end = now() - interval '24 hours 30 minutes'
                WHERE order_id = '${o?.order_id}'`);
    await svc(`SELECT public.declutter_handover_sweep()`);
  }
  return o?.order_id;
}
const sold = (uid, seller) => me(uid, `SELECT public.declutter_seller_sold_count('${seller}') AS n`);

const A = await order("a", BUYER, SELLER, [[1, 2000], [2, 1500]], true);
const B = await order("b", BUYER2, SELLER, [[3, 900]], true);
await order("c", BUYER, SELLER, [[4, 1200]], false);
const st = await svc(`SELECT status FROM public.declutter_orders WHERE id IN ('${A}', '${B}')`);
ok(Array.isArray(st) && st.every((r) => r.status === "handed_over"), "setup: two orders handed over (3 items), one only paid");
ok(one(await sold(BUYER2, SELLER)) === 3, `a member reads the seller's count: 3 items handed over (${one(await sold(BUYER2, SELLER))})`);
ok(one(await sold(SELLER, SELLER)) === 3, "  the seller reads the same number");
// A free giveaway is not a sale (the free section allows $0 lines on prod, 20261027170717).
await db.exec(`ALTER TABLE public.declutter_cart_items DROP CONSTRAINT IF EXISTS declutter_cart_items_price_cents_check, DROP CONSTRAINT IF EXISTS declutter_cart_items_price_cap;
  UPDATE public.declutter_cart_items SET price_cents = 0 WHERE order_id = '${B}';`);
ok(one(await sold(BUYER2, SELLER)) === 2, "a $0 (free) line is not counted");
ok(one(await sold(BUYER2, SELLER2)) === 0, "a seller with no sales: 0");
ok(one(await sold(BUYER2, "00000000-0000-0000-0000-00000000f00d")) === 0, "an id that is nobody: 0 (no error, no oracle)");
const shape = await me(BUYER2, `SELECT * FROM public.declutter_seller_sold_count('${SELLER}') AS n`);
ok(Array.isArray(shape) && shape.length === 1 && Object.keys(shape[0]).length === 1 && Number.isInteger(shape[0].n), "one integer, nothing else");

// Test sellers read 0 to anyone the seed switch hides them from.
await order("t", BUYER, SELLER3, [[5, 1000]], true);
await svc(`UPDATE public.seed_flag SET hidden = false`);
ok(one(await sold(BUYER, SELLER3)) === 1, "a test seller's sale counts while the seed switch shows test accounts");
await svc(`UPDATE public.seed_flag SET hidden = true`);
ok(one(await sold(BUYER, SELLER3)) === 0, "  and reads 0 to a member it hides them from");
ok(one(await sold(BUYER, SELLER)) === 2, "  a real seller is unaffected");

ok(refused(await sold(OUTSIDER, SELLER), /feature_disabled/), "a non-tester: feature_disabled (a Declutter number)");
const acl = await svc(`SELECT has_function_privilege('anon', 'public.declutter_seller_sold_count(uuid)', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.declutter_seller_sold_count(uuid)', 'EXECUTE') AS m,
  (SELECT provolatile::text || ':' || prosecdef::text FROM pg_proc WHERE proname = 'declutter_seller_sold_count') AS v`);
ok(Array.isArray(acl) && acl[0]?.a === false && acl[0]?.m === true && acl[0]?.v === "s:true", `anon revoked, members granted, STABLE SECURITY DEFINER (${JSON.stringify(acl?.[0])})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

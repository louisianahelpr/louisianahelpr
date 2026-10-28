#!/usr/bin/env node
/**
 * PGlite proof for 20261028200440_declutter_audit3_notices_and_empty_cart (Declutter audit 3, lead 2026-10-28):
 * an empty cart answers instead of raising (LO2-1); the approval's notices open ?tab=selling; every listing sent
 * tells the seller (A3-4); the seller's Helpr-delivery notices open Selling, not the buyer's cart (SE2-4).
 *
 *   node src/test/pglite/declutterAudit3Server.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAudit3Server.pglite.mjs # RED: today's bodies
 *   MIGRATION_PATH=<planted copy> node ...                                   # RED on a planted defect
 *
 * World: the seller-delivery proof's chain (scripts/declutter/slice3Harness.mjs), seller_hidden (20261021142959,
 * only its column), prod's listing-submitted trigger (20261028162048's function and trigger, verbatim), then this
 * migration 3x. Helpr-delivery setup rows are written with triggers bypassed and said so where they are.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028200440_declutter_audit3_notices_and_empty_cart.sql";
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
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3, ADMIN } = USERS;
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

await db.exec(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false`);
{
  const kinds = readFileSync(`${MIG_DIR}20261028162048_declutter_notice_kinds.sql`, "utf8");
  const fn = /CREATE OR REPLACE FUNCTION public\.declutter_listing_submitted_notice\(\)[\s\S]*?\$fn\$;/.exec(kinds);
  const trg = /DROP TRIGGER IF EXISTS trg_declutter_items_submitted_notice[\s\S]*?declutter_listing_submitted_notice\(\);/.exec(kinds);
  if (!fn || !trg) throw new Error("listing-submitted trigger not found in 20261028162048");
  await db.exec(fn[0]);
  await db.exec(trg[0]);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `33333333-0000-0000-0000-${String(n).padStart(12, "0")}`;
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
const link = async (uid, title) => one(await svc(`SELECT link FROM public.notifications WHERE user_id = '${uid}' AND title = '${title.replace(/'/g, "''")}'
                                                  ORDER BY created_at DESC LIMIT 1`));
const count = async (uid, title) => Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`)));
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT u, d, '09:00', '18:00' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) u, generate_series(0, 6) d ON CONFLICT DO NOTHING;`);

// 1. LO2-1: an empty cart with a seller is an answer, not an error.
const empty = await me(BUYER, `SELECT public.declutter_seller_delivery_offer('${SELLER}') AS o`);
const e = one(empty);
ok(Array.isArray(empty) && e?.available === false && e.reason === "cart_empty" && Array.isArray(e.slots) && e.slots.length === 0,
  `no cart with this seller: {available: false, reason: 'cart_empty', slots: []}, no error (${JSON.stringify(e ?? empty)})`);
ok(e && ["rate_cents", "base_rate_cents", "free_over_cents", "items_cents", "radius_miles", "dropoff_area", "held_slot"].every((k) => e[k] === null),
  "  and nothing about the seller (rate, range, area all null)");
const nobody = one(await me(BUYER, `SELECT public.declutter_seller_delivery_offer('00000000-0000-0000-0000-00000000beef') AS o`));
ok(nobody?.reason === "cart_empty", "  the same answer for an id that is nobody (no oracle)");
ok(refused(await me(BUYER, `SELECT public.declutter_seller_delivery_offer('${BUYER}')`), /item_not_found/), "  asking about yourself is still refused (unchanged)");
await db.exec(liveItemSql({ id: I(1), seller: SELLER, title: "Offer lamp", price: 3000, floor: 1000 }));
await me(BUYER, `SELECT public.declutter_buy_now('${I(1)}', 3000)`);
const withCart = one(await me(BUYER, `SELECT public.declutter_seller_delivery_offer('${SELLER}') AS o`));
ok(withCart?.reason && withCart.reason !== "cart_empty", `  with a cart the offer is computed as before (${withCart?.reason})`);

// 2. The approval's notices open the Selling tab.
for (const [n, approve, title] of [[2, true, "Your listing is live"], [3, false, "Your listing needs a change"]]) {
  await db.exec(liveItemSql({ id: I(n), seller: SELLER2, title: `Review item ${n}`, price: 2000, floor: 1000 }));
  await svc(`UPDATE public.declutter_items SET status = 'pending_review', admin_approved_at = NULL WHERE id = '${I(n)}'`);
  const r = await me(ADMIN, `SELECT public.declutter_admin_review_item('${I(n)}', ${approve}, ${approve ? "NULL" : "'Blurry photo.'"}) AS r`);
  ok(Array.isArray(r) && await link(SELLER2, title) === "/declutter?tab=selling", `"${title}" opens /declutter?tab=selling${Array.isArray(r) ? "" : `: ${r?.error}`}`);
}

// 3. A3-4: every listing sent tells the seller, each naming its item.
for (const n of [4, 5, 6]) {
  await db.exec(liveItemSql({ id: I(n), seller: SELLER, title: `Moving box ${n}`, price: 1000, floor: 500 }));
  await svc(`UPDATE public.declutter_items SET status = 'draft' WHERE id = '${I(n)}'`);
}
for (const n of [4, 5, 6]) await svc(`UPDATE public.declutter_items SET status = 'pending_review' WHERE id = '${I(n)}'`);
const sent = (await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'Listing sent for review' ORDER BY created_at, id`)).map((r) => r.message);
ok(sent.length === 3 && [4, 5, 6].every((n) => sent.some((m) => m.includes(`"Moving box ${n}"`))),
  `three listings sent within a minute: three "Listing sent for review" notices, each naming its item (${sent.length})`);

// 4. The seller's Helpr-delivery notices open Selling; the buyer's are unchanged.
await db.exec(liveItemSql({ id: I(7), seller: SELLER2, title: "Delivered desk", price: 4000, floor: 1000 }));
await me(BUYER2, `SELECT public.declutter_buy_now('${I(7)}', 4000)`);
const d = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))[0];
// Setup only: make it a Helpr delivery before payment (a quote is the helpr-delivery proof's job).
await db.exec(`SET session_replication_role = replica;
  UPDATE public.declutter_orders SET handover = 'delivery', delivery_cents = 1500, total_cents = total_cents + 1500 WHERE id = '${d?.order_id}';
  INSERT INTO public.declutter_order_deliveries (order_id, dropoff_address, dropoff_area, dropoff_lat, dropoff_lng, road_miles, size, delivery_cents)
  VALUES ('${d?.order_id}', '2 B St, Baton Rouge', 'North Baton Rouge', 30.5, -91.15, 4, 'small', 1500);
  SET session_replication_role = origin;`);
const paidRes = await svc(`SELECT public.declutter_mark_order_paid('${d?.order_id}', 'pi_a3', ${(d?.total_cents ?? 0) + 1500}, now(), 150)`);
ok(Array.isArray(paidRes), `setup: the Helpr-delivery order is paid${Array.isArray(paidRes) ? "" : `: ${paidRes?.error}`}`);
ok(await link(SELLER2, "A Helpr will pick it up") === "/declutter?tab=selling", `"A Helpr will pick it up" (seller) opens Selling (${await link(SELLER2, "A Helpr will pick it up")})`);
const taskId = one(await svc(`SELECT id FROM public.helpr_tasks WHERE source_id = '${d?.order_id}'`));
ok(!!taskId, "setup: the Helpr task was opened");
await db.exec(`SET session_replication_role = replica;
  UPDATE public.helpr_tasks SET status = 'accepted', helpr_id = '${BUYER3}', pickup_slot_start = now() + interval '1 day' WHERE id = '${taskId}';
  SET session_replication_role = origin;`);
const ev = async (e2) => svc(`SELECT public.declutter_delivery_on_task_event('${d?.order_id}', '${taskId}', '${e2}', 'helpr')`);
await ev("accepted");
ok(await link(SELLER2, "Helpr pickup booked") === "/declutter?tab=selling", `"Helpr pickup booked" (seller) opens Selling (${await link(SELLER2, "Helpr pickup booked")})`);
ok(await link(BUYER2, "A Helpr took your delivery") === "/declutter?view=cart", "  the buyer's \"A Helpr took your delivery\" is unchanged");
await ev("released");
ok(await link(SELLER2, "Pickup time cancelled") === "/declutter?tab=selling", `"Pickup time cancelled" (seller) opens Selling`);
await ev("picked_up");
ok(await link(SELLER2, "Picked up") === "/declutter?tab=selling", `"Picked up" (seller) opens Selling (${await link(SELLER2, "Picked up")})`);
ok(await link(BUYER2, "Your item is on its way") === "/declutter?view=cart", "  the buyer's \"Your item is on its way\" is unchanged");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

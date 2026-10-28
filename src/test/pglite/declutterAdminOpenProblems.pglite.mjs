#!/usr/bin/env node
/**
 * PGlite proof for 20261028195212_declutter_admin_open_problems (Declutter audit 2 SH2-4 / lead's A2-13): one
 * admin read with each open problem's item, amounts, photos, both people and the handover evidence.
 *
 *   node src/test/pglite/declutterAdminOpenProblems.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAdminOpenProblems.pglite.mjs # RED: no such function
 *   MIGRATION_PATH=<planted copy> node ...                                        # RED on a planted defect
 *
 * World: the seller-delivery proof's chain (scripts/declutter/slice3Harness.mjs), the bundle-discount column
 * (20261027211754, as on prod: only its ADD COLUMN, the one thing this read needs from it) and prod's
 * member_display_name, then this migration 3x. pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028195212_declutter_admin_open_problems.sql";
const NAMES_FILE = "20261021131322_member_names_first_and_initial.sql";
const BUNDLE_FILE = "20261027211754_declutter_bundle_discount.sql";
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
const { SELLER, SELLER2, SELLER3, BUYER, BUYER2, ADMIN } = USERS;
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

await db.exec(`ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS bundle_discount_cents integer NOT NULL DEFAULT 0`);
{
  const names = readFileSync(`${MIG_DIR}${NAMES_FILE}`, "utf8");
  const m = /CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?\$fn\$;/.exec(names) ?? /CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?\$\$;/.exec(names);
  if (!m) throw new Error("member_display_name not found in " + NAMES_FILE);
  await db.exec(m[0]);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `55555555-0000-0000-0000-${String(n).padStart(12, "0")}`;
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT u, d, '09:00', '18:00' FROM unnest(ARRAY['${SELLER}', '${SELLER2}', '${SELLER3}']::uuid[]) u, generate_series(0, 6) d ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET full_name = 'Ann Buyer Smith' WHERE user_id = '${BUYER}';
  UPDATE public.profiles SET full_name = 'Sam Seller' WHERE user_id = '${SELLER}';`);
async function paidOrder(tag, buyer, seller, items, handover = "porch") {
  for (const [n, title, price, photo] of items) {
    await db.exec(liveItemSql({ id: I(n), seller, title, price, floor: Math.min(price, 100) }));
    if (photo) await svc(`INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
                          VALUES ('${I(n)}', '${seller}', '${seller}/declutter/${I(n)}/first.jpg', 0),
                                 ('${I(n)}', '${seller}', '${seller}/declutter/${I(n)}/second.jpg', 1)`);
    await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  }
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_ap_${tag}', ${o?.total_cents}, now(), 150)`);
  return o?.order_id;
}
const report = (uid, order, note) => me(uid, `SELECT public.declutter_report_problem('${order}', 'damaged', '${note}', ARRAY[]::text[]) AS id`);
const list = (uid, arg = "") => me(uid, `SELECT * FROM public.declutter_admin_open_problems(${arg})`);

// The orders.
const A = await paidOrder("a", BUYER, SELLER, [[1, "Brass lamp", 2000, true], [2, "Oak shelf", 1500, false]]);
const B = await paidOrder("b", BUYER2, SELLER2, [[3, "Blue rug", 1800, true]], "pickup_home");
const T = await paidOrder("t", BUYER, SELLER3, [[4, "Fixture table [E2E]", 1200, false]], "pickup_home");
const D = await paidOrder("d", BUYER2, SELLER, [[5, "Decided vase", 900, false]], "pickup_home");
ok(A && B && T && D, "setup: four paid orders (one with a test seller)");
// The porch photo is in (the handover row exists once a pickup is booked; written directly here).
await svc(`INSERT INTO public.declutter_handovers (order_id, code, set_out_photo_path, set_out_at)
            VALUES ('${A}', '1234', '${SELLER}/declutter/handover/${A}/out.jpg', now() - interval '2 hours')
            ON CONFLICT (order_id) DO UPDATE SET set_out_photo_path = EXCLUDED.set_out_photo_path, set_out_at = EXCLUDED.set_out_at`);
const pa = await report(BUYER, A, "Lamp arrived cracked.");
await svc(`UPDATE public.declutter_problems SET created_at = now() - interval '1 hour' WHERE order_id = '${A}'`);
const pb = await report(SELLER2, B, "The buyer says it is damaged; it was fine.");
const pt = await report(BUYER, T, "Test problem.");
await report(BUYER2, D, "Decided already.");
await svc(`UPDATE public.declutter_problems SET status = 'decided', decision = 'pay_seller', fault = 'none', decided_at = now() WHERE order_id = '${D}'`);
// Setup only: B becomes a Helpr delivery (a paid order's handover is frozen by trigger, so triggers are bypassed
// for this one write; booking a real Helpr delivery is the helpr-delivery proof's job).
await db.exec(`SET session_replication_role = replica; UPDATE public.declutter_orders SET handover = 'delivery', delivery_cents = 1200, total_cents = total_cents + 1200 WHERE id = '${B}';
  SET session_replication_role = origin;`);
ok(Array.isArray(pa) && Array.isArray(pb) && Array.isArray(pt), `setup: problems reported${Array.isArray(pa) ? "" : `: ${pa?.error}`}`);

// What the admin reads.
const rows = await list(ADMIN);
ok(Array.isArray(rows), `an admin reads the open problems${Array.isArray(rows) ? "" : `: ${rows?.error}`}`);
const ids = Array.isArray(rows) ? rows.map((r) => r.order_id) : [];
ok(JSON.stringify(ids) === JSON.stringify([A, B]), `open only, oldest first, the test order and the decided one left out (${ids.length})`);
const a = Array.isArray(rows) ? rows.find((r) => r.order_id === A) : null;
const oa = (await svc(`SELECT * FROM public.declutter_orders WHERE id = '${A}'`))[0];
ok(a?.reporter_side === "buyer" && a.reason === "damaged" && a.note === "Lamp arrived cracked." && Array.isArray(a.problem_photo_paths),
  "  the problem: who reported it, why, the note, its photos");
ok(a && ["items_cents", "bundle_discount_cents", "delivery_cents", "premium_cents", "tax_cents", "total_cents"].every((k) => a[k] === oa[k])
  && a.handover === "porch" && a.order_status === "paid" && new Date(a.paid_at).getTime() === new Date(oa.paid_at).getTime(),
  `  the order's handover, status and every amount, as stored (total ${a?.total_cents})`);
ok(JSON.stringify(a?.item_titles) === JSON.stringify(["Brass lamp", "Oak shelf"])
  && JSON.stringify(a?.item_photo_paths) === JSON.stringify([`${SELLER}/declutter/${I(1)}/first.jpg`, null]),
  `  each item's title and FIRST photo, in the same order (none for the shelf) (${JSON.stringify(a?.item_photo_paths)})`);
ok(a?.buyer_id === BUYER && a.buyer_name === "Ann S." && a.seller_id === SELLER && a.seller_name === "Sam S.",
  `  both people, named as the app names them ("${a?.buyer_name}", "${a?.seller_name}")`);
ok(a?.set_out_photo_path?.endsWith("/out.jpg") && a.set_out_at && a.picked_up_photo_path === null && a.confirmed_at === null && a.confirmed_by === null,
  "  the handover photos and times");
ok(a?.helpr_delivery === false && rows.find((r) => r.order_id === B)?.helpr_delivery === true, "  helpr_delivery: true only when a Helpr carries it");
const withTest = await list(ADMIN, "true");
ok(Array.isArray(withTest) && withTest.map((r) => r.order_id).includes(T) && !withTest.map((r) => r.order_id).includes(D),
  "p_include_test => true adds the test order (never a decided one)");
ok(Array.isArray(await list(ADMIN, "p_include_test => false")) && (await list(ADMIN, "NULL")).length === 2, "false or NULL: left out");

// A deleted buyer: the problem still shows, with no name.
await svc(`UPDATE public.declutter_orders SET buyer_id = NULL WHERE id = '${B}'`);
const gone = (await list(ADMIN)).find?.((r) => r.order_id === B);
ok(gone && gone.buyer_id === null && gone.buyer_name === null && gone.seller_name, "a buyer who deleted their account: still listed, no name");

// Who may read it.
ok(refused(await list(BUYER), /not_admin/) && refused(await list(SELLER, "true"), /not_admin/), "a member who is not an admin is refused (not_admin)");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'`);
ok(Array.isArray(await list(ADMIN)) && (await list(ADMIN)).length === 2, "with the Declutter switch off, admins still read open problems (row 62)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);
const acl = await svc(`SELECT has_function_privilege('anon', 'public.declutter_admin_open_problems(boolean)', 'EXECUTE') AS a,
                              has_function_privilege('authenticated', 'public.declutter_admin_open_problems(boolean)', 'EXECUTE') AS m,
                              (SELECT provolatile::text || ':' || prosecdef::text FROM pg_proc WHERE proname = 'declutter_admin_open_problems') AS v`);
ok(Array.isArray(acl) && acl[0]?.a === false && acl[0]?.m === true && acl[0]?.v === "s:true",
  `anon cannot call it; signed-in members reach the admin check; STABLE SECURITY DEFINER (${JSON.stringify(acl?.[0])})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

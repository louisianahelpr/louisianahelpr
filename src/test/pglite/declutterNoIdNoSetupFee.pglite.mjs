#!/usr/bin/env node
/**
 * PGlite proof for 20261120184430_declutter_no_id_no_setup_fee (owner 2026-11-20: no ID check and no $2 anywhere in
 * Declutter; Jobs posters, Helprs and delivery Helprs keep both).
 *
 *   node src/test/pglite/declutterNoIdNoSetupFee.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNoIdNoSetupFee.pglite.mjs  # RED: the buyer and listing are refused
 *
 *   B1 an unverified member's first OFFER, COUNTER and ORDER insert are no longer refused (identity_required_to_buy)  RED before
 *   L1 a first paid listing is no longer refused for the card setup fee (setup_fee_required_to_list)                RED before
 *   F1 declutter_free_claim_gate is gone; declutter_free_hold_charge_words says "Nothing is charged." to a first-timer RED before
 *   S1 declutter_payout_take_setup_fee returns the payout's whole amount and writes no setup fee                     RED before
 *   S2 declutter_my_setup_fee answers fee 0 for a seller who never paid                                             RED before
 *   K1 declutter_identity_gate (Shops' list / buy gates call it) still refuses an unverified member
 *   K2 every restated function (checkout_free, offer_swap, request_bundle, pick_free_request, start_checkout,
 *      complete_handover) is created by the migration (plpgsql parses it), applied 3x
 * Real: the trigger functions and gates from their own migrations (20261021202226, 20261026154738 /
 * 20261031214749, 20261031211922, 20261107185819, 20261103130123, 20261111212343, 20261026154738's fee read,
 * 20261031232943's from-payout read), then this migration verbatim. Stubbed, said so: tables reduced to the columns
 * read; auth.uid() reads test.uid; is_server_context false; has_role false; identity_check_exempt false for everyone
 * (the switch is on for Everyone on prod, read 2026-11-20); every other function a restated body calls is created
 * as a stub only so plpgsql can resolve names at run time (none is called by the checks). pglite from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261120184430_declutter_no_id_no_setup_fee.sql";
const skip = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( before `before`, any dollar-quote tag. */
function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const m = [...src.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, "g"))].pop();
    if (!m) continue;
    const start = m.index;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NEWBIE = u(1), SELLER = u(2);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false,
    is_seed boolean NOT NULL DEFAULT false, onboarding_fee_paid boolean NOT NULL DEFAULT false, onboarding_fee_charged_at timestamptz);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE public.user_roles (user_id uuid, role text);
  CREATE TABLE public.platform_settings (onboarding_fee_cents integer);
  INSERT INTO public.platform_settings VALUES (200);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, status text, current_price_cents integer);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, amount_cents integer);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid);
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, order_id uuid,
    status text, amount_cents integer, setup_fee_cents integer NOT NULL DEFAULT 0, debt_cents integer NOT NULL DEFAULT 0,
    attempts integer NOT NULL DEFAULT 0, send_tried boolean NOT NULL DEFAULT false);
  CREATE TABLE public.payout_send_marks (payout_kind text, payout_id uuid);
  CREATE TABLE public.declutter_porch_places (id uuid);
  CREATE TABLE public.declutter_meetup_spots (id uuid);
  CREATE TABLE public.shipping_quotes (id uuid);
  CREATE TABLE public.helpr_tasks (id uuid);
  CREATE TABLE public.declutter_order_manager_shares (id uuid);
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.identity_check_exempt(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.feature_enabled_for_user(text, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.declutter_order_items_named(uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'it'::text $$;
`);
for (const fn of ["identity_is_verified", "is_identity_verified", "declutter_identity_gate", "declutter_identity_before_buy",
  "declutter_setup_fee_due_cents", "declutter_setup_fee_before_list", "declutter_free_claim_gate",
  "declutter_free_hold_charge_words", "declutter_setup_fee_from_payout_cents", "declutter_payout_take_setup_fee"]) {
  await db.exec(newest(fn));
}
// declutter_my_setup_fee's old body reads more tables; its old answer for a seller with no payout row is fee 200 / no order.
await db.exec(`CREATE TABLE public.admin_audit_log (action text, target_type text, target_id text);
  CREATE TABLE public.declutter_problems (order_id uuid, status text);
  CREATE TABLE public.declutter_refunds (order_id uuid, stripe_payment_intent_id text, reason text, status text);
  CREATE TABLE public.declutter_bookings (order_id uuid, slot_start timestamptz);
  ALTER TABLE public.declutter_orders ADD COLUMN status text, ADD COLUMN items_cents integer, ADD COLUMN handover text,
    ADD COLUMN delivery_cents integer, ADD COLUMN pickup_slot_start timestamptz, ADD COLUMN paid_at timestamptz,
    ADD COLUMN stripe_payment_intent_id text;
  ALTER TABLE public.declutter_payouts ADD COLUMN next_attempt_at timestamptz;
  CREATE FUNCTION public.declutter_sale_final(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`);
await db.exec(newest("declutter_my_setup_fee"));
await db.exec(`
  CREATE TRIGGER trg_declutter_offers_identity_before_buy BEFORE INSERT ON public.declutter_offers
    FOR EACH ROW EXECUTE FUNCTION public.declutter_identity_before_buy();
  CREATE TRIGGER trg_declutter_offers_identity_before_counter BEFORE UPDATE OF amount_cents ON public.declutter_offers
    FOR EACH ROW WHEN (NEW.amount_cents IS DISTINCT FROM OLD.amount_cents) EXECUTE FUNCTION public.declutter_identity_before_buy();
  CREATE TRIGGER trg_declutter_orders_identity_before_buy BEFORE INSERT ON public.declutter_orders
    FOR EACH ROW EXECUTE FUNCTION public.declutter_identity_before_buy();
  CREATE TRIGGER trg_declutter_items_setup_fee_before_list BEFORE INSERT OR UPDATE OF status ON public.declutter_items
    FOR EACH ROW EXECUTE FUNCTION public.declutter_setup_fee_before_list();
  INSERT INTO public.profiles (user_id) VALUES ('${NEWBIE}'), ('${SELLER}');
`);
// Seed rows before the migration, as postgres (no auth.uid(): the gates skip).
await db.exec(`INSERT INTO public.declutter_offers (id, buyer_id, amount_cents) VALUES ('${u(50)}', '${NEWBIE}', 1000);
  INSERT INTO public.declutter_payouts (id, seller_id, status, amount_cents) VALUES ('${u(60)}', '${SELLER}', 'pending', 1500);`);

if (!skip) {
  const sql = readFileSync(MIG_DIR + THIS, "utf8");
  // Run 3x: replay-safe. The restated bodies are created (plpgsql parses them); names they call resolve at run time.
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(sql); check(true, `K2 the migration applies (run ${i})`); }
    catch (e) { check(false, `K2 the migration applies (run ${i})`, e.message); break; }
  }
}

async function asMember(uid, q) {
  await db.exec(`SET test.uid = '${uid}'`);
  try { await db.query(q); return null; } catch (e) { return e.message; } finally { await db.exec(`RESET test.uid`); }
}

let err = await asMember(NEWBIE, `INSERT INTO public.declutter_offers (buyer_id, amount_cents) VALUES ('${NEWBIE}', 900)`);
check(err === null, "B1 an unverified member's first offer is not refused", err ?? "");
err = await asMember(NEWBIE, `UPDATE public.declutter_offers SET amount_cents = 1100 WHERE id = '${u(50)}'`);
check(err === null, "B1 the buyer's own counter is not refused", err ?? "");
err = await asMember(NEWBIE, `INSERT INTO public.declutter_orders (buyer_id, seller_id) VALUES ('${NEWBIE}', '${SELLER}')`);
check(err === null, "B1 an unverified member's first order insert is not refused", err ?? "");
err = await asMember(SELLER, `INSERT INTO public.declutter_items (seller_id, status, current_price_cents) VALUES ('${SELLER}', 'live', 2500)`);
check(err === null, "L1 a first paid listing is not refused for the card setup fee", err ?? "");

const gate = await db.query(`SELECT to_regprocedure('public.declutter_free_claim_gate(uuid)') AS g`);
check(gate.rows[0].g === null, "F1 declutter_free_claim_gate is dropped");
const words = await db.query(`SELECT public.declutter_free_hold_charge_words('${NEWBIE}') AS w`);
check(words.rows[0].w === "Nothing is charged.", "F1 the free hold notice says nothing is charged to a first-timer", words.rows[0].w);

const sent = await db.query(`SELECT public.declutter_payout_take_setup_fee('${u(60)}') AS a`);
const row = await db.query(`SELECT amount_cents, setup_fee_cents FROM public.declutter_payouts WHERE id = '${u(60)}'`);
const prof = await db.query(`SELECT onboarding_fee_paid FROM public.profiles WHERE user_id = '${SELLER}'`);
check(sent.rows[0].a === 1500 && row.rows[0].amount_cents === 1500 && row.rows[0].setup_fee_cents === 0 && prof.rows[0].onboarding_fee_paid === false,
  "S1 the seller's payout keeps its whole amount and no setup fee is taken", JSON.stringify([sent.rows[0], row.rows[0], prof.rows[0]]));

await db.exec(`SET test.uid = '${SELLER}'`);
const mine = await db.query(`SELECT public.declutter_my_setup_fee() AS f`);
await db.exec(`RESET test.uid`);
check(Number(mine.rows[0].f.fee_cents) === 0, "S2 declutter_my_setup_fee answers fee 0", JSON.stringify(mine.rows[0].f));

err = await asMember(NEWBIE, `SELECT public.declutter_identity_gate('${NEWBIE}', 'identity_required_to_list')`);
check(/identity_required_to_list/.test(err ?? ""), "K1 declutter_identity_gate (Shops) still refuses an unverified member", err ?? "no refusal");

const trg = await db.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
  ('trg_declutter_offers_identity_before_buy','trg_declutter_offers_identity_before_counter','trg_declutter_orders_identity_before_buy','trg_declutter_items_setup_fee_before_list')`);
check(trg.rows.length === 0, "B1/L1 the four Declutter ID / fee triggers are gone", trg.rows.map((r) => r.tgname).join(","));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

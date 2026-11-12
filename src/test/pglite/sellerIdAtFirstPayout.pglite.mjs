#!/usr/bin/env node
/**
 * PGlite proof for 20261112065000_declutter_seller_id_at_first_payout (owner 11-12 1:00 AM: the seller's ID check
 * moves from the first listing to the first payout).
 *
 *   node src/test/pglite/sellerIdAtFirstPayout.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/sellerIdAtFirstPayout.pglite.mjs  # RED: the listing is refused
 *
 *   L1 an unverified seller's draft goes live (and into review, and an INSERT straight to live)  RED before
 *   L2 a draft refused before (Sarah's case) publishes as it is, no edit                         RED before
 *   P1 payout_waits_on_identity (the rule declutter-money's checkIdentityHold asks right before every Declutter
 *      transfer) says WAIT for the unverified seller, then CLEAR once verified; CLEAR for a verified and an exempt one.
 *      The run itself (no transfer, an 'identity' wait, paid on the next run) is src/test/edge/declutter-money.test.ts.
 * Kept: K1 the BUYER's gate (an unverified member's offer) still refuses; K5 the migration replays 3x; K6 the restated
 *       declutter_complete_handover parses.
 * Real: declutter_identity_gate, declutter_identity_before_list / _before_buy and their triggers (20261021202226),
 * identity_is_verified, is_identity_verified, payout_waits_on_identity. Stubbed, said so: tables reduced to the columns
 * read; auth.uid() reads test.uid; is_server_context, has_role are false; identity_check_exempt reads a test column
 * (the switch's answer per member). The handover notice's
 * new words are checked from the migration text by src/test/sellerIdAtFirstPayout.test.ts (declutter_complete_handover
 * needs the whole Declutter schema). pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261112065000_declutter_seller_id_at_first_payout.sql";
const LIST_GATE = "20261021202226_declutter_identity_first_buy_or_list.sql";
const skip = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( before `before`, any dollar-quote tag. */
function newest(name, before) {
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
const NEWBIE = u(1), VERIFIED = u(2), EXEMPT = u(3), BUYER = u(9);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false,
    stripe_account_id text, ban_status text, auto_suspended_until timestamptz, test_exempt boolean NOT NULL DEFAULT false);
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.identity_check_exempt(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT COALESCE((SELECT test_exempt FROM public.profiles WHERE user_id = p), false) $$;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text, current_price_cents integer DEFAULT 2000);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, amount_cents integer);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, stripe_payment_intent_id text, gift_cents integer NOT NULL DEFAULT 0);
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, amount_cents integer, attempts integer DEFAULT 0,
    status text DEFAULT 'pending', next_attempt_at timestamptz DEFAULT now() - interval '1 minute', review_held_at timestamptz);
  CREATE TABLE public.declutter_problems (order_id uuid, status text);
  CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text, reason text, status text);
  CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), amount numeric, restored_from_declutter_order_id uuid);
  CREATE FUNCTION public.declutter_order_refunds_recorded_cents(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.declutter_sale_final(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`);
for (const fn of ["identity_is_verified", "is_identity_verified", "payout_waits_on_identity"]) {
  await db.exec(newest(fn, THIS));
}
// The listing and buying gates exactly as 20261021202226 made them (functions + triggers; the cart trigger was dropped
// later by 20261031220849 and is not part of this proof).
await db.exec(readFileSync(MIG_DIR + LIST_GATE, "utf8"));
await db.exec(`DROP TRIGGER IF EXISTS trg_declutter_cart_identity_before_buy ON public.declutter_cart_items`);

await db.query(`INSERT INTO public.profiles (user_id, idv_status, stripe_account_id, test_exempt) VALUES
  ($1, NULL, 'acct_1', false), ($2, 'verified', 'acct_2', false), ($3, NULL, 'acct_3', true), ($4, NULL, NULL, false)`, [NEWBIE, VERIFIED, EXEMPT, BUYER]);
await db.query(`INSERT INTO public.declutter_items (id, seller_id, status) VALUES ($1, $2, 'draft'), ($3, $2, 'draft'), ($4, $2, 'draft')`,
  [u(11), NEWBIE, u(12), u(13)]);

const as = async (uid, sql, params = []) => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
  try { await db.query(sql, params); return null; } catch (e) { return String(e.message); } finally { await db.exec(`SELECT set_config('test.uid', '', false)`); }
};

// Sarah's case, BEFORE the migration: the old gate refuses her draft (the inventory the fix must change is real).
const refusedBefore = await as(NEWBIE, `UPDATE public.declutter_items SET status = 'live' WHERE id = $1`, [u(13)]);
check(/identity_required_to_list/.test(refusedBefore ?? ""), "before: the old gate refuses an unverified seller's draft (identity_required_to_list)", refusedBefore ?? "allowed");

if (!skip) {
  const sql = readFileSync(MIG_DIR + THIS, "utf8");
  // The handover function needs the whole Declutter schema; this proof runs the listing part, and parses the rest.
  const cut = sql.indexOf("CREATE OR REPLACE FUNCTION public.declutter_complete_handover(");
  for (let i = 0; i < 3; i++) await db.exec(sql.slice(0, cut));
  check(true, "K5 the migration's listing part replays 3x");
  // The handover function's body is plpgsql: CREATE parses it (syntax), its tables are read at run time. Its two
  // row types are stand-in tables (only their existence is read at CREATE).
  await db.exec(`CREATE TABLE IF NOT EXISTS public.helpr_tasks (id uuid); CREATE TABLE IF NOT EXISTS public.declutter_order_manager_shares (order_id uuid)`);
  const parsed = await db.exec(sql.slice(cut)).then(() => null, (e) => String(e.message));
  check(parsed === null, "K6 the restated declutter_complete_handover parses (CREATE OR REPLACE succeeds)", parsed ?? "");
}

const live = await as(NEWBIE, `UPDATE public.declutter_items SET status = 'live' WHERE id = $1`, [u(11)]);
check(live === null, "L1 an unverified seller's draft goes live", live ?? "");
const review = await as(NEWBIE, `UPDATE public.declutter_items SET status = 'pending_review' WHERE id = $1`, [u(12)]);
check(review === null, "L1 and into review", review ?? "");
const sarah = await as(NEWBIE, `UPDATE public.declutter_items SET status = 'live' WHERE id = $1`, [u(13)]);
check(sarah === null, "L2 the draft refused before publishes as it is", sarah ?? "");
const inserted = await as(NEWBIE, `INSERT INTO public.declutter_items (id, seller_id, status) VALUES ($1, $2, 'live')`, [u(14), NEWBIE]);
check(inserted === null, "L1 an INSERT straight to live is not refused either", inserted ?? "");
const offer = await as(BUYER, `INSERT INTO public.declutter_offers (buyer_id, amount_cents) VALUES ($1, 1500)`, [BUYER]);
check(/identity_required_to_buy/.test(offer ?? ""), "K1 the buyer's gate is unchanged: an unverified member's offer is refused", offer ?? "allowed");

const waits = async (uid) => (await db.query(`SELECT public.payout_waits_on_identity($1) w`, [uid])).rows[0].w === true;
check(await waits(NEWBIE), "P1 the unverified seller's payout waits (checkIdentityHold reads this before the transfer)");
check(!(await waits(VERIFIED)), "P1 a verified seller's payout does not wait");
check(!(await waits(EXEMPT)), "P1 an exempt seller (the switch off for them) does not wait");
await db.query(`UPDATE public.profiles SET idv_status = 'verified' WHERE user_id = $1`, [NEWBIE]);
check(!(await waits(NEWBIE)), "P1 once the seller verifies, the payout is released on the next run");

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);

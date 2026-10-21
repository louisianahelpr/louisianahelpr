#!/usr/bin/env node
/**
 * PGlite proof for 20261021202226_declutter_identity_first_buy_or_list (owner 2026-10-22, Declutter terms #9:
 * Stripe Identity once across Jobs and Declutter, asked at the first purchase or the first listing).
 *
 *   npx tsx src/test/pglite/declutterIdentityGate.pglite.mjs [--replay] [--before]
 *
 * is_identity_verified, identity_is_verified, identity_check_exempt and is_server_context are PROD's
 * (pg_get_functiondef, read 2026-10-21), verbatim. Writes run as the REAL authenticated role through
 * SECURITY DEFINER stand-ins for the RPCs (the triggers fire whichever RPC writes the row). --before leaves the
 * migration out and the RED checks must FAIL; without it the migration is applied (3x with --replay).
 *
 *   R1 an unverified member cannot publish a listing (draft -> pending_review / live)          RED before
 *   R2 an unverified member cannot make an offer                                                RED before
 *   R3 an unverified member cannot buy now (their own cart line)                                RED before
 *   R4 an unverified member cannot start a checkout (their own order)                           RED before
 * Kept (green before and after):
 *   K1 a member verified through Jobs (idv_status 'verified') lists and buys without being asked again
 *   K2 an admin approving someone's pending listing is not judged (the actor is not the seller)
 *   K3 a seller accepting an offer writes the BUYER's cart line and is not judged on it
 *   K4 server writes (no member session: the AI check, sweeps, webhooks) are not judged
 *   K5 an enrolled test account is exempt; is_seed alone is not                                (K5b RED before)
 *   K6 a listing already live is untouched by other status changes (pause and relist are judged on relist only)
 *   K7 an admin's own first purchase is not judged
 *   R5 a Wanted reply (an offer the SELLER inserts for the poster) is not judged, but the poster's counter is RED before
 *   K8 the seller's counter and the poster's withdraw are not judged
 *   K9 an item put back on sale by the system of a sale (sold -> live, ended -> live) is not a new listing
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261021202226_declutter_identity_first_buy_or_list.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");

let failures = 0;
let redFailures = 0;
const check = (name, ok, detail = "", red = false) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) {
    failures++;
    if (red) redFailures++;
  }
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NEWBIE = U(1), VERIFIED = U(2), ADMIN = U(3), SEED_ENROLLED = U(4), SEED_ONLY = U(5), SELLER = U(6);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false, is_seed boolean DEFAULT false);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 1000, status text NOT NULL DEFAULT 'open');
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid NOT NULL, seller_id uuid);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid NOT NULL, seller_id uuid);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

-- PROD (pg_get_functiondef 2026-10-21), verbatim.
CREATE OR REPLACE FUNCTION public.identity_is_verified(p_idv_status text, p_stripe_identity_verified boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_idv_status IS NOT DISTINCT FROM 'verified' AND p_stripe_identity_verified IS NOT NULL;
$function$;
CREATE OR REPLACE FUNCTION public.is_identity_verified(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified)
      FROM public.profiles p
     WHERE p.user_id = p_user_id
  ), false);
$function$;
CREATE OR REPLACE FUNCTION public.identity_check_exempt(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
      FROM public.profiles p WHERE p.user_id = p_user_id
  ), false);
$function$;
CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;

-- The member RPCs' writes, as SECURITY DEFINER stand-ins (the real RPCs are definers too; auth.uid() is the caller).
CREATE FUNCTION public.t_publish(p_item uuid, p_to text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.declutter_items SET status = p_to WHERE id = p_item $$;
CREATE FUNCTION public.t_offer(p_item uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO public.declutter_offers (item_id, buyer_id) VALUES (p_item, auth.uid()) $$;
CREATE FUNCTION public.t_buy_now(p_item uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO public.declutter_cart_items (item_id, buyer_id) VALUES (p_item, auth.uid()) $$;
CREATE FUNCTION public.t_checkout() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO public.declutter_orders (buyer_id) VALUES (auth.uid()) $$;
CREATE FUNCTION public.t_accept_offer(p_item uuid, p_buyer uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO public.declutter_cart_items (item_id, buyer_id) VALUES (p_item, p_buyer) $$;
CREATE FUNCTION public.t_wanted_reply(p_item uuid, p_poster uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO public.declutter_offers (item_id, buyer_id) VALUES (p_item, p_poster) RETURNING id $$;
CREATE FUNCTION public.t_counter(p_offer uuid, p_amount integer) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.declutter_offers SET amount_cents = p_amount WHERE id = p_offer $$;
CREATE FUNCTION public.t_withdraw(p_offer uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.declutter_offers SET status = 'withdrawn' WHERE id = p_offer $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES
  ('${NEWBIE}', 'not_started', false), ('${VERIFIED}', 'verified', false), ('${ADMIN}', NULL, false),
  ('${SEED_ENROLLED}', NULL, true), ('${SEED_ONLY}', NULL, true), ('${SELLER}', 'verified', false);
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.test_accounts VALUES ('${SEED_ENROLLED}');
`;

const db = new PGlite();
await db.exec(SCHEMA);
if (!BEFORE) for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);

/** Run `sql` as `uid` through the authenticated role; null = ok, else the error message. Rolled back. */
async function as(uid, sql) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  try {
    await db.exec("BEGIN");
    await db.query(sql);
    await db.exec("ROLLBACK");
    return null;
  } catch (e) {
    await db.exec("ROLLBACK");
    return String(e.message);
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);");
  }
}
async function item(seller, status) {
  return (await db.query(`INSERT INTO public.declutter_items (seller_id, status) VALUES ($1, $2) RETURNING id`, [seller, status])).rows[0].id;
}

console.log(`${BEFORE ? "BEFORE (migration left out)" : `AFTER (applied ${REPLAY ? 3 : 1}x)`}`);
const draft = await item(NEWBIE, "draft");
const listed = await item(SELLER, "live");
for (const to of ["pending_review", "live"]) {
  const r = await as(NEWBIE, `SELECT public.t_publish('${draft}', '${to}')`);
  check(`R1 an unverified member cannot move their draft to ${to}`, /identity_required_to_list/.test(r ?? ""), r ?? "allowed", true);
}
check("R2 an unverified member cannot make an offer", /identity_required_to_buy/.test((await as(NEWBIE, `SELECT public.t_offer('${listed}')`)) ?? ""), "", true);
check("R3 an unverified member cannot buy now", /identity_required_to_buy/.test((await as(NEWBIE, `SELECT public.t_buy_now('${listed}')`)) ?? ""), "", true);
check("R4 an unverified member cannot start a checkout", /identity_required_to_buy/.test((await as(NEWBIE, "SELECT public.t_checkout()")) ?? ""), "", true);

const vDraft = await item(VERIFIED, "draft");
const k1 = [
  await as(VERIFIED, `SELECT public.t_publish('${vDraft}', 'live')`),
  await as(VERIFIED, `SELECT public.t_offer('${listed}')`),
  await as(VERIFIED, `SELECT public.t_buy_now('${listed}')`),
  await as(VERIFIED, "SELECT public.t_checkout()"),
];
check("K1 a member verified through Jobs lists and buys without being asked again", k1.every((x) => x === null), JSON.stringify(k1));
const pending = await item(NEWBIE, "pending_review");
check("K2 an admin approving someone's pending listing is not judged", (await as(ADMIN, `SELECT public.t_publish('${pending}', 'live')`)) === null);
check("K3 a seller accepting an offer writes the buyer's cart line unjudged",
  (await as(SELLER, `SELECT public.t_accept_offer('${listed}', '${NEWBIE}')`)) === null);
let serverErr = null;
try {
  await db.exec("BEGIN");
  await db.query(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${draft}'`);
  await db.query(`INSERT INTO public.declutter_orders (buyer_id) VALUES ('${NEWBIE}')`);
} catch (e) {
  serverErr = String(e.message);
} finally {
  await db.exec("ROLLBACK");
}
check("K4 server writes (no member session) are not judged", serverErr === null, serverErr ?? "");
const sDraft = await item(SEED_ENROLLED, "draft");
check("K5 an enrolled test account is exempt", (await as(SEED_ENROLLED, `SELECT public.t_publish('${sDraft}', 'live')`)) === null
  && (await as(SEED_ENROLLED, "SELECT public.t_checkout()")) === null);
check("K5b is_seed alone (not enrolled) is not exempt", /identity_required_to_buy/.test((await as(SEED_ONLY, "SELECT public.t_checkout()")) ?? ""), "", true);
// An unverified member's listing that is already live (listed before the rule) can pause; relisting is judged.
const old = await item(NEWBIE, "live");
check("K6 a live listing pauses freely; relisting it is judged",
  (await as(NEWBIE, `SELECT public.t_publish('${old}', 'paused')`)) === null
  && (await db.query(`UPDATE public.declutter_items SET status = 'paused' WHERE id = '${old}'`), /identity_required_to_list/.test((await as(NEWBIE, `SELECT public.t_publish('${old}', 'live')`)) ?? "")),
  "", true);
check("K7 an admin's own first purchase is not judged", (await as(ADMIN, "SELECT public.t_checkout()")) === null);

// Wanted (review #1): the seller inserts the offer for the poster; the poster's counter is their commitment.
const wReply = await as(SELLER, `SELECT public.t_wanted_reply('${listed}', '${NEWBIE}')`);
const offerId = (await db.query(`INSERT INTO public.declutter_offers (item_id, buyer_id) VALUES ('${listed}', '${NEWBIE}') RETURNING id`)).rows[0].id;
check("R5a a Wanted reply the seller sends to an unverified poster is not judged", wReply === null, wReply ?? "");
check("R5 the unverified poster's counter is judged", /identity_required_to_buy/.test((await as(NEWBIE, `SELECT public.t_counter('${offerId}', 1500)`)) ?? ""), "", true);
check("K8 the seller's counter and the poster's withdraw are not judged",
  (await as(SELLER, `SELECT public.t_counter('${offerId}', 1800)`)) === null && (await as(NEWBIE, `SELECT public.t_withdraw('${offerId}')`)) === null);
// Review #2: put back on sale by the system of a sale (a second no-show, a cancelled haul-away), not a new listing.
const sold = await item(NEWBIE, "sold");
const ended = await item(NEWBIE, "ended");
check("K9 sold -> live and ended -> live by the seller are not judged as a first listing",
  (await as(NEWBIE, `SELECT public.t_publish('${sold}', 'live')`)) === null && (await as(NEWBIE, `SELECT public.t_publish('${ended}', 'live')`)) === null);

const expectedRed = 8; // R1 x2, R2, R3, R4, R5, K5b, K6
console.log(`\n${failures} failure(s)${BEFORE ? `, ${redFailures} of them RED checks (expected: ${expectedRed})` : ""}`);
if (BEFORE) process.exit(redFailures === expectedRed && failures === expectedRed ? 0 : 1);
process.exit(failures === 0 ? 0 : 1);

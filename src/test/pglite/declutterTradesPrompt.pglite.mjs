#!/usr/bin/env node
/**
 * PGlite proof for 20261108193632_declutter_trades_prompt (owner decision 11-08: a one-time "Turn on trades for all
 * your listings?" card on the seller's Selling tab).
 *
 *   node src/test/pglite/declutterTradesPrompt.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterTradesPrompt.pglite.mjs   # RED (no column, no RPC)
 *
 * The world is declutterTrades.pglite.mjs's (the same stubs), with the REAL 20261106163703 applied once, so the real
 * trade triggers run. Then the new migration 3x, and:
 *   - Turn on: only the CALLER's live, priced listings turn on (never a free, draft or another member's listing), and
 *     the caller's listing default turns on; the count it returns is the listings it changed;
 *   - turning on leaves open trade offers and money offers exactly as they were;
 *   - Not now: nothing changes but the answer, and an "on" default stays on;
 *   - the answer is remembered on the account (trades_prompt_answered_at), for a member with or without a defaults row;
 *   - anon cannot run it; a NULL caller is refused (declutter_assert_member, no NULL-uid branch).
 */
import { PGlite, U, liveFunctionSql, makeCheck, readMigration } from "./messageAlertsWorld.mjs";

const TRADES = "20261106163703_declutter_trades.sql";
const NEW = "20261108193632_declutter_trades_prompt.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();

const SELLER = U(1);
const BUYER = U(2);
const OTHER = U(3);
const WANT = U(11);      // the seller's live priced listing (has an open trade offer and an open money offer)
const GIVE = U(12);      // the buyer's listing
const GIVE2 = U(13);     // the buyer's second listing
const FREE = U(14);      // the buyer's free listing
const OTHERS = U(15);    // OTHER's listing
const WANT2 = U(16);     // a second seller listing
const SELLER_FREE = U(17);
const SELLER_DRAFT = U(18);
const SELLER_SOLD = U(19);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.notices (user_id uuid, kind text, title text, message text);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_assert_member(boolean) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF; RETURN auth.uid(); END $$;
CREATE FUNCTION public.declutter_identity_gate(uuid, text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.seed_hidden_for(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_out(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_member_out(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.member_under_18(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_blocks x WHERE (x.blocker_id, x.blocked_id) IN ((a, b), (b, a))) $$;
CREATE FUNCTION public.member_display_name(text, text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce($1, $2) $$;
CREATE FUNCTION public.declutter_price_text(integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT '$' || ($1 / 100)::text $$;
CREATE FUNCTION public.declutter_notice_ref(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_type, p_title, p_message) $$;
CREATE TABLE public.reopened (line uuid);
CREATE FUNCTION public.declutter_reopen_voided_offers(p_line uuid) RETURNS integer LANGUAGE sql AS $$
  INSERT INTO public.reopened VALUES (p_line) RETURNING 1 $$;
CREATE TABLE public.declutter_items (
  id uuid PRIMARY KEY, seller_id uuid NOT NULL, title text NOT NULL, status text NOT NULL,
  price_cents integer NOT NULL, current_price_cents integer NOT NULL, is_seed boolean NOT NULL DEFAULT false,
  seller_hidden boolean NOT NULL DEFAULT false, accepts_offers boolean NOT NULL DEFAULT true, updated_at timestamptz);
CREATE TABLE public.declutter_seller_defaults (
  member_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  keep_up boolean NOT NULL DEFAULT true, drops boolean NOT NULL DEFAULT true, drop_pct smallint NOT NULL DEFAULT 5,
  floor_pct smallint NOT NULL DEFAULT 50, free_after_days smallint, handovers text[] NOT NULL DEFAULT ARRAY['porch']::text[],
  accepts_offers boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.declutter_seller_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_read ON public.declutter_seller_defaults FOR SELECT TO authenticated USING (member_id = (SELECT auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.declutter_seller_defaults TO authenticated;
CREATE TABLE public.declutter_cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, price_cents integer,
  source text, offer_id uuid, checkout_by timestamptz, status text NOT NULL DEFAULT 'in_cart', order_id uuid,
  closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, status text NOT NULL DEFAULT 'open',
  closed_at timestamptz, updated_at timestamptz, voided_by_line uuid);
CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text);
INSERT INTO auth.users VALUES ('${SELLER}'), ('${BUYER}'), ('${OTHER}');
INSERT INTO public.profiles VALUES ('${SELLER}', 'Sam'), ('${BUYER}', 'Bea'), ('${OTHER}', 'Oz');
INSERT INTO public.declutter_items (id, seller_id, title, status, price_cents, current_price_cents) VALUES
  ('${WANT}', '${SELLER}', 'Lamp', 'live', 2000, 2000),
  ('${GIVE}', '${BUYER}', 'Chair', 'live', 3000, 3000),
  ('${GIVE2}', '${BUYER}', 'Rug', 'live', 1500, 1500),
  ('${FREE}', '${BUYER}', 'Box', 'live', 0, 0),
  ('${OTHERS}', '${OTHER}', 'Vase', 'live', 1000, 1000),
  ('${WANT2}', '${SELLER}', 'Mirror', 'live', 2500, 2500),
  ('${SELLER_FREE}', '${SELLER}', 'Books', 'live', 0, 0),
  ('${SELLER_DRAFT}', '${SELLER}', 'Desk', 'draft', 4000, 4000),
  ('${SELLER_SOLD}', '${SELLER}', 'Bike', 'sold', 5000, 5000);
INSERT INTO public.declutter_offers (item_id, buyer_id) VALUES ('${WANT}', '${OTHER}');
${liveFunctionSql("declutter_hold_length", TRADES).sql}
${liveFunctionSql("declutter_take_item", TRADES).sql}
`);

{
  try { await db.exec(readMigration(TRADES)); check("the trades migration applies (world)", true); }
  catch (e) { check("the trades migration applies (world)", false, e.message); }
}
if (!SKIP) {
  const migration = readMigration(NEW);
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(migration); check(`applies, pass ${i}`, true); }
    catch (e) { check(`applies, pass ${i}`, false, e.message); }
  }
}

const as = (uid) => db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);
const attempt = async (sql) => { try { await db.exec(sql); return "allowed"; } catch (e) { return e.message; } };
const one = async (sql) => { try { return (await db.query(sql)).rows[0]; } catch (e) { return { error: e.message }; } };
const trades = async (id) => (await one(`SELECT accepts_trades FROM public.declutter_items WHERE id = '${id}'`))?.accepts_trades;
const answer = async (uid, on) => { await as(uid); return one(`SELECT public.declutter_trades_prompt_answer(${on}) AS n`); };

// An open trade offer on the seller's WANT (from the buyer) and the open money offer from OTHER already there.
await as(SELLER);
await attempt(`SELECT public.declutter_set_trade_rules('${WANT}', true)`);
await as(BUYER);
const swap = await one(`SELECT public.declutter_offer_swap('${WANT}', '${GIVE}') AS id`);
check("world: an open trade offer on the seller's listing", !!swap?.id, JSON.stringify(swap));
// The seller turns WANT off again by editing the column directly (no voiding), so the card has something to turn on
// while the open trade offer still stands: the card must not touch it.
await db.exec(`UPDATE public.declutter_items SET accepts_trades = false WHERE id = '${WANT}'`);
// OTHER answered nothing; their listing is off.
await db.exec(`INSERT INTO public.declutter_seller_defaults (member_id) VALUES ('${BUYER}')`);

// anon / NULL caller.
const anonPriv = await one(`SELECT has_function_privilege('anon', 'public.declutter_trades_prompt_answer(boolean)', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.declutter_trades_prompt_answer(boolean)', 'EXECUTE') AS m`);
check("anon cannot run it; members can", anonPriv && !anonPriv.error && anonPriv.a === false && anonPriv.m === true, JSON.stringify(anonPriv));
await as(null);
await db.exec("SET ROLE anon");
const anonRun = await attempt(`SELECT public.declutter_trades_prompt_answer(true)`);
await db.exec("RESET ROLE");
check("anon running it is refused", /permission denied/.test(anonRun), anonRun);
const nullRun = await attempt(`SELECT public.declutter_trades_prompt_answer(true)`);
check("a NULL caller is refused", /not_authenticated/.test(nullRun), nullRun);
check("a refused call changed nothing", (await trades(WANT)) === false && (await trades(OTHERS)) === false, "");
const nullArg = await answer(SELLER, "NULL");
check("a NULL answer is refused", /invalid_trade_rules/.test(nullArg?.error ?? ""), JSON.stringify(nullArg));

// Turn on (the seller, no defaults row yet).
const n = await answer(SELLER, true);
check("Turn on changes the caller's two live priced listings", n?.n === 2, JSON.stringify(n));
check("the caller's live priced listings are open to trades", (await trades(WANT)) === true && (await trades(WANT2)) === true, "");
check("never a free, draft or sold listing",
  (await trades(SELLER_FREE)) === false && (await trades(SELLER_DRAFT)) === false && (await trades(SELLER_SOLD)) === false, "");
check("never another member's listing",
  (await trades(GIVE)) === false && (await trades(GIVE2)) === false && (await trades(OTHERS)) === false, "");
const sd = await one(`SELECT accepts_trades, trades_prompt_answered_at IS NOT NULL AS answered FROM public.declutter_seller_defaults WHERE member_id = '${SELLER}'`);
check("the caller's listing default turns on and the answer is remembered", sd?.accepts_trades === true && sd?.answered === true, JSON.stringify(sd));
const others = await one(`SELECT count(*)::int AS n FROM public.declutter_seller_defaults WHERE member_id <> '${SELLER}' AND (accepts_trades OR trades_prompt_answered_at IS NOT NULL)`);
check("no other member's defaults change", others?.n === 0, JSON.stringify(others));
const sw = await one(`SELECT status FROM public.declutter_swap_offers WHERE id = '${swap?.id}'`);
const mo = await one(`SELECT status FROM public.declutter_offers WHERE item_id = '${WANT}'`);
check("the open trade offer is untouched", sw?.status === "open", JSON.stringify(sw));
check("the open money offer is untouched", mo?.status === "open", JSON.stringify(mo));
const again = await answer(SELLER, true);
check("a second Turn on changes nothing more", again?.n === 0, JSON.stringify(again));

// Not now: an "on" default stays on.
const nn = await answer(SELLER, false);
const sd2 = await one(`SELECT accepts_trades FROM public.declutter_seller_defaults WHERE member_id = '${SELLER}'`);
check("Not now after Turn on keeps the default on and the listings on",
  nn?.n === 0 && sd2?.accepts_trades === true && (await trades(WANT)) === true, JSON.stringify([nn, sd2]));

// Not now (the buyer, with a defaults row): only the answer.
const b = await answer(BUYER, false);
const bd = await one(`SELECT accepts_trades, trades_prompt_answered_at IS NOT NULL AS answered, keep_up FROM public.declutter_seller_defaults WHERE member_id = '${BUYER}'`);
check("Not now changes no listing", b?.n === 0 && (await trades(GIVE)) === false && (await trades(GIVE2)) === false, JSON.stringify(b));
check("Not now is remembered, the default stays off, the rest of the row is kept",
  bd?.answered === true && bd?.accepts_trades === false && bd?.keep_up === true, JSON.stringify(bd));

// The answer is read by the member under RLS (the card reads it with a plain select).
await as(BUYER);
await db.exec("SET ROLE authenticated");
let rls;
try { rls = (await db.query(`SELECT count(*)::int AS n FROM public.declutter_seller_defaults WHERE trades_prompt_answered_at IS NOT NULL`)).rows[0].n; }
catch (e) { rls = e.message; } finally { await db.exec("RESET ROLE"); }
check("a member reads only their own answer", rls === 1, String(rls));

console.log(`\n${state.failures ? "RED" : "GREEN"}: ${state.failures} failed`);
process.exit(state.failures ? 1 : 0);

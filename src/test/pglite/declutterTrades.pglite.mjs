#!/usr/bin/env node
/**
 * PGlite proof for 20261106163703_declutter_trades (Declutter trades slice 1, owner 10-31, lead plan 11-06).
 *
 *   node src/test/pglite/declutterTrades.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterTrades.pglite.mjs   # RED (no table, no switch, no RPCs)
 *
 * The REAL declutter_take_item and declutter_hold_length (their newest CREATEs before this migration) do the holds;
 * the helpers they and the trade RPCs call are stubbed. Applies the migration 3x, then proves:
 *   - "Open to trades" is OFF by default on a listing and in the seller's defaults; only the owner switches it, never
 *     on a free item;
 *   - an offer needs the seller's switch on, the buyer's OWN live priced listing, and is one-open-per-buyer-per-item
 *     and one-open-per-offered-item;
 *   - decline, withdraw (buyer only) close it; accept reserves BOTH items as $0 lines (each side gets the other's),
 *     voids the other open money offers and trades naming either item, and sends no free-claim notice;
 *   - a listing sold or hidden voids the open trades naming it;
 *   - the sweep expires a past-due offer and ends an accepted trade whose other side missed its pickup choice;
 *   - RLS: only the two sides read a trade; anon cannot run the RPCs; the sweep is service_role only.
 */
import { PGlite, U, makeCheck, liveFunctionSql, readMigration } from "./messageAlertsWorld.mjs";

const NEW = "20261106163703_declutter_trades.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();

const SELLER = U(1);
const BUYER = U(2);
const OTHER = U(3);
const WANT = U(11);      // the seller's listing
const GIVE = U(12);      // the buyer's listing
const GIVE2 = U(13);     // the buyer's second listing
const FREE = U(14);      // the buyer's free listing
const OTHERS = U(15);    // OTHER's listing
const WANT2 = U(16);     // a second seller listing (sold later)
const SELLER_FREE = U(17);

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
CREATE TABLE public.declutter_seller_defaults (member_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
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
  ('${SELLER_FREE}', '${SELLER}', 'Books', 'live', 0, 0);
INSERT INTO public.declutter_offers (item_id, buyer_id) VALUES ('${WANT}', '${OTHER}');
${liveFunctionSql("declutter_hold_length", NEW).sql}
${liveFunctionSql("declutter_take_item", NEW).sql}
`);

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
const swapOf = async (id) => (await one(`SELECT status FROM public.declutter_swap_offers WHERE id = '${id}'`))?.status;
const itemStatus = async (id) => (await one(`SELECT status FROM public.declutter_items WHERE id = '${id}'`))?.status;

// Defaults OFF.
const dflt = await one(`SELECT accepts_trades FROM public.declutter_items WHERE id = '${WANT}'`);
check("a listing is not open to trades by default", dflt?.accepts_trades === false, JSON.stringify(dflt));
await attempt(`INSERT INTO public.declutter_seller_defaults (member_id) VALUES ('${SELLER}')`);
const sd = await one(`SELECT accepts_trades FROM public.declutter_seller_defaults WHERE member_id = '${SELLER}'`);
check("the seller's default is trades OFF", sd?.accepts_trades === false, JSON.stringify(sd));

// Offer refused while trades are off.
await as(BUYER);
const off = await attempt(`SELECT public.declutter_offer_swap('${WANT}', '${GIVE}')`);
check("an offer is refused while the listing is not open to trades", /trades_off/.test(off), off);

// The switch: owner only, never a free item.
await as(OTHER);
const notOwner = await attempt(`SELECT public.declutter_set_trade_rules('${WANT}', true)`);
check("another member cannot switch a listing's trades", /item_not_found/.test(notOwner), notOwner);
await as(SELLER);
const freeOn = await attempt(`SELECT public.declutter_set_trade_rules('${SELLER_FREE}', true)`);
check("a free listing cannot be opened to trades", /free_item_no_trades/.test(freeOn), freeOn);
const on = await attempt(`SELECT public.declutter_set_trade_rules('${WANT}', true)`);
const on2 = await attempt(`SELECT public.declutter_set_trade_rules('${WANT2}', true)`);
check("the seller opens their listings to trades", on === "allowed" && on2 === "allowed", `${on} / ${on2}`);

// Offer rules.
await as(BUYER);
const notMine = await attempt(`SELECT public.declutter_offer_swap('${WANT}', '${OTHERS}')`);
check("the buyer can offer only their own listing", /offered_item_not_yours/.test(notMine), notMine);
const freeGive = await attempt(`SELECT public.declutter_offer_swap('${WANT}', '${FREE}')`);
check("a free listing cannot be offered", /free_item_no_trades/.test(freeGive), freeGive);
await as(SELLER);
const own = await attempt(`SELECT public.declutter_offer_swap('${WANT}', '${WANT2}')`);
check("a seller cannot trade with themself", /own_item|offered_item_not_yours/.test(own), own);
await as(BUYER);
const s1 = await one(`SELECT public.declutter_offer_swap('${WANT}', '${GIVE}') AS id`);
check("the buyer offers a trade", !!s1?.id, JSON.stringify(s1));
const told = await one(`SELECT count(*)::int AS n FROM public.notices WHERE user_id = '${SELLER}' AND title = 'New trade offer'`);
check("the seller is told about the trade offer", told?.n === 1, JSON.stringify(told));
const again = await attempt(`SELECT public.declutter_offer_swap('${WANT}', '${GIVE2}')`);
check("one open trade per buyer per item", /trade_already_open/.test(again), again);
const twice = await attempt(`SELECT public.declutter_offer_swap('${WANT2}', '${GIVE}')`);
check("an offered item sits in one open trade at a time", /offered_item_in_trade/.test(twice), twice);

// Withdraw is the buyer's only; the seller declines.
await as(SELLER);
const sellerWithdraw = await attempt(`SELECT public.declutter_respond_swap('${s1?.id}', 'withdraw')`);
check("the seller cannot withdraw the buyer's offer", /invalid_action/.test(sellerWithdraw), sellerWithdraw);
await as(BUYER);
const buyerAccept = await attempt(`SELECT public.declutter_respond_swap('${s1?.id}', 'accept')`);
check("the buyer cannot accept their own offer", /invalid_action/.test(buyerAccept), buyerAccept);
await as(SELLER);
await attempt(`SELECT public.declutter_respond_swap('${s1?.id}', 'decline')`);
check("the seller declines", (await swapOf(s1?.id)) === "declined", await swapOf(s1?.id));

// RLS before accept: a third member reads nothing; the two sides read it.
await as(BUYER);
const s2 = await one(`SELECT public.declutter_offer_swap('${WANT}', '${GIVE}') AS id`);
const s3 = await one(`SELECT public.declutter_offer_swap('${WANT2}', '${GIVE2}') AS id`);
check("new trade offers after a decline", !!s2?.id && !!s3?.id, JSON.stringify([s2, s3]));
const readAs = async (uid) => {
  await as(uid);
  await db.exec("SET ROLE authenticated");
  try { return (await db.query(`SELECT count(*)::int AS n FROM public.declutter_swap_offers`)).rows[0].n; }
  catch (e) { return e.message; } finally { await db.exec("RESET ROLE"); }
};
const rOther = await readAs(OTHER);
const rBuyer = await readAs(BUYER);
const rSeller = await readAs(SELLER);
check("a third member reads no trades", rOther === 0, String(rOther));
check("the two sides read their trades", rBuyer === 3 && rSeller === 3, `${rBuyer} / ${rSeller}`);
await as(BUYER);
await db.exec("SET ROLE authenticated");
const directWrite = await attempt(`UPDATE public.declutter_swap_offers SET status = 'accepted'`);
await db.exec("RESET ROLE");
check("a member cannot write a trade directly", /permission denied/.test(directWrite), directWrite);

// Accept.
await db.exec(`DELETE FROM public.notices`);
await as(SELLER);
const acc = await one(`SELECT public.declutter_respond_swap('${s2?.id}', 'accept') AS r`);
check("the seller accepts", acc?.r === "accepted", JSON.stringify(acc));
check("both items are reserved", (await itemStatus(WANT)) === "reserved" && (await itemStatus(GIVE)) === "reserved",
  `${await itemStatus(WANT)} / ${await itemStatus(GIVE)}`);
const lines = (await db.query(`SELECT c.item_id, c.buyer_id, c.price_cents FROM public.declutter_swap_offers s
  JOIN public.declutter_cart_items c ON c.id IN (s.buyer_line_id, s.seller_line_id) WHERE s.id = '${s2?.id}' ORDER BY c.item_id`)).rows;
check("each side gets the other's item as a $0 line",
  lines.length === 2 && lines.every((l) => l.price_cents === 0)
  && lines.some((l) => l.item_id === WANT && l.buyer_id === BUYER) && lines.some((l) => l.item_id === GIVE && l.buyer_id === SELLER),
  JSON.stringify(lines));
const moneyOffer = await one(`SELECT status FROM public.declutter_offers WHERE item_id = '${WANT}'`);
check("the open money offer on the item is voided, as by a sale", moneyOffer?.status === "voided", JSON.stringify(moneyOffer));
const freeNotice = await one(`SELECT count(*)::int AS n FROM public.notices WHERE title ILIKE '%free%' OR message ILIKE '%is free%'`);
check("no free-claim notice is sent for a trade", freeNotice?.n === 0, JSON.stringify(freeNotice));
const accNotices = await one(`SELECT count(*)::int AS n FROM public.notices WHERE title LIKE 'Trade %choose a pickup%'`);
check("each side is told to choose a pickup", accNotices?.n === 2, JSON.stringify(accNotices));
const again2 = await attempt(`SELECT public.declutter_respond_swap('${s2?.id}', 'decline')`);
check("an accepted trade cannot be answered again", /trade_not_open/.test(again2), again2);

// A listing sold or hidden voids the open trades naming it.
await db.exec(`UPDATE public.declutter_items SET status = 'sold' WHERE id = '${WANT2}'`);
check("a sold listing voids the open trade naming it", (await swapOf(s3?.id)) === "voided", await swapOf(s3?.id));
await as(BUYER);
await db.exec(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${WANT2}'`);
const s4 = await one(`SELECT public.declutter_offer_swap('${WANT2}', '${GIVE2}') AS id`);
await db.exec(`UPDATE public.declutter_items SET seller_hidden = true WHERE id = '${GIVE2}'`);
check("a hidden offered listing voids the open trade naming it", (await swapOf(s4?.id)) === "voided", await swapOf(s4?.id));
await db.exec(`UPDATE public.declutter_items SET seller_hidden = false WHERE id = '${GIVE2}'`);
const s5 = await one(`SELECT public.declutter_offer_swap('${WANT2}', '${GIVE2}') AS id`);
await as(SELLER);
await attempt(`SELECT public.declutter_set_trade_rules('${WANT2}', false)`);
check("turning trades off closes the open trades on the listing", (await swapOf(s5?.id)) === "voided", await swapOf(s5?.id));

// Sweep: expire, and lapse.
await attempt(`SELECT public.declutter_set_trade_rules('${WANT2}', true)`);
await as(BUYER);
const s6 = await one(`SELECT public.declutter_offer_swap('${WANT2}', '${GIVE2}') AS id`);
await db.exec(`UPDATE public.declutter_swap_offers SET respond_by = now() - interval '1 minute' WHERE id = '${s6?.id}'`);
await as(SELLER);
const late = await attempt(`SELECT public.declutter_respond_swap('${s6?.id}', 'accept')`);
check("a past-due trade cannot be accepted before the sweep runs", /trade_expired/.test(late), late);
await as(null);
await db.exec(`UPDATE public.declutter_cart_items c SET status = 'missed', closed_at = now()
  FROM public.declutter_swap_offers s WHERE s.id = '${s2?.id}' AND c.id = s.buyer_line_id`);
await db.exec(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${WANT}'`);
const sw = await one(`SELECT public.declutter_swap_sweep() AS r`);
check("the sweep expires one and lapses one", sw?.r?.expired === 1 && sw?.r?.lapsed === 1, JSON.stringify(sw));
check("the expired offer is closed", (await swapOf(s6?.id)) === "expired", await swapOf(s6?.id));
check("the half-missed trade lapses", (await swapOf(s2?.id)) === "lapsed", await swapOf(s2?.id));
check("the other side's item goes back up", (await itemStatus(GIVE)) === "live", await itemStatus(GIVE));
const sellerLine = await one(`SELECT c.status FROM public.declutter_swap_offers s JOIN public.declutter_cart_items c ON c.id = s.seller_line_id WHERE s.id = '${s2?.id}'`);
check("the other side's line is released, its voided offers reopened",
  sellerLine?.status === "missed" && (await one(`SELECT count(*)::int AS n FROM public.reopened`))?.n === 1, JSON.stringify(sellerLine));
const sw2 = await one(`SELECT public.declutter_swap_sweep() AS r`);
check("a second sweep changes nothing", sw2?.r?.expired === 0 && sw2?.r?.lapsed === 0, JSON.stringify(sw2));

// Grants.
const priv = await one(`SELECT
  has_function_privilege('anon', 'public.declutter_offer_swap(uuid, uuid)', 'EXECUTE') AS anon_offer,
  has_function_privilege('anon', 'public.declutter_respond_swap(uuid, text)', 'EXECUTE') AS anon_respond,
  has_function_privilege('anon', 'public.declutter_set_trade_rules(uuid, boolean)', 'EXECUTE') AS anon_rules,
  has_function_privilege('authenticated', 'public.declutter_swap_sweep()', 'EXECUTE') AS auth_sweep,
  has_function_privilege('authenticated', 'public.declutter_void_swaps(uuid, text)', 'EXECUTE') AS auth_void,
  has_function_privilege('authenticated', 'public.declutter_swap_items_ok(uuid, uuid, uuid)', 'EXECUTE') AS auth_ok,
  has_function_privilege('authenticated', 'public.declutter_offer_swap(uuid, uuid)', 'EXECUTE') AS auth_offer`);
check("anon runs none of the trade RPCs; members run only offer/respond/rules",
  priv && !priv.error && !priv.anon_offer && !priv.anon_respond && !priv.anon_rules && !priv.auth_sweep && !priv.auth_void && !priv.auth_ok && priv.auth_offer,
  JSON.stringify(priv));

console.log(`\n${state.failures ? "RED" : "GREEN"}: ${state.failures} failed`);
process.exit(state.failures ? 1 : 0);

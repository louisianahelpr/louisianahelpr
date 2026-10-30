#!/usr/bin/env node
/**
 * The Free change (owner 2026-10-29; lead-approved design): members ASK for a free item, the item stays up, the
 * giver picks one person. Runs NEW_FILE VERBATIM (3x) on a prod-shaped fixture, then checks:
 *   - an ask leaves the item live and tells the giver; asking twice returns the same ask;
 *   - at most 3 at a time (asks + free lines waiting + free pickups not done); the 4th is refused;
 *   - the old declutter_claim_free (installed builds) creates an ask, not a cart line;
 *   - only the giver sees who asked; picking gives that person the 48 hours, the rest are told it went elsewhere;
 *   - an item that stops being live or free closes its open asks;
 *   - a missed free pickup pauses asking for 30 days, with the date in the refusal;
 *   - withdraw closes the member's own ask only.
 *
 *   node src/test/pglite/declutterFreeRequests.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFreeRequests.pglite.mjs   # RED: the previous definitions
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_free_requests.sql"));
if (!NEW_FILE) throw new Error("the Free change migration is missing");
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: the migration is not applied (expect FAILs)");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const GIVER = "99999999-0000-0000-0000-000000000000";
const A = "99999999-0000-0000-0000-00000000000a";
const B = "99999999-0000-0000-0000-00000000000b";
const C = "99999999-0000-0000-0000-00000000000c";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('${GIVER}'), ('${A}'), ('${B}'), ('${C}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);
INSERT INTO public.profiles VALUES ('${A}', 'Ann Able'), ('${B}', 'Bo Baker'), ('${C}', 'Cy Cole');
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, title text, status text DEFAULT 'live',
  sale_mode text DEFAULT 'offers', current_price_cents integer DEFAULT 0, is_seed boolean DEFAULT false, updated_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text,
  paid_with text, close_reason text, closed_at timestamptz);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
  price_cents integer, status text DEFAULT 'in_cart', order_id uuid, checkout_by timestamptz);
CREATE TABLE public.notices (user_id uuid, title text, message text);
CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_assert_member(s boolean) RETURNS uuid LANGUAGE sql AS $$ SELECT auth.uid() $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_out(a uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_member_out(a uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_free_rules() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"max_open_claims": 3}'::jsonb $$;
CREATE FUNCTION public.member_display_name(n text, f text) RETURNS text LANGUAGE sql AS $$ SELECT coalesce(split_part(n, ' ', 1), f) $$;
CREATE FUNCTION public.get_public_profile_stats(p_user_ids uuid[]) RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric)
  LANGUAGE sql AS $$ SELECT u, 2, 4.5 FROM unnest(p_user_ids) u $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_actor uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_title, p_message) $$;
-- The real declutter_take_item reserves the item and opens a 48-hour line (restated in DA-12); the fixture does the same.
CREATE FUNCTION public.declutter_take_item(p_item_id uuid, p_buyer uuid, p_price integer, p_source text, p_offer_id uuid)
  RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; s uuid;
BEGIN
  UPDATE public.declutter_items SET status = 'reserved' WHERE id = p_item_id AND status = 'live' RETURNING seller_id INTO s;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_available'; END IF;
  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, checkout_by)
  VALUES (p_item_id, p_buyer, s, p_price, now() + interval '48 hours') RETURNING id INTO v;
  RETURN v;
END $$;
-- The previous declutter_claim_free, first come first served (prod md5 b1b3e96c, guards trimmed to the fixture).
CREATE FUNCTION public.declutter_claim_free(p_item_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN RETURN public.declutter_take_item(p_item_id, auth.uid(), 0, 'buy', NULL); END $$;
`);

if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const as = async (uid, s, p = []) => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
  return q(s, p);
};
const err = async (uid, s, p = []) => {
  try { await as(uid, s, p); return null; } catch (e) { return `${e.message} ${e.hint ?? ""}`; }
};
const item = async (title) => (await q(`INSERT INTO public.declutter_items (seller_id, title) VALUES ($1, $2) RETURNING id`, [GIVER, title]))[0].id;

const lamp = await item("Free lamp");
let reqA = null;
try { reqA = (await as(A, `SELECT public.declutter_request_free($1) id`, [lamp]))[0].id; } catch (e) { check("asking works", false, e.message); }
check("an ask is recorded as open", reqA !== null && (await q(`SELECT status FROM public.declutter_free_requests WHERE id = $1`, [reqA]).catch(() => []))[0]?.status === "open");
check("the item stays up after an ask", (await q(`SELECT status FROM public.declutter_items WHERE id = $1`, [lamp]))[0].status === "live");
check("and nobody has a cart line yet", (await q(`SELECT count(*)::int n FROM public.declutter_cart_items WHERE item_id = $1`, [lamp]))[0].n === 0);
check("the giver is told someone asked",
  (await q(`SELECT message FROM public.notices WHERE user_id = $1`, [GIVER])).some((n) => n.message.includes("Free lamp")));
const again = await as(A, `SELECT public.declutter_request_free($1) id`, [lamp]).catch(() => [{}]);
check("asking twice returns the same ask", reqA !== null && again[0].id === reqA);

// The old claim (installed builds) asks too.
const claimId = await as(B, `SELECT public.declutter_claim_free($1) id`, [lamp]).catch((e) => [{ e: e.message }]);
check("the old claim creates an ask, not a cart line",
  (await q(`SELECT count(*)::int n FROM public.declutter_cart_items WHERE item_id = $1`, [lamp]))[0].n === 0
  && (await q(`SELECT count(*)::int n FROM public.declutter_free_requests WHERE item_id = $1 AND requester_id = $2 AND status = 'open'`, [lamp, B]).catch(() => [{ n: 0 }]))[0].n === 1,
  JSON.stringify(claimId));

// Who asked: giver only, names and ratings.
const list = await as(GIVER, `SELECT * FROM public.declutter_free_requests_for_item($1)`, [lamp]).catch(() => []);
check("the giver sees both asks, oldest first, with names and ratings",
  list.length === 2 && list[0].display_name === "Ann" && list[1].display_name === "Bo" && Number(list[0].avg_rating) === 4.5, JSON.stringify(list));
check("someone who asked cannot read the list", (await err(A, `SELECT * FROM public.declutter_free_requests_for_item($1)`, [lamp]))?.includes("item_not_found") === true);

// Cap: 3 at a time.
const more = [await item("Free rug"), await item("Free vase"), await item("Free stool")];
await as(A, `SELECT public.declutter_request_free($1)`, [more[0]]).catch(() => null);
await as(A, `SELECT public.declutter_request_free($1)`, [more[1]]).catch(() => null);
const fourth = await err(A, `SELECT public.declutter_request_free($1)`, [more[2]]);
check("the 4th open ask is refused", fourth?.includes("free_claim_limit") === true, String(fourth));

// Withdraw: own ask only.
const strangerWithdraw = await err(C, `SELECT public.declutter_withdraw_free_request($1)`, [reqA]);
check("someone else cannot take back an ask", strangerWithdraw?.includes("request_not_found") === true, String(strangerWithdraw));

// Pick B: B gets the line; A is told it went elsewhere.
const reqB = (await q(`SELECT id FROM public.declutter_free_requests WHERE item_id = $1 AND requester_id = $2`, [lamp, B]).catch(() => [{}]))[0]?.id;
const notGiver = await err(A, `SELECT public.declutter_pick_free_request($1)`, [reqB ?? A]);
check("only the giver can pick", notGiver?.includes("request_not_found") === true, String(notGiver));
await as(GIVER, `SELECT public.declutter_pick_free_request($1)`, [reqB ?? A]).catch((e) => check("picking works", false, e.message));
const lines = await q(`SELECT buyer_id, checkout_by > now() + interval '47 hours' fresh FROM public.declutter_cart_items WHERE item_id = $1`, [lamp]);
check("the picked person gets the item with 48 hours", lines.length === 1 && lines[0].buyer_id === B && lines[0].fresh, JSON.stringify(lines));
const st = await q(`SELECT requester_id, status FROM public.declutter_free_requests WHERE item_id = $1 ORDER BY created_at`, [lamp]).catch(() => []);
check("the others are not picked, the picked one is picked",
  st.find((r) => r.requester_id === A)?.status === "not_picked" && st.find((r) => r.requester_id === B)?.status === "picked", JSON.stringify(st));
check("the others are told it went to someone else",
  (await q(`SELECT title FROM public.notices WHERE user_id = $1`, [A])).some((n) => n.title === "It went to someone else"));

// An item that stops being free closes its asks.
await q(`UPDATE public.declutter_items SET current_price_cents = 500 WHERE id = $1`, [more[0]]);
const closed = await q(`SELECT status FROM public.declutter_free_requests WHERE item_id = $1`, [more[0]]).catch(() => []);
check("a repriced item closes its open asks", closed.length === 1 && closed[0].status === "expired", JSON.stringify(closed));

// A missed free pickup pauses asking for 30 days.
const ord = (await q(`INSERT INTO public.declutter_orders (buyer_id, seller_id, status, paid_with) VALUES ($1, $2, 'paid', 'free') RETURNING id`, [C, GIVER]))[0].id;
await q(`UPDATE public.declutter_orders SET status = 'closed', close_reason = 'buyer_no_show' WHERE id = $1`, [ord]);
const paused = await err(C, `SELECT public.declutter_request_free($1)`, [more[2]]);
check("after a missed free pickup, asking is refused with the date", paused?.includes("free_paused") === true && /again on \w+ \d+/.test(paused), String(paused));
const mine = await as(C, `SELECT public.declutter_my_free_pause() d`).catch(() => [{}]);
check("the member can read their pause date", mine[0]?.d != null);
const paidOrd = (await q(`INSERT INTO public.declutter_orders (buyer_id, seller_id, status, paid_with) VALUES ($1, $2, 'paid', 'card') RETURNING id`, [B, GIVER]))[0].id;
await q(`UPDATE public.declutter_orders SET close_reason = 'buyer_no_show' WHERE id = $1`, [paidOrd]);
check("a paid no-show does not pause free asks", (await q(`SELECT count(*)::int n FROM public.declutter_free_pauses WHERE user_id = $1`, [B]).catch(() => [{ n: -1 }]))[0].n === 0);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);

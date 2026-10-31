#!/usr/bin/env node
/**
 * PGlite proof for 20261031211922_free_claim_fee_then_id_restated (B49 20261031003100, rebuilt on main by Builder 28) (owner 2026-10-30: "claimer pays $2 first, then verifies, once ever").
 *
 *   node src/test/pglite/freeClaimFeeThenId.pglite.mjs                     # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/freeClaimFeeThenId.pglite.mjs  # RED (a claim asks for nothing)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The migration runs verbatim against
 * stubs of what it reads, on the REAL older bodies of the two functions it restates, cut from their migrations.
 * Proves, for an ordinary member:
 *   - Switch OFF (prod today): an ask and a free checkout go through, nothing is asked, and no ask reopens.
 *   - Switch ON: asking is free. Picked, the fee FIRST (the ID alone does not pass), then the ID, then the checkout.
 *   - Once ever: a later claim asks for nothing. A member who paid the fee elsewhere is asked only for the ID.
 *   - The order stays $0. Admins and enrolled test accounts are never asked. Members cannot call the gate.
 *   - Not completed: with the item back up, the asks the pick closed reopen and both sides are told. Someone paused,
 *     blocked, out, or at 3 free items stays closed. The picked person's own ask stays closed.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261031211922_free_claim_fee_then_id_restated.sql"), "utf8");

function cutFn(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [GIVER, FIRST, PAID_ELSEWHERE, ADMIN, TESTER, EARLY, OTHER1, PAUSED, BLOCKED, FULL, OUT] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text);
INSERT INTO public.feature_switches VALUES ('identity_check','off');
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.platform_settings (onboarding_fee_cents int);
INSERT INTO public.platform_settings VALUES (200);
CREATE TABLE public.profiles (id uuid, user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, onboarding_fee_paid boolean NOT NULL DEFAULT false,
  idv_status text, full_name text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, status text, sale_mode text DEFAULT 'offers', is_seed boolean DEFAULT false,
  title text DEFAULT 'Lamp', current_price_cents int DEFAULT 0, porch_ok boolean DEFAULT true, updated_at timestamptz);
CREATE TABLE public.declutter_free_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, requester_id uuid, seller_id uuid, status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now(), closed_at timestamptz);
CREATE TABLE public.declutter_free_pauses (user_id uuid PRIMARY KEY, free_blocked_until timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, handover text, items_cents int, premium_cents int, tax_cents int,
  delivery_cents int, total_cents int, setup_fee_cents int, paid_with text DEFAULT 'card', status text NOT NULL DEFAULT 'awaiting_payment', close_reason text, closed_at timestamptz,
  paid_at timestamptz, card_fee_cents int, stripe_checkout_session_id text);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, item_id uuid, buyer_id uuid, seller_id uuid, price_cents int, status text, closed_at timestamptz, checkout_by timestamptz);
CREATE TABLE public.declutter_porch_places (id uuid PRIMARY KEY, seller_id uuid, label text, address text, area text, lat numeric, lng numeric, weekdays int[]);
CREATE TABLE public.declutter_porch_place_choices (buyer_id uuid, seller_id uuid, place_id uuid);
CREATE TABLE public.declutter_order_porch_places (order_id uuid, seller_id uuid, place_id uuid, label text, address text, area text, lat numeric, lng numeric, weekdays int[]);
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.notifications (user_id, title, message) VALUES ($1, $3, $4) $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u AND x.role = r) $$;
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_assert_member(boolean) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_out(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_member_out(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 = '00000000-0000-0000-0000-000000000011'::uuid $$;
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE FUNCTION public.seed_hidden_for(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_free_rules() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"max_open_claims": 3}'::jsonb $$;
CREATE FUNCTION public.member_display_name(text, text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE($1, $2) $$;
CREATE FUNCTION public.declutter_handover_refused(uuid[], text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT audience = 'everyone' FROM public.feature_switches WHERE key = p_key), false) $$;
CREATE FUNCTION public.identity_check_exempt(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT NOT public.feature_enabled_for_user('identity_check', p_user_id) OR COALESCE((SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) FROM public.profiles p WHERE p.user_id = p_user_id), false) $$;
CREATE FUNCTION public.is_identity_verified(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT p.idv_status = 'verified' FROM public.profiles p WHERE p.user_id = p_user_id), false) $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const as = (uid) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
const one = async (q) => (await db.query(q)).rows[0];
const refuses = async (q) => { try { await db.exec(q); return null; } catch (e) { return e.message; } };
const flip = (a) => db.exec(`UPDATE public.feature_switches SET audience='${a}' WHERE key='identity_check'`);

await db.exec(cutFn("20261026154738_declutter_setup_fee_once.sql", "declutter_setup_fee_due_cents"));
await db.exec(cutFn("20261030064021_declutter_free_requests.sql", "declutter_request_free"));
await db.exec(cutFn("20261030064021_declutter_free_requests.sql", "declutter_claim_free"));
await db.exec(cutFn("20261031164337_declutter_door_pickup_uses_places.sql", "declutter_checkout_free"));
await db.exec(`
INSERT INTO public.profiles (id, user_id, onboarding_fee_paid, idv_status, is_seed) VALUES
 ('${GIVER}','${GIVER}',true,'verified',false), ('${FIRST}','${FIRST}',false,'not_started',false),
 ('${PAID_ELSEWHERE}','${PAID_ELSEWHERE}',true,'not_started',false), ('${ADMIN}','${ADMIN}',false,'not_started',false),
 ('${TESTER}','${TESTER}',false,'not_started',true), ('${EARLY}','${EARLY}',false,'not_started',false);
INSERT INTO public.user_roles VALUES ('${ADMIN}','admin');
INSERT INTO public.test_accounts VALUES ('${TESTER}');`);

const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: the old functions");

const item = async () => (await one(`INSERT INTO public.declutter_items (seller_id, status) VALUES ('${GIVER}','live') RETURNING id`)).id;
const ask = async (who, fn = "declutter_request_free") => { await as(who); return refuses(`SELECT public.${fn}('${await item()}')`); };
/** A free line waiting in this member's cart: what the giver's pick leaves behind. */
const waiting = async (who) => {
  const i = (await one(`INSERT INTO public.declutter_items (seller_id, status) VALUES ('${GIVER}','reserved') RETURNING id`)).id;
  await db.exec(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, status, checkout_by) VALUES ('${i}','${who}','${GIVER}',0,'in_cart',now() + interval '1 day')`);
};
const checkout = async (who) => { await as(who); return refuses(`SELECT public.declutter_checkout_free('${GIVER}','pickup_home')`); };
const clearAsks = () => db.exec(`DELETE FROM public.declutter_free_requests`);

// ── OFF: nothing is asked ──────────────────────────────────────────────────
ok("OFF: a first ask goes through", (await ask(EARLY)) === null);
await clearAsks();
await waiting(FIRST);
ok("OFF: a free checkout goes through", (await checkout(FIRST)) === null);
await db.exec(`DELETE FROM public.declutter_orders; DELETE FROM public.declutter_cart_items WHERE buyer_id='${FIRST}'; UPDATE public.declutter_items SET status='live'`);

/** The giver picked one person: their ask 'picked', the others 'not_picked', the item reserved. */
const picked = async (pick, others) => {
  const i = (await one(`INSERT INTO public.declutter_items (seller_id, status) VALUES ('${GIVER}','reserved') RETURNING id`)).id;
  await db.exec(`INSERT INTO public.declutter_free_requests (item_id, requester_id, seller_id, status) VALUES ('${i}','${pick}','${GIVER}','picked');`);
  for (const o of others) await db.exec(`INSERT INTO public.declutter_free_requests (item_id, requester_id, seller_id, status) VALUES ('${i}','${o}','${GIVER}','not_picked');`);
  return i;
};
const backUp = (i) => db.exec(`UPDATE public.declutter_items SET status='live' WHERE id='${i}'`);
const askStatus = async (i, u) => (await one(`SELECT status FROM public.declutter_free_requests WHERE item_id='${i}' AND requester_id='${u}'`)).status;
const told = async (u, title) => (await one(`SELECT count(*)::int c FROM public.notifications WHERE user_id='${u}' AND title='${title}'`)).c;

const offItem = await picked(FIRST, [OTHER1]);
await backUp(offItem);
ok("OFF: back up, no ask reopens", (await askStatus(offItem, OTHER1)) === "not_picked" && (await told(GIVER, "Pick someone else")) === 0);
await db.exec(`DELETE FROM public.declutter_free_requests; UPDATE public.declutter_items SET status='ended'`);

// ── ON ─────────────────────────────────────────────────────────────────────
await flip("everyone");
ok("ON: asking is free: a first-timer's ask goes through", (await ask(FIRST)) === null);
ok("ON: so does the old build's call", (await ask(FIRST, "declutter_claim_free")) === null);
await clearAsks();
await waiting(FIRST);
ok("ON: picked, the fee first", /setup_fee_required_to_claim/.test((await checkout(FIRST)) ?? ""));
ok("and no order was made", (await one(`SELECT count(*)::int c FROM public.declutter_orders WHERE buyer_id='${FIRST}'`)).c === 0);
await db.exec(`UPDATE public.profiles SET idv_status='verified' WHERE user_id='${FIRST}'`);
ok("the fee FIRST: an ID alone does not pass", /setup_fee_required_to_claim/.test((await checkout(FIRST)) ?? ""));
await db.exec(`UPDATE public.profiles SET idv_status='not_started', onboarding_fee_paid=true WHERE user_id='${FIRST}'`);
ok("then the ID: the fee paid, it asks for the check", /identity_required_to_claim/.test((await checkout(FIRST)) ?? ""));
await db.exec(`UPDATE public.profiles SET idv_status='verified' WHERE user_id='${FIRST}'`);
ok("both done: the checkout goes through", (await checkout(FIRST)) === null);
const order = await one(`SELECT total_cents, setup_fee_cents, paid_with FROM public.declutter_orders WHERE buyer_id='${FIRST}'`);
ok("the item stays free: the order is $0", order?.total_cents === 0 && order?.setup_fee_cents === 0 && order?.paid_with === "free", JSON.stringify(order));
await waiting(FIRST);
ok("once ever: the next claim asks nothing", (await checkout(FIRST)) === null);

await waiting(PAID_ELSEWHERE);
ok("paid elsewhere: asked only for the ID", /identity_required_to_claim/.test((await checkout(PAID_ELSEWHERE)) ?? ""));
await waiting(ADMIN);
ok("an admin is never asked", (await checkout(ADMIN)) === null);
await waiting(TESTER);
ok("an enrolled test account is never asked", (await checkout(TESTER)) === null);

// Builder 28 rebuild: the body is main's newest (20261031164337), so a free pickup at the seller's home from a seller
// with saved places is at the place the claimer picked (B49's old base read only 'porch' there).
const PLACE = id(90);
await db.exec(`INSERT INTO public.declutter_porch_places (id, seller_id, label, address, area) VALUES ('${PLACE}','${GIVER}','Front porch','12 Oak St','Mid City');`);
await waiting(TESTER);
ok("places: a home pickup from a seller with places needs the picked place", /porch_place_needed/.test((await checkout(TESTER)) ?? ""));
await db.exec(`INSERT INTO public.declutter_porch_place_choices VALUES ('${TESTER}','${GIVER}','${PLACE}');`);
ok("places: with the place picked, the home pickup goes through", (await checkout(TESTER)) === null);
ok("places: the order carries the picked place", (await one(`SELECT count(*)::int c FROM public.declutter_order_porch_places WHERE place_id='${PLACE}'`)).c === 1);
await db.exec(`DELETE FROM public.declutter_porch_place_choices; DELETE FROM public.declutter_porch_places;`);

// Not completed: the giver can pick someone else.
await db.exec(`DELETE FROM public.notifications; DELETE FROM public.declutter_free_requests; DELETE FROM public.declutter_cart_items;`);
await db.exec(`INSERT INTO public.declutter_free_pauses VALUES ('${PAUSED}', now() + interval '10 days');
  INSERT INTO public.user_blocks VALUES ('${GIVER}','${BLOCKED}');`);
for (let n = 0; n < 3; n++) await db.exec(`INSERT INTO public.declutter_free_requests (item_id, requester_id, seller_id) VALUES (gen_random_uuid(),'${FULL}','${GIVER}')`);
const item1 = await picked(EARLY, [OTHER1, PAUSED, BLOCKED, FULL, OUT]);
await db.exec(`UPDATE public.declutter_items SET title='Lamp' WHERE id='${item1}'`);
await backUp(item1);
ok("back up: someone else who asked is open again, for the giver to pick", (await askStatus(item1, OTHER1)) === "open");
ok("they are told", (await told(OTHER1, "Free item is open again")) === 1);
ok("the giver is told", (await told(GIVER, "Pick someone else")) === 1);
ok("the picked person's own ask stays closed", (await askStatus(item1, EARLY)) === "picked");
ok("paused stays closed", (await askStatus(item1, PAUSED)) === "not_picked");
ok("blocked stays closed", (await askStatus(item1, BLOCKED)) === "not_picked");
ok("at 3 free items stays closed", (await askStatus(item1, FULL)) === "not_picked");
ok("out of Declutter stays closed", (await askStatus(item1, OUT)) === "not_picked");
const alone = await picked(EARLY, []);
await db.exec(`DELETE FROM public.notifications`);
await backUp(alone);
ok("nobody else asked: the giver gets no extra notice", (await told(GIVER, "Pick someone else")) === 0);

if (!skip) {
  const can = async (role) => (await one(`SELECT has_function_privilege('${role}', 'public.declutter_free_claim_gate(uuid)', 'EXECUTE') a`)).a;
  ok("members cannot call the gate", (await can("authenticated")) === false);
  ok("anon cannot call the gate", (await can("anon")) === false);
  ok("service_role keeps the claim", (await one(`SELECT has_function_privilege('service_role', 'public.declutter_request_free(uuid)', 'EXECUTE') a`)).a === true);
} else ok("the gate exists", false);

console.log(failed ? `\n${failed} FAILED` : "\nALL GREEN");
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261106203016_shops_helpr_delivery_reads.sql (Shops Helpr delivery, the Helpr's and the shop's
 * reads; Builder 5, 11-06). A shop task (helpr_tasks.source_kind 'shop_delivery') now answers where it used to be
 * refused, for exactly the people Declutter's answers serve, and nobody else:
 *   - pickup times: an eligible Helpr the shops switch is on for gets 8 AM to 8 PM every day up to the task's latest
 *     pickup; a Helpr the switch is off for, the buyer and the shop get task_not_found;
 *   - same pickup slot: reads the task's own latest pickup (no Declutter order);
 *   - the delivery chat: the three parties read and write it; a stranger cannot; the shop is "the shop" in the
 *     notice and the links are Shops pages;
 *   - the "Helpr didn't come" report: the shop reads its own order's, a stranger reads nothing;
 *   - a moved pickup tells the shop order's buyer;
 *   - Declutter tasks keep their answers (the windows from the seller's hours).
 *
 *   node src/test/pglite/shopsHelprDeliveryReads.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsHelprDeliveryReads.pglite.mjs  # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsHelprDeliveryReads.pglite.mjs
 *
 * check_function_bodies is off: only what a test calls is stubbed. The --before bodies are cut from their newest
 * CREATE before this migration; the dispatchers this migration relies on are cut from 20261106194913.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261106203016_shops_helpr_delivery_reads.sql"), "utf8");

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
const [BUYER, SHOP_OWNER, HELPR, OFF_HELPR, STRANGER, SELLER, DBUYER] = [1, 11, 21, 22, 31, 41, 42].map(id);
const [SHOP_ORDER, DEC_ORDER, SHOP_TASK, DEC_TASK, OPEN_SHOP_TASK, SHOP_ORDER2] = [91, 92, 81, 82, 83, 93].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Switches: 'declutter' is on for everyone (live); 'shops' only for test accounts.
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT p_key = 'declutter' OR EXISTS (SELECT 1 FROM public.test_accounts WHERE user_id = p_uid) $$;
CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.feature_enabled_for_user(p_key, auth.uid()) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
END $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NULL $$;
CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.helpr_task_assert_helpr() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
CREATE FUNCTION public.helpr_task_vehicle_fits(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.helpr_task_same_stripe_mode(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.helpr_task_distance_m(numeric, numeric, numeric, numeric) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.helpr_task_source_slot_ok(text, uuid, timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_lock_order(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE TABLE public.notifications (user_id uuid, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications VALUES (p_user, p_title, p_message, p_link) $$;
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, source_kind text NOT NULL, source_id uuid NOT NULL, status text NOT NULL,
  size text NOT NULL DEFAULT 'small', title text NOT NULL DEFAULT 'Order from Bayou Bakes', customer_id uuid, pickup_contact_id uuid,
  helpr_id uuid, open_until timestamptz, latest_pickup_at timestamptz, pickup_slot_start timestamptz, accepted_at timestamptz,
  pickup_lat numeric DEFAULT 30.2, pickup_lng numeric DEFAULT -92.0, handed_over_at timestamptz, handed_over_to uuid,
  updated_at timestamptz, seller_no_show_reported_at timestamptz, seller_no_show_answer_by timestamptz,
  seller_no_show_answered_at timestamptz, seller_no_show_settled_at timestamptz);
CREATE TABLE public.helpr_task_events (task_id uuid, actor_id uuid, task_event text, created_at timestamptz DEFAULT now());
CREATE FUNCTION public.helpr_task_log(p_task uuid, p_event text, p_actor uuid, p_note text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.helpr_task_events (task_id, actor_id, task_event) VALUES (p_task, p_actor, p_event) $$;
CREATE TABLE public.helpr_task_talk_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, sender_id uuid,
  sender_side text, body text, created_at timestamptz DEFAULT now());
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, problem_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, seller_id uuid, paid_at timestamptz);
CREATE TABLE public.declutter_problems (order_id uuid, status text);
CREATE TABLE public.declutter_order_porch_places (order_id uuid PRIMARY KEY, windows jsonb);
CREATE TABLE public.declutter_pickup_windows (seller_id uuid, weekday smallint, starts_local time, ends_local time);
CREATE FUNCTION public.declutter_order_items_named(uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'a lamp' $$;
`;

const BEFORE = [
  // The --before state of what this migration restates (their newest CREATE before it).
  cutFn("20261103061500_homes_declutter_helpr_reads_not_found_is_404.sql", "helpr_task_pickup_windows"),
  cutFn("20261103061500_homes_declutter_helpr_reads_not_found_is_404.sql", "helpr_task_same_pickup_slot"),
  cutFn("20261103055505_declutter_shops_homes_messages_not_found_is_404.sql", "helpr_task_send_message"),
  cutFn("20261103050349_declutter_orders_talk_admin_not_found_is_404.sql", "helpr_task_talk_view"),
  cutFn("20261031134217_helpr_delivery_seller_reports_no_show.sql", "helpr_task_no_show_report"),
  cutFn("20261104175521_q2390_last_member_not_found_is_404.sql", "helpr_task_seller_move_pickup"),
  // What it relies on, from the Helpr delivery money migration.
  cutFn("20261106194913_shops_helpr_delivery.sql", "helpr_task_source_require_feature"),
  cutFn("20261106194913_shops_helpr_delivery.sql", "helpr_task_lock"),
  cutFn("20261106194913_shops_helpr_delivery.sql", "helpr_task_source_held"),
].join("\n");

const db = new PGlite();
await db.exec("SET check_function_bodies = off;");
await db.exec(SCHEMA);
await db.exec(BEFORE);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
async function as(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);

await db.exec(`
  INSERT INTO public.test_accounts VALUES ('${BUYER}'), ('${SHOP_OWNER}'), ('${HELPR}');
  INSERT INTO public.shop_orders VALUES ('${SHOP_ORDER}', '${BUYER}', '${SHOP_OWNER}'), ('${SHOP_ORDER2}', '${BUYER}', '${SHOP_OWNER}');
  INSERT INTO public.declutter_orders VALUES ('${DEC_ORDER}', '${SELLER}', now());
  INSERT INTO public.declutter_pickup_windows VALUES ('${SELLER}', 2, '09:00', '11:00');
  -- An open shop task (a Helpr may look at its times), a booked one (its chat and the moved pickup), a Declutter one.
  INSERT INTO public.helpr_tasks (id, source_kind, source_id, status, customer_id, pickup_contact_id, open_until, latest_pickup_at)
  VALUES ('${OPEN_SHOP_TASK}', 'shop_delivery', '${SHOP_ORDER2}', 'open', '${BUYER}', '${SHOP_OWNER}', now() + interval '2 days', now() + interval '4 days');
  INSERT INTO public.helpr_tasks (id, source_kind, source_id, status, customer_id, pickup_contact_id, helpr_id, open_until,
    latest_pickup_at, pickup_slot_start, accepted_at, seller_no_show_reported_at)
  VALUES ('${SHOP_TASK}', 'shop_delivery', '${SHOP_ORDER}', 'accepted', '${BUYER}', '${SHOP_OWNER}', '${HELPR}', now() + interval '2 days',
    now() + interval '4 days', now() + interval '1 day', now() - interval '1 hour', now() - interval '5 minutes');
  INSERT INTO public.helpr_tasks (id, source_kind, source_id, status, customer_id, pickup_contact_id, open_until, latest_pickup_at)
  VALUES ('${DEC_TASK}', 'declutter_delivery', '${DEC_ORDER}', 'open', '${DBUYER}', '${SELLER}', now() + interval '2 days', now() + interval '6 days');`);

// --- pickup times
const w = await as(HELPR, `SELECT * FROM public.helpr_task_pickup_windows('${OPEN_SHOP_TASK}')`);
ok(Array.isArray(w) && w.length === 7 && w.every((r) => r.starts === "08:00:00" && r.ends === "20:00:00"),
  `a shops Helpr gets 8 AM to 8 PM every day for a shop task (${JSON.stringify(Array.isArray(w) ? w.length : w)})`);
const lat = one(await db.query(`SELECT latest_pickup_at FROM public.helpr_tasks WHERE id = '${OPEN_SHOP_TASK}'`));
ok(Array.isArray(w) && w[0] && String(w[0].latest_pickup_at) === String(lat), "up to the task's own latest pickup");
ok(refused(await as(OFF_HELPR, `SELECT * FROM public.helpr_task_pickup_windows('${OPEN_SHOP_TASK}')`), /task_not_found/),
  "a Helpr the shops switch is off for gets task_not_found");
ok(refused(await as(BUYER, `SELECT * FROM public.helpr_task_pickup_windows('${OPEN_SHOP_TASK}')`), /task_not_found/),
  "the buyer is no Helpr for their own order");
const dw = await as(OFF_HELPR, `SELECT * FROM public.helpr_task_pickup_windows('${DEC_TASK}')`);
ok(Array.isArray(dw) && dw.length === 1 && dw[0].starts === "09:00:00", `a Declutter task keeps the seller's hours (${JSON.stringify(dw)})`);
const same = await as(HELPR, `SELECT public.helpr_task_same_pickup_slot('${OPEN_SHOP_TASK}') AS s`);
ok(Array.isArray(same), `the same-pickup check answers for a shop task (${JSON.stringify(same)})`);
ok(refused(await as(OFF_HELPR, `SELECT public.helpr_task_same_pickup_slot('${OPEN_SHOP_TASK}')`), /task_not_found/),
  "and refuses a Helpr the shops switch is off for");

// --- the delivery chat
const sent = await as(SHOP_OWNER, `SELECT public.helpr_task_send_message('${SHOP_TASK}', 'Ready at the side door') AS m`);
ok(Array.isArray(sent), `the shop writes in its delivery's chat (${JSON.stringify(sent)})`);
const told = await db.query(`SELECT user_id, message, link FROM public.notifications WHERE title = 'New message about a delivery' ORDER BY user_id`);
ok(told.rows.length === 2 && told.rows.every((r) => /The shop sent a message/.test(r.message)),
  `the Helpr and the buyer are told "the shop" wrote (${JSON.stringify(told.rows.map((r) => r.message))})`);
const links = Object.fromEntries(told.rows.map((r) => [r.user_id, r.link]));
ok(links[BUYER] === "/shops/orders" && links[HELPR] === "/declutter?tab=deliver", `the links are the buyer's Shops orders and the Helpr's Deliver tab (${JSON.stringify(links)})`);
ok(refused(await as(STRANGER, `SELECT public.helpr_task_send_message('${SHOP_TASK}', 'hi')`), /task_not_found/), "a stranger cannot write in it");
const view = await as(BUYER, `SELECT public.helpr_task_talk_view('${SHOP_TASK}') AS v`);
const v = Array.isArray(view) ? view[0].v : view;
ok(v?.side === "buyer" && v?.open === true && v?.messages?.length === 1, `the buyer reads it (${JSON.stringify(v)})`);
ok(refused(await as(STRANGER, `SELECT public.helpr_task_talk_view('${SHOP_TASK}')`), /task_not_found/), "a stranger cannot read it");

// --- the "Helpr didn't come" report
const rep = await as(SHOP_OWNER, `SELECT public.helpr_task_no_show_report('${SHOP_TASK}') AS r`);
ok(Array.isArray(rep) && rep[0].r?.reported_at, `the shop reads its own order's report (${JSON.stringify(rep)})`);
const none = await as(STRANGER, `SELECT public.helpr_task_no_show_report('${SHOP_TASK}') AS r`);
ok(Array.isArray(none) && none[0].r === null, "a stranger reads nothing");

// --- a moved pickup tells the shop order's buyer
await db.exec(`UPDATE public.helpr_tasks SET seller_no_show_reported_at = NULL WHERE id = '${SHOP_TASK}'`);
const moved = await as(SHOP_OWNER, `SELECT public.helpr_task_seller_move_pickup('${SHOP_TASK}', date_trunc('hour', now()) + interval '30 hours') AS m`);
ok(Array.isArray(moved), `the shop moves the Helpr's pickup (${JSON.stringify(moved)})`);
const mt = await db.query(`SELECT message, link FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Pickup time changed'`);
ok(mt.rows.length === 1 && mt.rows[0].link === "/shops/orders" && /The shop moved the Helpr's pickup of your order/.test(mt.rows[0].message),
  `the buyer is told (${JSON.stringify(mt.rows)})`);

function one(r) {
  return r?.rows?.[0] ? Object.values(r.rows[0])[0] : undefined;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

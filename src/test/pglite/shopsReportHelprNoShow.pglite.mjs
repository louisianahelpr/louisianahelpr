#!/usr/bin/env node
/**
 * PGlite proof for 20261106211136_shops_report_helpr_no_show.sql (Shops Helpr delivery: the shop reports "the Helpr
 * didn't come", as Declutter's declutter_report_helpr_no_show; Builder 5, 11-06).
 *   - only the shop owner reports, only for a charged Helpr-delivery order with a booked Helpr, only 15 minutes after
 *     the booked time, not after "Handed over" to that Helpr, not over an open handover problem; the shops switch and
 *     a ban refuse; a second tap answers the same;
 *   - the report sets the task's seller_no_show_reported_at / answer_by (24 h) and tells the Helpr and the buyer;
 *   - the money is held while the Helpr answers (helpr_task_source_held, cut from 20261106194913);
 *   - the Helpr's answer opens a handover problem (the payout hold), tells the shop, and is refused to anyone else,
 *     late, empty, with contact details, or twice with a different note.
 *
 *   node src/test/pglite/shopsReportHelprNoShow.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsReportHelprNoShow.pglite.mjs  # RED
 *
 * check_function_bodies is off: only what a test calls is stubbed.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261106211136_shops_report_helpr_no_show.sql"), "utf8");

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
const [BUYER, SHOP_OWNER, HELPR, STRANGER, OFF_OWNER, ADMIN] = [1, 11, 21, 31, 12, 51].map(id);
const [ORDER, ORDER_EARLY, ORDER_PICKUP, ORDER_OFF] = [91, 92, 93, 94].map(id);
const [TASK, TASK_EARLY, TASK_OFF] = [81, 82, 84].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (bucket_id text, name text);
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.banned (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT p_key = 'declutter' OR EXISTS (SELECT 1 FROM public.test_accounts WHERE user_id = p_uid) $$;
CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.feature_enabled_for_user(p_key, auth.uid()) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
END $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.banned WHERE user_id = auth.uid()) $$;
-- Test subjects: none here, so the admin notice path runs.
CREATE FUNCTION public.is_test_subject(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.contact_leak_reason(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE WHEN p ~ '[0-9]{3}-[0-9]{3}-[0-9]{4}' THEN 'A phone number' END $$;
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.notifications (user_id uuid, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications VALUES (p_user, p_title, p_message, p_link) $$;
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, source_kind text NOT NULL, source_id uuid NOT NULL, status text NOT NULL,
  title text NOT NULL DEFAULT 'Order from Bayou Bakes', customer_id uuid, pickup_contact_id uuid, helpr_id uuid,
  pickup_slot_start timestamptz, handed_over_at timestamptz, handed_over_to uuid, updated_at timestamptz,
  seller_no_show_reported_at timestamptz, seller_no_show_answer_by timestamptz,
  seller_no_show_answered_at timestamptz, seller_no_show_settled_at timestamptz);
CREATE FUNCTION public.helpr_task_lock(p uuid) RETURNS public.helpr_tasks LANGUAGE sql AS
  $$ SELECT * FROM public.helpr_tasks WHERE id = p FOR UPDATE $$;
CREATE TABLE public.helpr_task_events (task_id uuid, actor_id uuid, task_event text, note text);
CREATE FUNCTION public.helpr_task_log(p_task uuid, p_event text, p_actor uuid, p_note text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.helpr_task_events VALUES (p_task, p_actor, p_event, p_note) $$;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text NOT NULL DEFAULT 'accepted',
  captured_at timestamptz DEFAULT now(), fulfillment text NOT NULL DEFAULT 'helpr_delivers', helpr_unfilled_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, problem_at timestamptz, problem_note text, is_seed boolean DEFAULT false);
`;

const db = new PGlite();
await db.exec("SET check_function_bodies = off;");
await db.exec(SCHEMA);
await db.exec(cutFn("20261106194913_shops_helpr_delivery.sql", "helpr_task_source_held"));
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
const held = async (order) => (await db.query(`SELECT public.helpr_task_source_held('shop_delivery', '${order}') AS h`)).rows[0].h;

await db.exec(`
  INSERT INTO public.test_accounts VALUES ('${BUYER}'), ('${SHOP_OWNER}'), ('${HELPR}'), ('${STRANGER}');
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.shop_orders (id, buyer_id, seller_id) VALUES ('${ORDER}', '${BUYER}', '${SHOP_OWNER}'),
    ('${ORDER_EARLY}', '${BUYER}', '${SHOP_OWNER}'), ('${ORDER_OFF}', '${BUYER}', '${OFF_OWNER}');
  INSERT INTO public.shop_orders (id, buyer_id, seller_id, fulfillment) VALUES ('${ORDER_PICKUP}', '${BUYER}', '${SHOP_OWNER}', 'pickup');
  INSERT INTO public.helpr_tasks (id, source_kind, source_id, status, customer_id, pickup_contact_id, helpr_id, pickup_slot_start) VALUES
    ('${TASK}', 'shop_delivery', '${ORDER}', 'accepted', '${BUYER}', '${SHOP_OWNER}', '${HELPR}', now() - interval '20 minutes'),
    ('${TASK_EARLY}', 'shop_delivery', '${ORDER_EARLY}', 'accepted', '${BUYER}', '${SHOP_OWNER}', '${HELPR}', now() - interval '5 minutes'),
    ('${TASK_OFF}', 'shop_delivery', '${ORDER_OFF}', 'accepted', '${BUYER}', '${OFF_OWNER}', '${HELPR}', now() - interval '1 hour');
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;`);

// --- who may report, and when
ok(refused(await as(STRANGER, `SELECT public.shop_report_helpr_no_show('${ORDER}')`), /order_not_found/), "a stranger gets order_not_found");
ok(refused(await as(BUYER, `SELECT public.shop_report_helpr_no_show('${ORDER}')`), /order_not_found/), "the buyer is not the shop");
ok(refused(await as(HELPR, `SELECT public.shop_report_helpr_no_show('${ORDER}')`), /order_not_found/), "the Helpr is not the shop");
ok(refused(await as(OFF_OWNER, `SELECT public.shop_report_helpr_no_show('${ORDER_OFF}')`), /feature_disabled/),
  "a shop the shops switch is off for is refused");
ok(refused(await as(SHOP_OWNER, `SELECT public.shop_report_helpr_no_show('${ORDER_PICKUP}')`), /not_a_helpr_delivery/),
  "a pickup order has no Helpr to report");
ok(refused(await as(SHOP_OWNER, `SELECT public.shop_report_helpr_no_show('${ORDER_EARLY}')`), /too_early/),
  "not before 15 minutes after the booked time");
await db.exec(`INSERT INTO public.banned VALUES ('${SHOP_OWNER}')`);
ok(refused(await as(SHOP_OWNER, `SELECT public.shop_report_helpr_no_show('${ORDER}')`), /account_restricted/), "a banned shop is refused");
await db.exec(`DELETE FROM public.banned`);
await db.exec(`UPDATE public.helpr_tasks SET handed_over_at = now(), handed_over_to = '${HELPR}' WHERE id = '${TASK}'`);
ok(refused(await as(SHOP_OWNER, `SELECT public.shop_report_helpr_no_show('${ORDER}')`), /already_handed_over/),
  "not after the shop said it handed over to this Helpr");
await db.exec(`UPDATE public.helpr_tasks SET handed_over_at = NULL, handed_over_to = NULL WHERE id = '${TASK}'`);
await db.exec(`INSERT INTO public.shop_handovers (order_id, problem_at, problem_note) VALUES ('${ORDER}', now(), 'buyer says')`);
ok(refused(await as(SHOP_OWNER, `SELECT public.shop_report_helpr_no_show('${ORDER}')`), /problem_open/), "not over an open handover problem");
await db.exec(`DELETE FROM public.shop_handovers`);
ok((await held(ORDER)) === false, "before the report the delivery is not held");

// --- the report
const r1 = await as(SHOP_OWNER, `SELECT public.shop_report_helpr_no_show('${ORDER}') AS r`);
ok(Array.isArray(r1) && r1[0].r?.result === "helpr_told" && r1[0].r?.answer_by, `the shop reports (${JSON.stringify(r1)})`);
const t1 = (await db.query(`SELECT seller_no_show_reported_at IS NOT NULL AND seller_no_show_answer_by - seller_no_show_reported_at = interval '24 hours' AS ok FROM public.helpr_tasks WHERE id = '${TASK}'`)).rows[0];
ok(t1.ok === true, "the report is set and the Helpr has 24 hours to answer");
ok((await held(ORDER)) === true, "the money is held while the Helpr answers");
const told = (await db.query(`SELECT user_id, title, link FROM public.notifications ORDER BY user_id`)).rows;
ok(told.some((n) => n.user_id === HELPR && n.title === "The shop says you didn't come" && n.link === "/declutter?tab=deliver"),
  `the Helpr is told (${JSON.stringify(told)})`);
ok(told.some((n) => n.user_id === BUYER && n.link === "/shops/orders"), "the buyer is told, with a Shops link");
const r2 = await as(SHOP_OWNER, `SELECT public.shop_report_helpr_no_show('${ORDER}') AS r`);
ok(Array.isArray(r2) && r2[0].r?.result === "helpr_told", "a second tap answers the same");
ok((await db.query(`SELECT count(*)::int n FROM public.helpr_task_events WHERE task_event = 'seller_no_show_report'`)).rows[0].n === 1,
  "and logs once");

// --- the Helpr's answer
ok(refused(await as(STRANGER, `SELECT public.shop_helpr_answer_no_show('${TASK}', 'I was there')`), /task_not_found/), "only the booked Helpr answers");
ok(refused(await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK_EARLY}', 'I was there')`), /no_show_not_reported/),
  "nothing to answer without a report");
ok(refused(await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK}', '  ')`), /note_required/), "an empty answer is refused");
ok(refused(await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK}', 'call me 225-555-1234')`), /A phone number in the note/),
  "contact details are refused");
ok(refused(await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK}', 'see photo', '${HELPR}/task/${TASK}/x.jpg')`), /photo_not_uploaded/),
  "a photo that is not in the Helpr's task folder is refused");
const a1 = await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK}', 'I knocked at 2:05 and nobody came') AS r`);
ok(Array.isArray(a1) && a1[0].r === ORDER, `the Helpr answers (${JSON.stringify(a1)})`);
const h = (await db.query(`SELECT problem_at, problem_note FROM public.shop_handovers WHERE order_id = '${ORDER}'`)).rows[0];
ok(h?.problem_at && /I knocked at 2:05/.test(h.problem_note), `the answer opens a handover problem (${JSON.stringify(h)})`);
ok((await held(ORDER)) === true, "so the money stays held for an admin");
const n2 = (await db.query(`SELECT user_id, title FROM public.notifications WHERE title IN ('The Helpr answered your report', 'Shops pickup problem reported')`)).rows;
ok(n2.some((n) => n.user_id === SHOP_OWNER) && n2.some((n) => n.user_id === ADMIN), `the shop and the admin are told (${JSON.stringify(n2)})`);
const a2 = await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK}', 'I knocked at 2:05 and nobody came') AS r`);
ok(Array.isArray(a2) && a2[0].r === ORDER, "the same answer again answers the same");
ok(refused(await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK}', 'something else')`), /already_answered/),
  "a different second answer is refused");
await db.exec(`UPDATE public.helpr_tasks SET seller_no_show_answered_at = NULL, seller_no_show_answer_by = now() - interval '1 minute' WHERE id = '${TASK}'`);
ok(refused(await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK}', 'late')`), /no_show_answer_late/), "no answer after 24 hours");

// --- grants
const acl = (await db.query(`SELECT proname, proacl::text a FROM pg_proc WHERE proname IN ('shop_report_helpr_no_show', 'shop_helpr_answer_no_show')`)).rows;
ok(acl.length === 2 && acl.every((r) => !/(^|[{,])=X/.test(r.a) && !/anon=X/.test(r.a)), `neither PUBLIC nor anon may call them (${JSON.stringify(acl)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

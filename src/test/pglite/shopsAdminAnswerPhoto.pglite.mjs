#!/usr/bin/env node
/**
 * PGlite proof for 20261107035259_shops_admin_answer_photo.sql (Shops Helpr delivery: the Helpr's answer photo to a
 * shop's "the Helpr didn't come" reaches the admin queue; Builder 5, 11-06).
 *   - the Helpr's answer with a photo from their own task folder puts the photo on the order's problem row;
 *   - an answer over a problem already open (the buyer's "I didn't get it") keeps that problem's note AND no photo;
 *   - an answer with no photo leaves none;
 *   - shops_admin_queue (admin only) returns problem_photo_path beside the note; a non-admin is refused;
 *   - the buyer and the shop cannot read the column (it is not in the table's column grant);
 *   - a photo with no problem is refused by the table's CHECK.
 *
 *   node src/test/pglite/shopsAdminAnswerPhoto.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsAdminAnswerPhoto.pglite.mjs  # RED
 *
 * check_function_bodies is off: only what a test calls is stubbed.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const BEFORE = readFileSync(url("20261106211136_shops_report_helpr_no_show.sql"), "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261107035259_shops_admin_answer_photo.sql"), "utf8");

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [BUYER, SHOP_OWNER, HELPR, ADMIN] = [1, 11, 21, 51].map(id);
const [ORDER, ORDER_OPEN, ORDER_NOPHOTO] = [91, 92, 93].map(id);
const [TASK, TASK_OPEN, TASK_NOPHOTO] = [81, 82, 83].map(id);
const SHOP = id(71);

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
CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_test_subject(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.contact_leak_reason(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE FUNCTION public.has_role(p_uid uuid, p_role text) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_uid AND role = p_role) $$;
CREATE TABLE public.notifications (user_id uuid, title text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications VALUES (p_user, p_title) $$;
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, source_kind text NOT NULL, source_id uuid NOT NULL, status text NOT NULL,
  title text NOT NULL DEFAULT 'Order', helpr_id uuid, updated_at timestamptz,
  seller_no_show_reported_at timestamptz, seller_no_show_answer_by timestamptz,
  seller_no_show_answered_at timestamptz, seller_no_show_settled_at timestamptz);
CREATE FUNCTION public.helpr_task_lock(p uuid) RETURNS public.helpr_tasks LANGUAGE sql AS
  $$ SELECT * FROM public.helpr_tasks WHERE id = p FOR UPDATE $$;
CREATE TABLE public.helpr_task_events (task_id uuid, actor_id uuid, task_event text, note text);
CREATE FUNCTION public.helpr_task_log(p_task uuid, p_event text, p_actor uuid, p_note text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.helpr_task_events VALUES (p_task, p_actor, p_event, p_note) $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, name text);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, shop_id uuid, status text NOT NULL DEFAULT 'accepted',
  ready_date date, items_cents int DEFAULT 1000, total_cents int DEFAULT 1200, card_fee_cents int DEFAULT 60, tax_cents int DEFAULT 90,
  handover_mode text DEFAULT 'in_person', is_seed boolean NOT NULL DEFAULT false);
-- As 20261018211820: the column grant names the columns the two sides may read.
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_photo_path text, ready_at timestamptz, confirmed_at timestamptz,
  confirmed_how text, problem_at timestamptz, problem_note text, is_seed boolean DEFAULT false, created_at timestamptz DEFAULT now(),
  CONSTRAINT shop_handovers_problem CHECK ((problem_at IS NULL) = (problem_note IS NULL)));
ALTER TABLE public.shop_handovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_handovers FROM PUBLIC, anon, authenticated;
GRANT SELECT (order_id, ready_photo_path, ready_at, confirmed_at, confirmed_how, problem_at, problem_note, created_at)
  ON TABLE public.shop_handovers TO authenticated;
CREATE POLICY "two sides read" ON public.shop_handovers FOR SELECT TO authenticated USING (true);
CREATE TABLE public.shop_refunds (id uuid, order_id uuid, reason text, fee_policy text, refund_cents int, status text, attempts int,
  last_error text, created_at timestamptz, next_attempt_at timestamptz);
CREATE TABLE public.shop_payouts (id uuid, order_id uuid, amount_cents int, status text, attempts int, last_error text,
  review_reason text, created_at timestamptz);
CREATE TABLE public.payout_holds (helper_id uuid, reason text);
CREATE FUNCTION public.facilitated_la_sales_cents(int) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE TABLE public.shop_strikes (id uuid, user_id uuid, offender_side text, reason text, order_id uuid, given_at timestamptz,
  expires_at timestamptz, removed_at timestamptz, is_seed boolean);
CREATE FUNCTION public.shop_active_strike_count(uuid) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
`;

const db = new PGlite();
await db.exec("SET check_function_bodies = off;");
await db.exec(SCHEMA);
// The answer function before this migration, then (unless skipped) this migration three times.
const cut = (s, name) => {
  const at = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const g = `GRANT EXECUTE ON FUNCTION public.${name}(`;
  const gi = s.indexOf(g, at);
  return s.slice(at, s.indexOf(";", gi) + 1);
};
await db.exec(cut(BEFORE, "shop_helpr_answer_no_show"));
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
const photo = (task) => `${HELPR}/task/${task}/proof.jpg`;

await db.exec(`
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.shops VALUES ('${SHOP}', 'Bayou Bakes');
  INSERT INTO public.shop_orders (id, buyer_id, seller_id, shop_id) VALUES ('${ORDER}', '${BUYER}', '${SHOP_OWNER}', '${SHOP}'),
    ('${ORDER_OPEN}', '${BUYER}', '${SHOP_OWNER}', '${SHOP}'), ('${ORDER_NOPHOTO}', '${BUYER}', '${SHOP_OWNER}', '${SHOP}');
  INSERT INTO public.helpr_tasks (id, source_kind, source_id, status, helpr_id, seller_no_show_reported_at, seller_no_show_answer_by)
  SELECT t, 'shop_delivery', o, 'accepted', '${HELPR}', now() - interval '1 hour', now() + interval '23 hours'
    FROM (VALUES ('${TASK}'::uuid, '${ORDER}'::uuid), ('${TASK_OPEN}', '${ORDER_OPEN}'), ('${TASK_NOPHOTO}', '${ORDER_NOPHOTO}')) v(t, o);
  INSERT INTO storage.objects VALUES ('helpr-tasks', '${photo(TASK)}'), ('helpr-tasks', '${photo(TASK_OPEN)}');
  -- The buyer's "I didn't get it" is already open on ORDER_OPEN.
  INSERT INTO public.shop_handovers (order_id, problem_at, problem_note) VALUES ('${ORDER_OPEN}', now(), 'I did not get it');
  GRANT SELECT ON public.helpr_tasks, public.shop_orders, storage.objects TO authenticated;`);

// --- the answer puts the photo on the problem
const a1 = await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK}', 'I knocked at 2:05', '${photo(TASK)}') AS r`);
ok(Array.isArray(a1) && a1[0].r === ORDER, `the Helpr answers with a photo (${JSON.stringify(a1)})`);
const h1 = (await db.query(`SELECT * FROM public.shop_handovers WHERE order_id = '${ORDER}'`)).rows[0];
ok(h1?.problem_photo_path === photo(TASK), `the photo is on the problem row (${JSON.stringify(h1)})`);

const a2 = await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK_OPEN}', 'I was there', '${photo(TASK_OPEN)}') AS r`);
ok(Array.isArray(a2) && a2[0].r === ORDER_OPEN, `the Helpr answers over an open problem (${JSON.stringify(a2)})`);
const h2 = (await db.query(`SELECT * FROM public.shop_handovers WHERE order_id = '${ORDER_OPEN}'`)).rows[0];
ok(h2?.problem_note === "I did not get it" && h2?.problem_photo_path === null,
  `a problem already open keeps its own note and gets no Helpr photo (${JSON.stringify(h2)})`);

const a3 = await as(HELPR, `SELECT public.shop_helpr_answer_no_show('${TASK_NOPHOTO}', 'I was there') AS r`);
const h3 = (await db.query(`SELECT * FROM public.shop_handovers WHERE order_id = '${ORDER_NOPHOTO}'`)).rows[0];
ok(Array.isArray(a3) && h3?.problem_at && h3?.problem_photo_path === null, `an answer with no photo leaves none (${JSON.stringify(h3)})`);

// --- the admin queue
const q = await as(ADMIN, `SELECT public.shops_admin_queue() AS q`);
const probs = Array.isArray(q) ? q[0].q.problems : [];
const p1 = probs.find((p) => p.order_id === ORDER);
ok(p1?.problem_photo_path === photo(TASK) && /I knocked/.test(p1?.problem_note ?? ""),
  `the admin queue shows the photo beside the note (${JSON.stringify(p1)})`);
ok(probs.length === 3 && probs.filter((p) => p.problem_photo_path).length === 1, `exactly one problem carries a photo (${probs.length})`);
ok(refused(await as(BUYER, `SELECT public.shops_admin_queue()`), /admin_only/), "a non-admin cannot read the queue");

// --- the two sides cannot read the column; the CHECK
ok(refused(await as(SHOP_OWNER, `SELECT problem_photo_path FROM public.shop_handovers`), /permission denied/),
  "the shop cannot read the photo path from the table");
ok(refused(await as(BUYER, `SELECT problem_photo_path FROM public.shop_handovers`), /permission denied/),
  "the buyer cannot read the photo path from the table");
let checkRefused = false;
try {
  await db.exec(`INSERT INTO public.shop_handovers (order_id, problem_photo_path) VALUES ('${id(99)}', 'x/task/y/z.jpg')`);
} catch (e) {
  checkRefused = /shop_handovers_problem_photo/.test(String(e.message));
}
ok(checkRefused, "a photo with no problem is refused");

// --- grants
const acl = (await db.query(`SELECT proname, proacl::text a FROM pg_proc WHERE proname IN ('shop_helpr_answer_no_show', 'shops_admin_queue')`)).rows;
ok(acl.length === 2 && acl.every((r) => r.a && !/(^|[{,])=X/.test(r.a) && !/anon=X/.test(r.a)), `neither PUBLIC nor anon may call them (${JSON.stringify(acl)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

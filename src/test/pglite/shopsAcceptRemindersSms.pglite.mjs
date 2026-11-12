#!/usr/bin/env node
/**
 * PGlite proof for 20261112075428_shops_accept_reminders.sql, the TEXT half (S016, Shops audit 11-12): the shop's
 * "Answer the new order" / "Order drops soon" reminders are texted as needs-you reminders (sms_kind_for), and a text
 * whose order the shop answered while it waited is dropped at claim time as 'step_done' (sms_claim_due). The sweep
 * half is src/test/pglite/shopsAcceptReminders.pglite.mjs.
 *
 *   node src/test/pglite/shopsAcceptRemindersSms.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shopsAcceptRemindersSms.pglite.mjs  # RED: no shop reminders or texts
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsAcceptRemindersSms.pglite.mjs  # RED on a planted defect
 *
 * World: smsNeedsYouStepDone.pglite.mjs's (the SMS migration, stub Declutter tables, 20261102002011 and 20261102034632
 * applied once) plus stub shops / shop_orders, then this migration 3x. pglite from ~/.lh-pglite.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const SMS = new URL("../../../supabase/migrations/20261021193738_sms_alerts.sql", import.meta.url).pathname;
const BASE = new URL("../../../supabase/migrations/20261102002011_needs_you_deadline_reminders.sql", import.meta.url).pathname;
const STEP_DONE = new URL("../../../supabase/migrations/20261102034632_sms_needs_you_step_done.sql", import.meta.url).pathname;
const NEW = process.env.MIGRATION_PATH ?? new URL("../../../supabase/migrations/20261112075428_shops_accept_reminders.sql", import.meta.url).pathname;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const A = "11111111-1111-1111-1111-111111111111"; // seller, admin, opted in to texts
const B = "22222222-2222-2222-2222-222222222222"; // buyer, never opts in
const S = "33333333-3333-3333-3333-333333333333"; // seed admin
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true),'')::uuid $$;
CREATE SCHEMA net; CREATE TABLE net.calls (id serial, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls(url, body) VALUES (url, body) RETURNING id::bigint $$;
CREATE TYPE public.app_role AS ENUM ('admin','user');
CREATE TABLE public.user_roles (user_id uuid, role app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE TABLE public.test_accounts (user_id uuid, enrolled_at timestamptz, note text);
CREATE TABLE public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid, is_seed boolean default false, phone text,
  ban_status text default 'active', auto_suspended_until timestamptz);
CREATE TABLE public.banned_stub (user_id uuid primary key);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.banned_stub WHERE user_id = auth.uid()) $$;
CREATE TABLE public.feature_switches (key text primary key, audience text, description text, created_at timestamptz default now(), updated_at timestamptz default now());
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE((SELECT CASE s.audience WHEN 'everyone' THEN true WHEN 'testers' THEN COALESCE(public.has_role(p_user_id, 'admin'::app_role), false) OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id) ELSE false END FROM public.feature_switches s WHERE s.key = p_key AND p_user_id IS NOT NULL), false); $function$;
CREATE FUNCTION public.get_supabase_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://x.supabase.co' $$;
CREATE FUNCTION public.get_service_role_key() RETURNS text LANGUAGE sql AS $$ SELECT 'k' $$;
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null, message text not null, type text not null, read boolean not null default false, link text, created_at timestamptz not null default now(), job_id uuid);
CREATE TABLE public.notification_preferences (id uuid default gen_random_uuid(), user_id uuid unique, messages boolean default true, job_matches boolean default true, work_status boolean default true, job_updates boolean default true, new_offers boolean default true, job_applications boolean default true, system_alerts boolean default true, payments boolean default true, financial_alerts boolean default true, declutter_offers boolean default true, declutter_refunds boolean default true, declutter_pickups boolean default true, declutter_sales boolean default true, quiet_start time, quiet_end time);
CREATE TABLE public.error_logs (id serial, severity text, message text, url text, tags jsonb, context jsonb);
CREATE TABLE public.notification_type_pref_map (type text primary key, pref_column text);
INSERT INTO notification_type_pref_map VALUES ('message','messages'),('job_match','job_matches'),('info','work_status'),('success','work_status'),('work_status','work_status'),('job_updates','job_updates'),('job_update','job_updates'),('expired','job_updates'),('new_offers','new_offers'),('application','job_applications'),('warning','system_alerts'),('payment','payments'),('financial_alerts','financial_alerts'),('declutter_offers','declutter_offers'),('declutter_refunds','declutter_refunds'),('declutter_pickups','declutter_pickups'),('declutter_sales','declutter_sales');
INSERT INTO auth.users VALUES ('${A}'),('${B}'),('${S}');
INSERT INTO user_roles VALUES ('${A}','admin'),('${S}','admin');
INSERT INTO profiles(user_id,is_seed) VALUES ('${A}',false),('${B}',false),('${S}',true);
INSERT INTO test_accounts(user_id) VALUES ('${S}');
`);

const q = async (s, p = []) => (await db.query(s, p)).rows;
const one = async (s, p = []) => Object.values((await q(s, p))[0] ?? {})[0];
const as = async (uid, s, p = []) => { await db.exec(`SET request.uid='${uid ?? ""}'`); try { return await q(s, p); } finally { await db.exec(`RESET request.uid`); } };
const results = [];
const check = (name, ok, detail) => { results.push([name, ok]); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };

await db.exec(readFileSync(SMS, "utf8"));
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
await as(A, `select set_sms_consent(true,'(225) 555-0123')`);
const cc = (await q(`select sms_claim_confirmation($1,true) r`, [A]))[0].r;
check("setup: A is opted in to texts", (await one(`select sms_inbound_keyword('+12255550123','start',$1)`, [cc.code])) === 1);

// Stub Declutter world: only the columns the sweep reads.
await db.exec(`
CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb) RETURNS void LANGUAGE sql
  AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;
CREATE TABLE public.declutter_items (id uuid primary key default gen_random_uuid(), title text);
CREATE TABLE public.declutter_offers (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
  status text, awaiting text, respond_by timestamptz, is_seed boolean default false);
CREATE TABLE public.declutter_orders (id uuid primary key default gen_random_uuid(), buyer_id uuid, seller_id uuid);
CREATE TABLE public.declutter_cart_items (id uuid primary key default gen_random_uuid(), order_id uuid, item_id uuid, created_at timestamptz default now());
CREATE TABLE public.declutter_refund_requests (id uuid primary key default gen_random_uuid(), order_id uuid, status text,
  answer_by timestamptz, offer_answer_by timestamptz, is_seed boolean default false);
CREATE TABLE public.notify_fail (on_title text);
CREATE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.notify_fail WHERE on_title = p_title) THEN RAISE EXCEPTION 'planted notice failure'; END IF;
  INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (p_user, p_type, p_title, p_message, p_link);
END $$;
CREATE TABLE public.shops (id uuid primary key default gen_random_uuid(), name text);
CREATE TABLE public.shop_orders (id uuid primary key default gen_random_uuid(), shop_id uuid, buyer_id uuid, seller_id uuid,
  status text, accept_by timestamptz, is_seed boolean default false);
CREATE FUNCTION public.declutter_book_by_reminder_sweep(p_now timestamptz DEFAULT now()) RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$;
`);

await db.exec(readFileSync(BASE, "utf8"));
await db.exec(readFileSync(STEP_DONE, "utf8"));
if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

// Louisiana noon on a fixed day far from the real clock (CST = UTC-6 on 2030-11-12).
const T = "2030-11-12T18:00:00Z";
const at = (h) => new Date(new Date(T).getTime() + h * 3600e3).toISOString();
const sweepAt = async (h) => {
  const n = await one(`select sweep_needs_you_reminders($1::timestamptz)`, [at(h)]);
  await q(`update notifications set created_at=$1::timestamptz where abs(extract(epoch from created_at - now())) < 600`, [at(h)]);
  return n;
};
const claim = async (h) => {
  await q(`update sms_messages set due_at=$1::timestamptz where status='pending'`, [at(h + 3 / 60)]);
  await q(`select sms_claim_due(25, true, $1::timestamptz)`, [at(h + 4 / 60)]);
};
const texts = async (since) => q(`select n.title, n.type, s.status, s.reason from sms_messages s join notifications n on n.id=s.notification_id
  where s.user_id=$1 and s.kind='needs_you' and n.created_at >= $2::timestamptz order by n.title, s.status`, [A, at(since)]);
const SHOP = (await q(`insert into shops(name) values ('Bayou Bakes') returning id`))[0].id;
const order = async (due) => (await q(`insert into shop_orders(shop_id,buyer_id,seller_id,status,accept_by) values ($1,$2,$3,'held',$4) returning id`, [SHOP, B, A, due]))[0].id;

// H1: an order waiting on shop A: reminded, texted as needs-you, and the text goes while the order still waits.
const H1 = await order(at(10));
check("H1 setup: one shop reminder", (await sweepAt(0)) === 1);
await claim(0);
const t1 = await texts(0);
check("H1: 'Answer the new order' is texted as a needs-you reminder and goes", t1.length === 1 && t1[0].title === "Answer the new order" && t1[0].type === "new_offers" && t1[0].status === "queued", JSON.stringify(t1));
await q(`update shop_orders set status='declined' where id=$1`, [H1]);

// H2: the shop accepts while the text waits: dropped as step_done.
const H2 = await order(at(10.5));
check("H2 setup: one shop reminder", (await sweepAt(0.5)) === 1);
await q(`update shop_orders set status='accepted' where id=$1`, [H2]);
await claim(0.5);
const t2 = await texts(0.5);
check("H2: an order answered while its text waited: the text is dropped, step_done", t2.length === 1 && t2[0].status === "skipped" && t2[0].reason === "step_done", JSON.stringify(t2));

// H3: rung 2, "Order drops soon", still waiting: goes.
const H3 = await order(at(2.5));
check("H3 setup: the last-2-hours reminder", (await sweepAt(1)) === 1);
await claim(1);
const t3 = await texts(1);
check("H3: 'Order drops soon' still waiting: the text goes", t3.length === 1 && t3[0].title === "Order drops soon" && t3[0].status === "queued", JSON.stringify(t3));
await q(`update shop_orders set status='expired' where id=$1`, [H3]);

// H4: a job offer (same 'new_offers' type) is still a job_offer text, not needs-you.
const kind = await one(`select sms_kind_for('new_offers', 'New job offer', null)`);
check("H4: a job offer keeps its own text kind", kind === "job_offer", kind);

// Grants unchanged: service_role only.
const acl = await one(`select coalesce(proacl::text,'') from pg_proc where proname='sms_claim_due'`);
check("sms_claim_due: service_role only", /service_role=X/.test(acl) && !/anon=|authenticated=|(^|[{,])=X/.test(acl), acl);

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

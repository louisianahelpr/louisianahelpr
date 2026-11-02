#!/usr/bin/env node
/**
 * PGlite proof for 20261102034632_sms_needs_you_step_done.sql (A3-85 follow-up): a needs-you reminder text whose
 * step the member already did (answered the offer, the refund request or the refund offer) while the text waited is
 * dropped at claim time ('step_done'); one whose step is still waiting goes; a needs-you text with no claim row is
 * left alone.
 *
 *   node src/test/pglite/smsNeedsYouStepDone.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/smsNeedsYouStepDone.pglite.mjs  # RED: the done steps are texted
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/smsNeedsYouStepDone.pglite.mjs  # RED on a planted defect
 *
 * World: needsYouDeadlineReminders.pglite.mjs's (the SMS migration, stub Declutter tables, that migration applied
 * once), then this migration 3x. pglite from ~/.lh-pglite.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const SMS = new URL("../../../supabase/migrations/20261021193738_sms_alerts.sql", import.meta.url).pathname;
const BASE = new URL("../../../supabase/migrations/20261102002011_needs_you_deadline_reminders.sql", import.meta.url).pathname;
const NEW = process.env.MIGRATION_PATH ?? new URL("../../../supabase/migrations/20261102034632_sms_needs_you_step_done.sql", import.meta.url).pathname;
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
CREATE FUNCTION public.declutter_book_by_reminder_sweep(p_now timestamptz DEFAULT now()) RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$;
`);

await db.exec(readFileSync(BASE, "utf8"));
if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

// Louisiana noon on a fixed day far from the real clock (CST = UTC-6 on 2030-11-12); each scenario runs in its own
// half hour after it.
const T = "2030-11-12T18:00:00Z";
const at = (h) => new Date(new Date(T).getTime() + h * 3600e3).toISOString();
const ITEM = (await q(`insert into declutter_items(title) values ('Oak dresser') returning id`))[0].id;
// The sweep writes its claim at p_now and the notice at now(); in the cron they are one transaction time (p_now
// defaults to now()). Here the sweep runs with p_now = a fixed time, so its new notices are put at that time too.
const sweepAt = async (h) => {
  const n = await one(`select sweep_needs_you_reminders($1::timestamptz)`, [at(h)]);
  // The notices just written carry the real clock (years from T); every other notice here sits at a fixed time near T.
  await q(`update notifications set created_at=$1::timestamptz where abs(extract(epoch from created_at - now())) < 600`, [at(h)]);
  return n;
};
// The texts queued since the last claim are due 3 minutes after the notice; the claim runs at 4 minutes.
const claim = async (h) => {
  await q(`update sms_messages set due_at=$1::timestamptz where status='pending'`, [at(h + 3 / 60)]);
  await q(`select sms_claim_due(25, true, $1::timestamptz)`, [at(h + 4 / 60)]);
};
const texts = async (since) => q(`select n.title, s.status, s.reason from sms_messages s join notifications n on n.id=s.notification_id
  where s.user_id=$1 and s.kind='needs_you' and n.created_at >= $2::timestamptz order by n.title, s.status`, [A, at(since)]);
const offer = async (due) => (await q(`insert into declutter_offers(item_id,buyer_id,seller_id,status,awaiting,respond_by) values ($1,$2,$3,'open','seller',$4) returning id`, [ITEM, B, A, due]))[0].id;
const close = async (...ids) => { for (const id of ids) await q(`update declutter_offers set status='expired' where id=$1`, [id]); };

// S1: A is reminded to answer an offer and accepts it while the text waits: the text is dropped as step_done.
const S1 = await offer(at(10));
check("S1 setup: one reminder, one text queued", (await sweepAt(0)) === 1 && (await texts(0)).length === 1);
await q(`update declutter_offers set status='accepted' where id=$1`, [S1]);
await claim(0);
const t1 = await texts(0);
check("S1: an offer answered while its text waited: the text is dropped, step_done", t1.length === 1 && t1[0].status === "skipped" && t1[0].reason === "step_done", JSON.stringify(t1));

// S2: the offer is still open: the text goes.
const S2 = await offer(at(10.5));
check("S2 setup: one reminder", (await sweepAt(0.5)) === 1);
await claim(0.5);
const t2 = await texts(0.5);
check("S2: an offer still waiting on A: the text is handed out", t2.length === 1 && t2[0].status === "queued", JSON.stringify(t2));
await close(S2);

// S3: rung 2 ("Offer closes soon"), and A counters while it waits: the offer now waits on the buyer at a new time.
const S3 = await offer(at(2.5));
check("S3 setup: the last-2-hours reminder", (await sweepAt(1)) === 1 && (await texts(1))[0]?.title === "Offer closes soon");
await q(`update declutter_offers set awaiting='buyer', respond_by=$2 where id=$1`, [S3, at(20)]);
await claim(1);
const t3 = await texts(1);
check("S3: countered (now waiting on the buyer): A's text is dropped, step_done", t3.length === 1 && t3[0].reason === "step_done", JSON.stringify(t3));
await close(S3);

// S3b: the same offer turned to wait on the buyer at the SAME deadline: still not A's step, dropped.
const S3b = await offer(at(11.2));
check("S3b setup: one reminder", (await sweepAt(1.2)) === 1);
await q(`update declutter_offers set awaiting='buyer' where id=$1`, [S3b]);
await claim(1.2);
const t3b = await texts(1.2);
check("S3b: waiting on the buyer now (same deadline): A's text is dropped, step_done", t3b.length === 1 && t3b[0].reason === "step_done", JSON.stringify(t3b));
await close(S3b);

// S3c: the offer's deadline moved (a counter came back to A with a new respond_by): the text names a deadline that
// no longer holds, so it is dropped; the sweep claims and sends a fresh reminder for the new deadline in its window.
const S3c = await offer(at(11.3));
check("S3c setup: one reminder", (await sweepAt(1.3)) === 1);
await q(`update declutter_offers set respond_by=$2 where id=$1`, [S3c, at(30)]);
await claim(1.3);
const t3c = await texts(1.3);
check("S3c: the deadline the text names no longer holds: dropped, step_done", t3c.length === 1 && t3c[0].reason === "step_done", JSON.stringify(t3c));
await close(S3c);

// S4: two offers reminded in one run, one answered, one still open: both texts go (the notice names no item, so a
// text is dropped only when EVERY step it could be about is done; never a due one).
const S4a = await offer(at(11.5));
const S4b = await offer(at(11.6));
check("S4 setup: two reminders in one run", (await sweepAt(1.5)) === 2);
await q(`update declutter_offers set status='declined' where id=$1`, [S4a]);
await claim(1.5);
const t4 = await texts(1.5);
check("S4: one of two same-run offers still open: neither text is dropped", t4.length === 2 && t4.every((t) => t.status === "queued"), JSON.stringify(t4));
await close(S4b);

// S5: refunds. A is the seller on one order (request open) and the buyer on another (a refund offer).
const O1 = (await q(`insert into declutter_orders(buyer_id,seller_id) values ($1,$2) returning id`, [B, A]))[0].id;
const O2 = (await q(`insert into declutter_orders(buyer_id,seller_id) values ($1,$2) returning id`, [A, B]))[0].id;
await q(`insert into declutter_cart_items(order_id,item_id) values ($1,$3),($2,$3)`, [O1, O2, ITEM]);
const RQ1 = (await q(`insert into declutter_refund_requests(order_id,status,answer_by) values ($1,'open',$2) returning id`, [O1, at(8)]))[0].id;
await q(`insert into declutter_refund_requests(order_id,status,offer_answer_by) values ($1,'offered',$2)`, [O2, at(8)]);
check("S5 setup: A reminded as seller and as buyer", (await sweepAt(2)) === 2);
await q(`update declutter_refund_requests set status='offered', offer_answer_by=$2 where id=$1`, [RQ1, at(30)]);
await claim(2);
const t5 = Object.fromEntries((await texts(2)).map((t) => [t.title, t]));
check("S5: the seller answered the refund request while the text waited: dropped, step_done",
  t5["Answer the refund request"]?.reason === "step_done", JSON.stringify(t5));
check("S5: the refund offer still waiting on A as buyer: its text goes", t5["Answer the refund offer"]?.status === "queued", JSON.stringify(t5));
await q(`update declutter_refund_requests set status='closed'`);

// S6: a needs-you notice with no claim row (written by hand here; the checkout, pickup and approval reminders have
// none): left alone, it goes.
await q(`insert into notifications(user_id,title,message,type,created_at) values ($1,'Answer the offer','x','declutter_offers',$2)`, [A, at(2.5)]);
await claim(2.5);
const t6 = await texts(2.5);
check("S6: no claim row: the text is left alone and goes", t6.length === 1 && t6[0].status === "queued", JSON.stringify(t6));

// Grants unchanged: service_role only.
const acl = await one(`select coalesce(proacl::text,'') from pg_proc where proname='sms_claim_due'`);
check("sms_claim_due: service_role only", /service_role=X/.test(acl) && !/anon=|authenticated=|(^|[{,])=X/.test(acl), acl);

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

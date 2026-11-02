#!/usr/bin/env node
/**
 * PGlite proof for 20261102002011_needs_you_deadline_reminders.sql (A3-85, owner 11-01 12:19 PM): a member with a
 * Declutter step due (answer an offer, answer a refund request or a refund offer) gets a reminder about 12 hours and
 * 2 hours before the deadline, at most 2 per item per Louisiana day, never 8:50 PM-8 AM, never after the step is done
 * or the deadline passed, never for test data; the needs-you notices (these, plus the existing checkout, pickup and
 * job-approval reminders) are TEXTED to an opted-in member, and a needs-you text over an hour old is dropped.
 *
 *   node src/test/pglite/needsYouDeadlineReminders.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/needsYouDeadlineReminders.pglite.mjs  # RED: no sweep, no texts
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/needsYouDeadlineReminders.pglite.mjs  # RED on a planted defect
 *
 * World: the SMS migration (20261021193738) on smsNoNearbyJobTexts.pglite.mjs's stubs, plus stub Declutter tables
 * with the columns the sweep reads and a declutter_notify_strict that writes the bell row. pglite from ~/.lh-pglite.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const SMS = new URL("../../../supabase/migrations/20261021193738_sms_alerts.sql", import.meta.url).pathname;
const NEW = process.env.MIGRATION_PATH ?? new URL("../../../supabase/migrations/20261102002011_needs_you_deadline_reminders.sql", import.meta.url).pathname;
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

if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

// A Louisiana noon on a fixed day (CST = UTC-6 on 2026-11-10).
const NOON = "2026-11-10T18:00:00Z";
const at = (iso, h) => new Date(new Date(iso).getTime() + h * 3600e3).toISOString();
const sweep = async (iso) => { try { return await one(`select sweep_needs_you_reminders($1::timestamptz)`, [iso]); } catch (e) { return `ERR ${e.message}`; } };
const notes = async (uid, like = "%") => q(`select title, message, type, link from notifications where user_id=$1 and title ilike $2 order by created_at, title`, [uid, like]);

const ITEM = (await q(`insert into declutter_items(title) values ('Oak dresser') returning id`))[0].id;
// Offer waiting on the seller A, due at NOON + 10 h (inside the 12 h window, outside the last 2 h).
const OFF = (await q(`insert into declutter_offers(item_id,buyer_id,seller_id,status,awaiting,respond_by) values ($1,$2,$3,'open','seller',$4) returning id`, [ITEM, B, A, at(NOON, 10)]))[0].id;
// An offer far off (30 h): nothing yet. A seed offer due soon: never.
await q(`insert into declutter_offers(item_id,buyer_id,seller_id,status,awaiting,respond_by) values ($1,$2,$3,'open','seller',$4)`, [ITEM, B, A, at(NOON, 30)]);
await q(`insert into declutter_offers(item_id,buyer_id,seller_id,status,awaiting,respond_by,is_seed) values ($1,$2,$3,'open','seller',$4,true)`, [ITEM, B, A, at(NOON, 1)]);

const r1 = await sweep(NOON);
const a1 = await notes(A, "%offer%");
check("offer, 10 h left: the seller gets ONE 'Answer the offer' that names the item and the next step",
  r1 === 1 && a1.length === 1 && a1[0].title === "Answer the offer" && /Oak dresser/.test(a1[0].message)
  && /Next: accept, counter or decline by 10:00 PM today/.test(a1[0].message) && a1[0].link === "/declutter?tab=selling"
  && a1[0].type === "declutter_offers", JSON.stringify({ r1, a1 }));
check("the far-off offer (30 h) and the test offer get nothing", a1.length === 1);
check("a second run at once sends nothing again", (await sweep(at(NOON, 0.2))) === 0);

// The last 2 hours: rung 2. Same day: the cap is 2, so this is the second and last today.
const r2 = await sweep(at(NOON, 8.5)); // 8:30 PM, 1.5 h left
if (process.env.DEBUG) console.log("r2", r2, await q(`select * from needs_you_reminder_sends`));
const a2 = await notes(A, "%offer%");
check("offer, 1.5 h left: rung 2 'Offer closes soon' goes", r2 === 1 && a2.length === 2 && a2[1].title === "Offer closes soon", JSON.stringify(a2));

// Quiet hours: 8:50 PM to 8 AM Louisiana, nothing at all.
const OFF2 = (await q(`insert into declutter_offers(item_id,buyer_id,seller_id,status,awaiting,respond_by) values ($1,$2,$3,'open','buyer',$4) returning id`, [ITEM, B, A, at(NOON, 11)]))[0].id;
check("8:55 PM: quiet, nothing written", (await sweep(at(NOON, 8 + 55 / 60))) === 0);
check("3 AM: quiet, nothing written", (await sweep(at(NOON, 15))) === 0);
// The buyer's counter-offer waiting (awaiting buyer) at 7:59 AM next day is due at 11 PM: wait for 8 AM.
check("7:59 AM: still quiet", (await sweep(at(NOON, 19 + 59 / 60))) === 0);

// Never after the step is done: the buyer's counter-offers are answered before the next run (one still 5.5 h from
// its deadline, inside the window).
await q(`update declutter_offers set status='accepted' where id=$1`, [OFF2]);
await q(`insert into declutter_offers(item_id,buyer_id,seller_id,status,awaiting,respond_by) values ($1,$2,$3,'declined','buyer',$4)`, [ITEM, B, A, at(NOON, 26)]);
await sweep(at(NOON, 20.5));
check("an answered offer is never reminded", (await notes(B, "%offer%")).length === 0);

// Never past the deadline.
await q(`insert into declutter_offers(item_id,buyer_id,seller_id,status,awaiting,respond_by) values ($1,$2,$3,'open','buyer',$4)`, [ITEM, B, A, at(NOON, 20)]);
check("an offer already past its deadline gets nothing", (await sweep(at(NOON, 21))) === 0);

// Cap: 2 per item per day, even when the deadline resets (a counter-offer bounce).
const DAY2 = at(NOON, 24); // next day noon
await q(`update declutter_offers set respond_by=$2 where id=$1`, [OFF, at(DAY2, 10)]);
check("next day, a new deadline for the same offer: reminded again", (await sweep(DAY2)) === 1);
await q(`update declutter_offers set respond_by=$2 where id=$1`, [OFF, at(DAY2, 9)]);
check("a second new deadline the same day: one more", (await sweep(at(DAY2, 0.5))) === 1);
await q(`update declutter_offers set respond_by=$2 where id=$1`, [OFF, at(DAY2, 1.5)]);
check("a third the same day: capped at 2 per item per day", (await sweep(at(DAY2, 0.6))) === 0);
await q(`update declutter_offers set status='expired' where id=$1`, [OFF]);

// Refund request waiting on the seller (answer_by), and a refund offer waiting on the buyer (offer_answer_by).
const DAY3 = at(NOON, 48);
const ORD = (await q(`insert into declutter_orders(buyer_id,seller_id) values ($1,$2) returning id`, [B, A]))[0].id;
await q(`insert into declutter_cart_items(order_id,item_id) values ($1,$2)`, [ORD, ITEM]);
const RQ = (await q(`insert into declutter_refund_requests(order_id,status,answer_by) values ($1,'open',$2) returning id`, [ORD, at(DAY3, 6)]))[0].id;
check("refund request, 6 h left: the seller is reminded", (await sweep(DAY3)) === 1);
const rf = await notes(A, "%refund%");
check("it says what and by when: 'Answer the refund request' ... by 6:00 PM today, or Louisiana Helpr decides",
  rf.length === 1 && rf[0].title === "Answer the refund request" && /Oak dresser/.test(rf[0].message)
  && /Next: answer by 6:00 PM today, or Louisiana Helpr decides/.test(rf[0].message) && rf[0].type === "declutter_refunds", JSON.stringify(rf));
await q(`update declutter_refund_requests set status='offered', offer_answer_by=$2 where id=$1`, [RQ, at(DAY3, 7)]);
check("the seller answered with an offer: the buyer is reminded to answer it", (await sweep(at(DAY3, 1))) === 1);
const rb = await notes(B, "%refund%");
check("buyer reminder: 'Answer the refund offer', links to Buying", rb.length === 1 && rb[0].title === "Answer the refund offer" && rb[0].link === "/declutter?tab=buying", JSON.stringify(rb));
check("no further seller reminder once the seller answered", (await notes(A, "%refund%")).length === 1);

// A notice that cannot be written rolls its claim back and is retried next run, recorded as a defect.
await q(`insert into notify_fail values ('Refund offer closes soon')`);
check("a failing notice: nothing counted", (await sweep(at(DAY3, 5.5))) === 0);
check("...and recorded as a cron defect", (await one(`select count(*)::int from cron_defects_seen where fn='sweep_needs_you_reminders'`)) >= 1);
await q(`delete from notify_fail`);
check("...and retried on the next run", (await sweep(at(DAY3, 5.7))) === 1);

// TEXTS: the needs-you notices get the kind needs_you; the rest are unchanged.
const k = async (type, title, job = null) => one(`select sms_kind_for($1,$2,$3::uuid)`, [type, title, job]);
const JOB = "44444444-4444-4444-4444-444444444444";
check("sms_kind_for: every needs-you notice is the kind needs_you",
  (await k("declutter_offers", "Answer the offer")) === "needs_you" && (await k("declutter_offers", "Offer closes soon")) === "needs_you"
  && (await k("declutter_refunds", "Answer the refund request")) === "needs_you" && (await k("declutter_refunds", "Refund offer closes soon")) === "needs_you"
  && (await k("payment", "Check out within 24 hours")) === "needs_you" && (await k("payment", "2 hours left to check out")) === "needs_you"
  && (await k("declutter_pickups", "Porch pickup in 1 hour")) === "needs_you" && (await k("declutter_pickups", "Pickup at 3:30 PM")) === "needs_you"
  && (await k("warning", "Please review the work", JOB)) === "needs_you");
check("sms_kind_for: other Declutter notices and the old kinds are unchanged",
  (await k("declutter_offers", "New offer")) === null && (await k("declutter_sales", "Sold")) === null
  && (await k("job_update", "Still on for tomorrow?", JOB)) === "job_update" && (await k("message", "x", JOB)) === "message"
  && (await k("warning", "Offer expired", JOB)) === null && (await k("job_match", "New job posted", JOB)) === null);
// The trigger now queues a text for those Declutter types (A opted in); B (no consent) gets none.
const smsFor = async (uid) => q(`select s.kind, s.status, n.title from sms_messages s join notifications n on n.id=s.notification_id where s.user_id=$1 and s.kind='needs_you'`, [uid]);
const ta = await smsFor(A);
check("A's needs-you reminders each queued a text", ta.length >= 3 && ta.every((t) => t.kind === "needs_you"), JSON.stringify(ta));
check("B (never opted in) has no text queued", (await smsFor(B)).length === 0);
// The claim: a fresh needs-you text goes; one over an hour old is dropped as stale.
await q(`insert into notifications(user_id,title,message,type) values ($1,'Answer the offer','x','declutter_offers')`, [A]);
const freshId = await one(`select s.id from sms_messages s join notifications n on n.id=s.notification_id where n.user_id=$1 order by n.created_at desc limit 1`, [A]);
await q(`update sms_messages set status='skipped' where user_id=$1 and id<>$2`, [A, freshId]);
const nowIso = await one(`select (date_trunc('day', now() at time zone 'America/Chicago') + interval '12 hours') at time zone 'America/Chicago'`);
await q(`update sms_messages set due_at=$2::timestamptz - interval '1 minute' where id=$1`, [freshId, nowIso]);
await q(`update notifications set created_at=$2::timestamptz - interval '5 minutes' where id=(select notification_id from sms_messages where id=$1)`, [freshId, nowIso]);
const c1 = (await q(`select r from sms_claim_due(10, true, $1::timestamptz) r`, [nowIso])).map((x) => x.r);
check("a fresh needs-you text is handed out with its kind", c1.length === 1 && c1[0].kind === "needs_you", JSON.stringify(c1));
await q(`insert into notifications(user_id,title,message,type) values ($1,'Offer closes soon','x','declutter_offers')`, [A]);
const oldId = await one(`select s.id from sms_messages s join notifications n on n.id=s.notification_id where n.user_id=$1 and n.title='Offer closes soon' order by n.created_at desc limit 1`, [A]);
await q(`update sms_messages set due_at=$2::timestamptz - interval '1 minute' where id=$1`, [oldId, nowIso]);
await q(`update notifications set created_at=$2::timestamptz - interval '61 minutes' where id=(select notification_id from sms_messages where id=$1)`, [oldId, nowIso]);
await q(`select sms_claim_due(10, true, $1::timestamptz)`, [nowIso]);
const old = (await q(`select status, reason from sms_messages where id=$1`, [oldId]))[0];
check("a needs-you text over an hour old is dropped as stale, never sent late", old?.status === "skipped" && old?.reason === "stale", JSON.stringify(old));

// The cron wrapper runs both sweeps and records each.
const w = await one(`select sweep_deadline_reminders($1::timestamptz)`, [at(NOON, 72)]).catch?.(() => null) ?? await (async () => { try { return await one(`select sweep_deadline_reminders($1::timestamptz)`, [at(NOON, 72)]); } catch (e) { return null; } })();
check("sweep_deadline_reminders returns both counts", w && w.book_by === 7 && w.needs_you === 0, JSON.stringify(w));

// The cron calls both with NO argument: their default reads the clock. On a fixed clock (the newest definitions,
// every now() pointed at the probe), 9 PM writes nothing and noon sends what is due.
if (!skip) {
  await installClock(db);
  for (const fn of ["sweep_needs_you_reminders", "sweep_deadline_reminders"]) await db.exec(onFixedClock(newestFunction(fn).stmt));
  const D5 = at(NOON, 96);
  await q(`insert into declutter_offers(item_id,buyer_id,seller_id,status,awaiting,respond_by) values ($1,$2,$3,'open','seller',$4)`, [ITEM, B, A, at(D5, 4)]);
  await setClock(db, at(D5, 9)); // 9 PM Louisiana
  const night = await one(`select sweep_deadline_reminders()`);
  await setClock(db, D5); // noon
  const day = await one(`select sweep_deadline_reminders()`);
  check("fixed clock, no argument: 9 PM sends nothing, noon sends the due offer reminder",
    night?.needs_you === 0 && day?.needs_you === 1, JSON.stringify({ night, day }));
} else check("fixed clock, no argument: 9 PM sends nothing, noon sends the due offer reminder", false, "skipped");

// Grants: nothing member-callable.
const acl = Object.fromEntries((await q(`select proname, coalesce(proacl::text,'') a from pg_proc where proname in ('sweep_needs_you_reminders','sweep_deadline_reminders','needs_you_reminder_quiet','sms_kind_for','sms_claim_due')`)).map((r) => [r.proname, r.a]));
check("grants: every new or restated function is service_role only",
  Object.keys(acl).length === 5 && Object.values(acl).every((a) => /service_role=X/.test(a) && !/anon=|authenticated=|(^|[{,])=X/.test(a)), JSON.stringify(acl));
const tacl = await one(`select coalesce(relacl::text,'') from pg_class where relname='needs_you_reminder_sends'`);
check("the claim table: no member grant", tacl !== undefined && !/anon=|authenticated=/.test(tacl), tacl);

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

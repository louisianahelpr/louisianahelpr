#!/usr/bin/env node
/**
 * PGlite proof for 20261020022332_sms_alerts (SMS alerts, owner 2026-10-20).
 *
 *   node src/test/pglite/smsAlerts.pglite.mjs                 # GREEN: every check passes
 *   node src/test/pglite/smsAlerts.pglite.mjs <mutant.sql>    # run against an edited copy (expect FAILs)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * The migration is applied 3x (replay safety), then: the switch starts off;
 * double opt-in (tick -> pending + one confirmation; YES from the phone opts
 * in); no phone-in-use oracle; caps, quiet hours and seed suppression;
 * STOP/START/HELP; Twilio 21610; a banned account cannot opt in but can opt
 * out (Q281); a deleted account's consent events are kept 4 years from the
 * deletion and then pruned by prune_retention_tables (Q2239); grants.
 * Stubs (auth.users, has_role, feature_enabled_for_user, is_caller_banned,
 * net.http_post, vault getters) are minimal shapes of the live objects.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = process.argv[2] ?? new URL("../../../supabase/migrations/20261020022332_sms_alerts.sql", import.meta.url).pathname;
const A = "11111111-1111-1111-1111-111111111111"; // admin, opted in
const B = "22222222-2222-2222-2222-222222222222"; // regular member
const S = "33333333-3333-3333-3333-333333333333"; // seed admin
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true),'')::uuid $$;
CREATE SCHEMA net; CREATE TABLE net.calls (id serial, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls(url, body) VALUES (url, body) RETURNING id::bigint $$;
CREATE TYPE public.app_role AS ENUM ('admin','user');
CREATE TABLE public.user_roles (user_id uuid, role app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE TABLE public.test_accounts (user_id uuid, enrolled_at timestamptz, note text);
CREATE TABLE public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid, is_seed boolean default false, phone text);
CREATE TABLE public.banned_stub (user_id uuid primary key);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.banned_stub WHERE user_id = auth.uid()) $$;
CREATE TABLE public.feature_switches (key text primary key, audience text, description text, created_at timestamptz default now(), updated_at timestamptz default now());
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE((SELECT CASE s.audience WHEN 'everyone' THEN true WHEN 'testers' THEN COALESCE(public.has_role(p_user_id, 'admin'::app_role), false) OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id) ELSE false END FROM public.feature_switches s WHERE s.key = p_key AND p_user_id IS NOT NULL), false); $function$;
CREATE FUNCTION public.get_supabase_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://x.supabase.co' $$;
CREATE FUNCTION public.get_service_role_key() RETURNS text LANGUAGE sql AS $$ SELECT 'k' $$;
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null, message text not null, type text not null, read boolean not null default false, link text, created_at timestamptz not null default now(), job_id uuid);
CREATE TABLE public.notification_preferences (id uuid default gen_random_uuid(), user_id uuid unique, messages boolean default true, job_matches boolean default true, work_status boolean default true, job_updates boolean default true, new_offers boolean default true, quiet_start time, quiet_end time);
CREATE TABLE public.error_logs (id serial, severity text, message text, url text, tags jsonb, context jsonb);
CREATE TABLE public.notification_type_pref_map (type text primary key, pref_column text);
INSERT INTO notification_type_pref_map VALUES ('message','messages'),('job_match','job_matches'),('info','work_status'),('success','work_status'),('work_status','work_status'),('job_updates','job_updates'),('job_update','job_updates'),('expired','job_updates'),('new_offers','new_offers');
INSERT INTO auth.users VALUES ('${A}'),('${B}'),('${S}');
INSERT INTO user_roles VALUES ('${A}','admin'),('${S}','admin');
INSERT INTO profiles(user_id,is_seed) VALUES ('${A}',false),('${B}',false),('${S}',true);
INSERT INTO test_accounts(user_id) VALUES ('${S}');
`);
const sql = readFileSync(mig, "utf8");
for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
const q = async (s, p=[]) => (await db.query(s, p)).rows;
const as = async (uid, s, p=[]) => { await db.exec(`SET request.uid='${uid ?? ""}'`); try { return await q(s, p); } finally { await db.exec(`RESET request.uid`); } };
const err = async (fn) => { try { await fn(); return "NO ERROR"; } catch (e) { return e.message; } };
const results = [];
const check = (name, ok, detail) => { results.push([name, ok]); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };
check("switch created off", (await q(`select audience from feature_switches where key='sms_alerts'`))[0].audience === "off");
check("opt-in refused while switch off", (await err(() => as(A, `select set_sms_consent(true,'(225) 555-0123')`))).includes("feature_disabled"));
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
check("member B refused at testers", (await err(() => as(B, `select set_sms_consent(true,'2255550199')`))).includes("feature_disabled"));
check("invalid phone refused", (await err(() => as(A, `select set_sms_consent(true,'555-1234')`))).includes("invalid_phone"));
check("unauth refused", (await err(() => as(null, `select set_sms_consent(true,'2255550123')`))).includes("not_authenticated"));
await db.exec(`delete from net.calls`);
const r1 = (await as(A, `select set_sms_consent(true,'(225) 555-0123') r`))[0].r;
check("ticking makes the number PENDING, not opted in", r1.sms_opt_in === false && r1.pending_phone === "+12255550123", JSON.stringify(r1));
const pc = await q(`select body from net.calls`);
check("ticking queues exactly one confirmation post", pc.length === 1 && pc[0].body.confirm_user_id === A, JSON.stringify(pc));
const cc = (await q(`select sms_claim_confirmation($1,true) r`, [A]))[0].r;
check("confirmation claim sends to the pending number", cc.action === "send" && cc.kind === "confirm" && cc.phone === "+12255550123", JSON.stringify(cc));
// pending: a notification is NOT texted
const nPend = (await q(`insert into notifications(user_id,title,message,type) values ($1,'t','m','message') returning id`, [A]))[0].id;
check("pending number gets no alert", (await q(`select sms_claim($1,true) r`, [nPend]))[0].r.reason === "no_consent");
// a stranger (seed admin S) asks for the same number: no oracle, no error
const rS = await err(() => as(S, `select set_sms_consent(true,'2255550123')`));
check("asking for a number another account asked for does not error (no oracle)", rS === "NO ERROR", rS);
// the phone replies YES -> the most recent request wins? No: S is newer; ensure A confirms first by clearing S
await q(`update sms_consent set pending_phone=null, pending_since=null where user_id='${S}'`);
check("YES from the phone confirms", (await q(`select sms_inbound_keyword('+12255550123','start') r`))[0].r === 1);
const afterYes = (await as(A, `select get_my_sms_consent() r`))[0].r;
check("confirmed: opted in, pending cleared", afterYes.sms_opt_in === true && afterYes.phone_e164 === "+12255550123" && afterYes.pending_phone === null, JSON.stringify(afterYes));
check("consent version server-stamped", (await q(`select consent_text_version v from sms_consent where user_id='${A}'`))[0].v === "sms-v1");
// another account now asks for A's confirmed number: no error, and its confirmation is skipped phone_in_use
await as(S, `select set_sms_consent(true,'2255550123')`);
check("confirmation to a number opted in elsewhere is skipped", (await q(`select sms_claim_confirmation($1,true) r`, [S]))[0].r.reason === "suppressed_seed");
// make S a non-seed to see phone_in_use path
await q(`update profiles set is_seed=false where user_id='${S}'`); await q(`delete from test_accounts where user_id='${S}'`);
check("confirmation to a number opted in elsewhere -> phone_in_use (server-side only)", (await q(`select sms_claim_confirmation($1,true) r`, [S]))[0].r.reason === "phone_in_use");
check("YES cannot move a confirmed number to the other account", (await q(`select sms_inbound_keyword('+12255550123','start') r`))[0].r === 0);
await q(`update profiles set is_seed=true where user_id='${S}'`); await q(`insert into test_accounts(user_id) values ('${S}')`);
await q(`update sms_consent set pending_phone=null, pending_since=null where user_id='${S}'`);
// S confirms its own different number (to test seed suppression of alerts)
await as(S, `select set_sms_consent(true,'2255550177')`);
await q(`select sms_inbound_keyword('2255550177','yes_is_start')`).catch(() => {});
await q(`select sms_inbound_keyword('2255550177','start')`);
// trigger
await db.exec(`delete from net.calls`);
const ins = async (uid, type, title='t', job=null) => (await q(`insert into notifications(user_id,title,message,type,job_id) values ($1,$2,'Full Name Here at 123 Main St',$3,$4) returning id`, [uid, title, type, job]))[0].id;
const n1 = await ins(A, "message");
const nWarn = await ins(A, "warning");
const nInfoNoJob = await ins(A, "info");
const nB = await ins(B, "message");
const calls = await q(`select body from net.calls`);
check("trigger posts only for eligible+consented+switched", calls.length === 1 && calls.some(c => c.body.notification_id === n1), JSON.stringify(calls));
check("trigger body is the id only", Object.keys(calls[0].body).join() === "notification_id");
// claim
const claim = async (id, ready=true) => (await q(`select sms_claim($1,$2) r`, [id, ready]))[0].r;
const c1 = await claim(n1);
check("claim sends message (first alert after confirming)", c1.action === "send" && c1.kind === "message" && c1.phone === "+12255550123" && c1.first_text === true, JSON.stringify(c1));
check("claim idempotent", (await claim(n1)).reason === "duplicate");
check("sms_messages has no phone/body", !(await q(`select column_name from information_schema.columns where table_name='sms_messages'`)).some(r => /phone|body|title|message$/.test(r.column_name)));
check("warning not eligible", (await claim(nWarn)).reason === "not_eligible");
check("info w/o job not eligible", (await claim(nInfoNoJob)).reason === "not_eligible");
check("no consent", (await claim(nB)).reason === "no_consent");
const nS = await ins(S, "message");
check("seed account confirmed its own number", (await q(`select sms_opt_in o from sms_consent where user_id='${S}'`))[0].o === true);
check("seed suppressed", (await claim(nS)).reason === "suppressed_seed");
const n2 = await ins(A, "message");
check("messages coalesced within 10 min", (await claim(n2)).reason === "coalesced_messages");
const job = "44444444-4444-4444-4444-444444444444";
const nOffer = await ins(A, "info", "📋 New job offer!", job);
const cOffer = await claim(nOffer, false);
check("provider not configured skip", cOffer.reason === "twilio_not_configured");
const nOffer2 = await ins(A, "info", "📋 New job offer!", job);
const co2 = await claim(nOffer2);
check("hired notice -> job_offer kind, job id", co2.action === "send" && co2.kind === "job_offer" && co2.job_id === job && co2.first_text === false, JSON.stringify(co2));
const nNew = await ins(A, "new_offers", "x", job);
check("new_offers -> job_offer", (await claim(nNew)).kind === "job_offer");
const nUpd = await ins(A, "job_updates", "Lexi accepted", job);
check("job_updates -> job_update", (await claim(nUpd)).kind === "job_update");
// pref off
await db.exec(`insert into notification_preferences(user_id, job_updates) values ('${A}', false)`);
const nUpd2 = await ins(A, "job_updates", "x", job);
check("category toggle off -> pref_off", (await claim(nUpd2)).reason === "pref_off");
// job matches: quiet hours depend on clock; force by checking hour
const hour = (await q(`select extract(hour from now() at time zone 'America/Chicago')::int h`))[0].h;
const nM1 = await ins(A, "job_match", "x", job);
const cm1 = await claim(nM1);
const quiet = hour >= 21 || hour < 8;
check(`job_match at Central hour ${hour} -> ${quiet ? "quiet_hours" : "send"}`, quiet ? cm1.reason === "quiet_hours" : cm1.action === "send", JSON.stringify(cm1));
if (!quiet) { const nM2 = await ins(A, "job_match", "x", job); check("job_match hourly cap", (await claim(nM2)).reason === "cap_job_matches"); }
// switch off -> skip
await db.exec(`update feature_switches set audience='off' where key='sms_alerts'`);
await db.exec(`delete from net.calls`);
const nOff = await ins(A, "message");
check("switch off: trigger posts nothing", (await q(`select count(*)::int c from net.calls`))[0].c === 0);
check("switch off: claim skips", (await claim(nOff)).reason === "switch_off");
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
// record result + 21610
const sid = c1.sms_id;
check("record sent", (await q(`select sms_record_result($1,'sent','SM123',null) r`, [sid]))[0].r === true);
check("record twice is false", (await q(`select sms_record_result($1,'sent','SM123',null) r`, [sid]))[0].r === false);
await q(`select sms_record_result($1,'failed',null,'21610')`, [co2.sms_id]);
check("21610 opts out", (await q(`select sms_opt_in o, opt_out_source s from sms_consent where user_id='${A}'`))[0].s === "carrier_21610");
// START re-opts, STOP opts out
check("START re-opts", (await q(`select sms_inbound_keyword('+12255550123','start') r`))[0].r === 1 && (await q(`select sms_opt_in o from sms_consent where user_id='${A}'`))[0].o === true);
check("STOP opts out", (await q(`select sms_inbound_keyword('2255550123','stop') r`))[0].r === 1 && (await q(`select sms_opt_in o from sms_consent where user_id='${A}'`))[0].o === false);
check("events logged (requested, confirmed, carrier out, start, stop)", (await q(`select count(*)::int c from sms_consent_events where user_id='${A}'`))[0].c === 5);
// START more than 30 days after STOP does not re-subscribe (recycled numbers)
await q(`update sms_consent set opted_out_at = now() - interval '31 days' where user_id='${A}'`);
check("START after 30 days does nothing", (await q(`select sms_inbound_keyword('2255550123','start') r`))[0].r === 0);
await q(`update sms_consent set opted_out_at = now() - interval '1 day' where user_id='${A}'`);
// member quiet hours apply to every category
await q(`select sms_inbound_keyword('2255550123','start')`);
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
const loc = (await q(`select (now() at time zone 'America/Chicago')::time t`))[0].t;
await q(`update notification_preferences set quiet_start = ($1::time - interval '1 hour'), quiet_end = ($1::time + interval '1 hour'), job_updates = true where user_id='${A}'`, [loc]);
await q(`delete from sms_messages where user_id='${A}'`);
const nQ = await ins(A, "message");
check("member quiet hours block a message text", (await claim(nQ)).reason === "member_quiet_hours");
await q(`update notification_preferences set quiet_start=null, quiet_end=null where user_id='${A}'`);
// opt-out by member always allowed even with switch off
await db.exec(`update feature_switches set audience='off' where key='sms_alerts'`);
check("member opt-out allowed with switch off", (await as(A, `select set_sms_consent(false,null) r`))[0].r.sms_opt_in === false);
// admin status
// missing vault secrets are recorded in error_logs
await db.exec(`CREATE OR REPLACE FUNCTION public.get_service_role_key() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$`);
await q(`select sms_post_to_edge('{"notification_id":"x"}'::jsonb)`);
check("missing vault secret -> error_logs row", (await q(`select count(*)::int c from error_logs where tags->>'source'='sms_post_to_edge'`))[0].c === 1);
await db.exec(`CREATE OR REPLACE FUNCTION public.get_service_role_key() RETURNS text LANGUAGE sql AS $$ SELECT 'k' $$`);
// account deletion keeps the consent record (user_id set null)
await q(`delete from sms_consent where user_id='${B}'`); await q(`insert into sms_consent_events(user_id,event,phone_e164,source) values ('${B}','opt_out','+12255550199','settings')`);
await q(`delete from auth.users where id='${B}'`);
check("deleting the account keeps its consent events (user_id NULL)", (await q(`select count(*)::int c from sms_consent_events where phone_e164='+12255550199' and user_id is null`))[0].c === 1);
// Q2239 retention (owner 2026-10-20): 4 years after the account is deleted, then gone
check("deletion stamps account_deleted_at on the orphaned consent events", (await q(`select count(*)::int c from sms_consent_events where phone_e164='+12255550199' and user_id is null and account_deleted_at > now() - interval '1 minute'`))[0].c === 1);
// an OLD event (created 6 years ago) of a just-deleted account is kept: the window runs from deletion
await q(`update sms_consent_events set created_at = now() - interval '6 years' where phone_e164='+12255550199'`);
await q(`select prune_retention_tables()`);
check("just-deleted account: 6-year-old consent event kept", (await q(`select count(*)::int c from sms_consent_events where phone_e164='+12255550199'`))[0].c === 1);
await q(`update sms_consent_events set account_deleted_at = now() - interval '4 years' + interval '1 day' where phone_e164='+12255550199'`);
await q(`select prune_retention_tables()`);
check("deleted 1 day short of 4 years: kept", (await q(`select count(*)::int c from sms_consent_events where phone_e164='+12255550199'`))[0].c === 1);
// a live account's 10-year-old event is never age-pruned
await q(`insert into sms_consent_events(user_id,event,phone_e164,source,created_at) values ('${A}','opt_in','+12255550123','test', now() - interval '10 years')`);
await q(`update sms_consent_events set account_deleted_at = now() - interval '4 years' - interval '1 day' where phone_e164='+12255550199'`);
const pr = (await q(`select prune_retention_tables() r`))[0].r;
check("deleted over 4 years ago: deleted by the daily prune", (await q(`select count(*)::int c from sms_consent_events where phone_e164='+12255550199'`))[0].c === 0 && pr.sms_consent_events === 1, JSON.stringify(pr));
check("live account's 10-year-old consent event kept", (await q(`select count(*)::int c from sms_consent_events where user_id='${A}' and created_at < now() - interval '9 years'`))[0].c === 1);
check("prune_retention_tables: no PUBLIC/anon/authenticated execute", !/(^|[{,])=X|anon=X|authenticated=X/.test((await q(`select proacl::text a from pg_proc where proname='prune_retention_tables'`))[0].a ?? ""));
// Q281: a banned account cannot opt in, but can always opt out
const swWas = (await q(`select audience from feature_switches where key='sms_alerts'`))[0].audience;
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
await q(`insert into banned_stub values ('${A}')`);
{ const e = await err(() => as(A, `select set_sms_consent(true,'2255550188')`)); check("banned account cannot opt in", e.includes("account_restricted"), e); }
const offBanned = await err(() => as(A, `select set_sms_consent(false,null)`));
check("banned account can still opt out", offBanned === "NO ERROR" && (await q(`select sms_opt_in from sms_consent where user_id='${A}'`))[0].sms_opt_in === false, offBanned);
await q(`delete from banned_stub`);
await db.exec(`update feature_switches set audience='${swWas}' where key='sms_alerts'`);
check("admin_sms_status refused to member", (await err(() => as("44444444-0000-4000-8000-000000000000", `select admin_sms_status()`))).includes("admin_only"));
const st = (await as(A, `select admin_sms_status() r`))[0].r;
check("admin_sms_status works", st.audience === "off" && Array.isArray(st.recent) && !JSON.stringify(st).includes("2255550123"), JSON.stringify(st).slice(0,200));
// grants
const acl = await q(`select proname, proacl::text a from pg_proc where proname in ('sms_claim','sms_record_result','sms_inbound_keyword','set_sms_consent','get_my_sms_consent','admin_sms_status','sms_fan_out_on_notification','sms_category_for','sms_normalize_phone','sms_claim_confirmation','sms_post_to_edge') order by 1`);
const bad = acl.filter(r => /(^|[{,])=X|anon=X/.test(r.a) || (["sms_claim","sms_record_result","sms_inbound_keyword","sms_category_for","sms_normalize_phone","sms_fan_out_on_notification","sms_claim_confirmation","sms_post_to_edge"].includes(r.proname) && /authenticated=X/.test(r.a)));
check("no PUBLIC/anon execute; service fns not authenticated", bad.length === 0, JSON.stringify(acl));
const tacl = await q(`select relname, relacl::text a from pg_class where relname in ('sms_consent','sms_consent_events','sms_messages')`);
check("tables: no anon/authenticated grants", tacl.every(r => !/anon=|authenticated=/.test(r.a ?? "")), JSON.stringify(tacl));
// notification insert never fails even if trigger internals break
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
await as(A, `select set_sms_consent(true,'2255550123')`);
await db.exec(`DROP FUNCTION net.http_post(text,jsonb,jsonb)`);
check("notification insert survives a broken pg_net", (await err(() => ins(A, "message"))) === "NO ERROR");
const failed = results.filter(r => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

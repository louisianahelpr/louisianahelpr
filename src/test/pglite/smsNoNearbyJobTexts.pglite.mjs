#!/usr/bin/env node
/**
 * PGlite proof for 20261023181442_sms_no_nearby_job_texts (owner ruling 2026-10-23: no SMS is ever sent for a
 * nearby or matching job).
 *
 *   node src/test/pglite/smsNoNearbyJobTexts.pglite.mjs                 # GREEN: every check passes
 *   node src/test/pglite/smsNoNearbyJobTexts.pglite.mjs <mutant.sql>    # run against an edited copy (expect FAILs)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The stubs are the same minimal
 * shapes as src/test/pglite/smsAlerts.pglite.mjs. The SMS migration (20261021193738) is applied, a member opts in
 * and a nearby-job text is left WAITING; then this migration is applied 3x (replay safety) and:
 *   - the waiting nearby-job text is skipped (job_match_texts_retired), sent history untouched;
 *   - sms_kind_for is NULL for every job_match title seen on prod (60 days, read-only) and any other;
 *   - a new job_match notification for an opted-in member queues NO text; a message still does;
 *   - the claim never hands out a job_match text;
 *   - the consent stamps are now 'sms-v2' (request and YES confirm);
 *   - grants unchanged; the retired switch set_sms_job_match_texts is no longer executable by members.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const OLD = new URL("../../../supabase/migrations/20261021193738_sms_alerts.sql", import.meta.url).pathname;
const mig = process.argv[2] ?? new URL("../../../supabase/migrations/20261023181442_sms_no_nearby_job_texts.sql", import.meta.url).pathname;
const A = "11111111-1111-1111-1111-111111111111"; // admin, opts in
const B = "22222222-2222-2222-2222-222222222222"; // regular member, never opts in
const S = "33333333-3333-3333-3333-333333333333"; // seed admin
const JOB = "44444444-4444-4444-4444-444444444444";
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
CREATE TABLE public.notification_preferences (id uuid default gen_random_uuid(), user_id uuid unique, messages boolean default true, job_matches boolean default true, work_status boolean default true, job_updates boolean default true, new_offers boolean default true, job_applications boolean default true, system_alerts boolean default true, payments boolean default true, financial_alerts boolean default true, quiet_start time, quiet_end time);
CREATE TABLE public.error_logs (id serial, severity text, message text, url text, tags jsonb, context jsonb);
CREATE TABLE public.notification_type_pref_map (type text primary key, pref_column text);
INSERT INTO notification_type_pref_map VALUES ('message','messages'),('job_match','job_matches'),('info','work_status'),('success','work_status'),('work_status','work_status'),('job_updates','job_updates'),('job_update','job_updates'),('expired','job_updates'),('new_offers','new_offers'),('application','job_applications'),('warning','system_alerts'),('payment','payments'),('financial_alerts','financial_alerts');
INSERT INTO auth.users VALUES ('${A}'),('${B}'),('${S}');
INSERT INTO user_roles VALUES ('${A}','admin'),('${S}','admin');
INSERT INTO profiles(user_id,is_seed) VALUES ('${A}',false),('${B}',false),('${S}',true);
INSERT INTO test_accounts(user_id) VALUES ('${S}');
`);
const q =async (s, p = []) => (await db.query(s, p)).rows;
const one = async (s, p = []) => Object.values((await q(s, p))[0] ?? {})[0];
const as = async (uid, s, p = []) => { await db.exec(`SET request.uid='${uid ?? ""}'`); try { return await q(s, p); } finally { await db.exec(`RESET request.uid`); } };
const results = [];
const check = (name, ok, detail) => { results.push([name, ok]); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };
const ins = async (uid, type, title = "t", job = null) =>
  one(`insert into notifications(user_id,title,message,type,job_id) values ($1,$2,'Full Name Here at 123 Main St',$3,$4) returning id`, [uid, title, type, job]);
const row = async (nid) => (await q(`select * from sms_messages where notification_id=$1`, [nid]))[0];
const C = "55555555-5555-5555-5555-555555555555"; // admin who opts in AFTER this migration
await db.exec(`INSERT INTO auth.users VALUES ('${C}'); INSERT INTO user_roles VALUES ('${C}','admin'); INSERT INTO profiles(user_id,is_seed) VALUES ('${C}',false);`);

// ── before: the SMS migration as on prod, A opted in, a nearby-job text waiting ───────────────
await db.exec(readFileSync(OLD, "utf8"));
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
await as(A, `select set_sms_consent(true,'(225) 555-0123')`);
const ccA = (await q(`select sms_claim_confirmation($1,true) r`, [A]))[0].r;
check("before: A confirms with the code", (await one(`select sms_inbound_keyword('+12255550123','start',$1)`, [ccA.code])) === 1);
check("before: the old stamp was sms-v1", (await one(`select consent_text_version from sms_consent where user_id=$1`, [A])) === "sms-v1");
const waiting = await ins(A, "job_match", "New job posted", JOB);
check("before: a nearby-job notification queued a text (the behaviour being removed)", (await row(waiting))?.kind === "job_match" && (await row(waiting))?.status === "pending", JSON.stringify(await row(waiting)));
await q(`insert into sms_messages(user_id,category,kind,status,created_at,sent_at,provider_sid) values ($1,'job_matches','job_match','sent',now() - interval '2 days',now() - interval '2 days','SMold')`, [A]);

// ── apply this migration 3x ───────────────────────────────────────────────────────────────────
const sql = readFileSync(mig, "utf8");
for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }

check("the waiting nearby-job text is skipped, never sent", (await row(waiting))?.status === "skipped" && (await row(waiting))?.reason === "job_match_texts_retired", JSON.stringify(await row(waiting)));
check("a nearby-job text already sent stays as history", (await one(`select count(*)::int from sms_messages where provider_sid='SMold' and status='sent'`)) === 1);

// Every job_match title seen on prod (60 days, read-only 2026-10-23), plus the fixture title, with and without a job.
const TITLES = ["New job posted", "🌿 Match for you", "🧹 Match for you", "🚗 Match for you", "New jobs in Vermilion", "New jobs in Iberia", "New job in your parish", "New job near you", "anything"];
let allNull = true;
for (const t of TITLES) for (const j of [JOB, null]) {
  const k = await one(`select sms_kind_for('job_match',$1,$2::uuid)`, [t, j]);
  if (k !== null) { allNull = false; console.log("  texted:", t, j, k); }
}
check("sms_kind_for: a job_match notification is never texted, any title, with or without a job", allNull);
check("sms_kind_for: the member's own kinds are unchanged",
  (await one(`select sms_kind_for('message','Lexi L.',$1::uuid)`, [JOB])) === "message"
  && (await one(`select sms_kind_for('new_offers','You got a direct job offer!',$1::uuid)`, [JOB])) === "job_offer"
  && (await one(`select sms_kind_for('info','📋 New job offer!',$1::uuid)`, [JOB])) === "job_offer"
  && (await one(`select sms_kind_for('application','New application',$1::uuid)`, [JOB])) === "application"
  && (await one(`select sms_kind_for('info','Application update',$1::uuid)`, [JOB])) === "job_update"
  && (await one(`select sms_kind_for('warning','Offer expired',$1::uuid)`, [JOB])) === null);

const nMatch = await ins(A, "job_match", "🌿 Match for you", JOB);
check("a new nearby-job notification for an opted-in member queues NO text", (await row(nMatch)) === undefined);
const nMsg = await ins(A, "message", "Lexi L.", JOB);
check("a message for the same member still queues one", (await row(nMsg))?.status === "pending" && (await row(nMsg))?.kind === "message");
await q(`update sms_messages set due_at = now() - interval '1 minute' where status='pending'`);
const claims = (await q(`select r from sms_claim_due(50, true, now()) r`)).map((x) => x.r);
check("the claim never hands out a nearby-job text", !claims.some((c) => c.kind === "job_match"), JSON.stringify(claims));

// ── the consent stamp is sms-v2 ───────────────────────────────────────────────────────────────
await as(C, `select set_sms_consent(true,'2255550166')`);
check("the opt-in request is stamped sms-v2", (await one(`select consent_text_version from sms_consent_events where user_id=$1 and event='opt_in_requested'`, [C])) === "sms-v2");
const ccC = (await q(`select sms_claim_confirmation($1,true) r`, [C]))[0].r;
check("YES with the code still confirms", (await one(`select sms_inbound_keyword('2255550166','start',$1)`, [ccC.code])) === 1);
check("the confirmed opt-in is stamped sms-v2 (row and event)",
  (await one(`select consent_text_version from sms_consent where user_id=$1`, [C])) === "sms-v2"
  && (await one(`select consent_text_version from sms_consent_events where user_id=$1 and event='opt_in'`, [C])) === "sms-v2");

// ── grants unchanged ──────────────────────────────────────────────────────────────────────────
const acl = Object.fromEntries((await q(`select proname, coalesce(proacl::text,'') a from pg_proc where proname in ('sms_kind_for','set_sms_consent','sms_inbound_keyword','set_sms_job_match_texts')`)).map((r) => [r.proname, r.a]));
check("grants: sms_kind_for and sms_inbound_keyword service_role only; set_sms_consent authenticated, never anon",
  !/anon=|authenticated=/.test(acl.sms_kind_for) && /service_role=X/.test(acl.sms_kind_for)
  && !/anon=|authenticated=/.test(acl.sms_inbound_keyword) && /service_role=X/.test(acl.sms_inbound_keyword)
  && /authenticated=X/.test(acl.set_sms_consent) && !/anon=/.test(acl.set_sms_consent), JSON.stringify(acl));
check("the retired nearby-job switch (set_sms_job_match_texts) is no longer executable by members", !/anon=|authenticated=/.test(acl.set_sms_job_match_texts), acl.set_sms_job_match_texts);
{ let e = "NO ERROR"; await db.exec(`SET request.uid='${A}'; SET ROLE authenticated`); try { await db.query(`select set_sms_job_match_texts(false)`); } catch (x) { e = x.message; } await db.exec(`RESET ROLE; RESET request.uid`); check("a member calling it is refused", /permission denied/.test(e), e); }

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
